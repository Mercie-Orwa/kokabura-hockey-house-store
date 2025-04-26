require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const router = express.Router();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// MongoDB Connection
const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI is not defined in .env file');
    process.exit(1);
}

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
let db;

async function connectToMongoDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        db = client.db('hockey_store_db');
    } catch (error) {
        console.error('MongoDB connection failed:', error);
        process.exit(1);
    }
}

connectToMongoDB();

// JWT Middleware
const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Protect specific routes
const protectRoute = (req, res, next) => {
    const protectedPaths = ['/admin.html', '/order-history.html'];
    if (protectedPaths.includes(req.path)) {
        const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
        if (!token) return res.redirect('/login.html');
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) return res.redirect('/login.html');
            if (req.path === '/admin.html' && user.type !== 'admin') {
                return res.status(403).send('Forbidden: Admin access required');
            }
            req.user = user;
            next();
        });
    } else {
        next();
    }
};

app.use(protectRoute);

// M-Pesa Utility Functions
const generateAccessToken = async (consumerKey, consumerSecret) => {
    try {
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const response = await axios.get(
            'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                },
            }
        );
        return response.data.access_token;
    } catch (error) {
        throw new Error('Failed to generate access token');
    }
};

const generateTimestamp = () => {
    const now = new Date();
    return (
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0')
    );
};

const generatePassword = (shortcode, passkey, timestamp) => {
    const buffer = Buffer.from(`${shortcode}${passkey}${timestamp}`);
    return buffer.toString('base64');
};

// Checkout Route with M-Pesa Integration
app.post('/api/checkout', authenticateToken, async (req, res) => {
    const { cart, name, email, phoneNumber } = req.body;
    const userId = req.user.id;
    const session = client.startSession();

    try {
        session.startTransaction();

        // Calculate total and validate products
        let total = 0;
        const productsCollection = db.collection('products');
        const validatedCart = [];
        
        for (const item of cart) {
            const product = await productsCollection.findOne(
                { _id: new ObjectId(item._id) },
                { session }
            );
            if (!product || product.stock < (item.quantity || 1)) {
                await session.abortTransaction();
                return res.status(400).json({ 
                    success: false, 
                    message: `Product ${item.name || item._id} not available or insufficient stock` 
                });
            }
            total += product.price * (item.quantity || 1);
            validatedCart.push({
                productId: product._id,
                name: product.name,
                price: product.price,
                quantity: item.quantity || 1
            });
        }

        // Create order
        const ordersCollection = db.collection('orders');
        const order = {
            userId: new ObjectId(userId),
            items: validatedCart,
            total,
            status: 'pending',
            paymentStatus: 'pending',
            customer: { name, email, phone: phoneNumber },
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const orderResult = await ordersCollection.insertOne(order, { session });
        const orderId = orderResult.insertedId;

        // Initiate M-Pesa STK Push
        const accessToken = await generateAccessToken(process.env.MPESA_CONSUMER_KEY, process.env.MPESA_CONSUMER_SECRET);
        const timestamp = generateTimestamp();
        const password = generatePassword(
            process.env.MPESA_BUSINESS_SHORTCODE,
            process.env.MPESA_PASSKEY,
            timestamp
        );

        const stkPushUrl = process.env.MPESA_ENV === 'sandbox'
            ? 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
            : 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

        const stkPushPayload = {
            BusinessShortCode: process.env.MPESA_BUSINESS_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.round(total),
            PartyA: phoneNumber,
            PartyB: process.env.MPESA_BUSINESS_SHORTCODE,
            PhoneNumber: phoneNumber,
            CallBackURL: `${process.env.BASE_URL || 'https://your-ngrok-url.ngrok.io'}/api/payments/callback`,
            AccountReference: `ORDER_${orderId}`,
            TransactionDesc: 'Payment for Hockey Store Order'
        };

        const stkResponse = await axios.post(stkPushUrl, stkPushPayload, {
            headers: { 
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const { ResponseCode, CheckoutRequestID } = stkResponse.data;
        if (ResponseCode !== '0') {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: 'Failed to initiate M-Pesa payment',
                error: stkResponse.data.ResponseDescription
            });
        }

        // Record payment
        const paymentsCollection = db.collection('payments');
        const payment = {
            orderId,
            paymentMethod: 'mpesa',
            amount: total,
            transactionId: CheckoutRequestID,
            phoneNumber,
            status: 'pending',
            metadata: stkResponse.data,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await paymentsCollection.insertOne(payment, { session });

        // Update product stocks
        for (const item of cart) {
            await productsCollection.updateOne(
                { _id: new ObjectId(item._id) },
                { $inc: { stock: -(item.quantity || 1) } },
                { session }
            );
        }

        await session.commitTransaction();
        
        res.json({ 
            success: true, 
            message: 'Payment initiated. Check your phone to complete M-Pesa payment.',
            orderId: orderId.toString(),
            paymentId: payment._id.toString(),
            checkoutRequestId: CheckoutRequestID
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('Checkout error:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Checkout processing failed',
            error: error.message 
        });
    } finally {
        session.endSession();
    }
});

// M-Pesa Payment Callback Webhook
app.post('/api/payments/callback', async (req, res) => {
    const callbackData = req.body;
    console.log('M-Pesa callback received:', JSON.stringify(callbackData, null, 2));

    if (!callbackData.Body?.stkCallback) {
        console.error('Invalid callback data');
        return res.status(400).json({ success: false, message: 'Invalid callback data' });
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callbackData.Body.stkCallback;
    const session = client.startSession();

    try {
        session.startTransaction();
        
        const paymentsCollection = db.collection('payments');
        const ordersCollection = db.collection('orders');
        const productsCollection = db.collection('products');

        // Find payment by CheckoutRequestID
        const payment = await paymentsCollection.findOne(
            { transactionId: CheckoutRequestID },
            { session }
        );

        if (!payment) {
            await session.abortTransaction();
            console.error('Payment not found for CheckoutRequestID:', CheckoutRequestID);
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // Update payment status
        const paymentStatus = ResultCode === 0 ? 'completed' : 'failed';
        const paymentUpdate = {
            status: paymentStatus,
            callbackData,
            updatedAt: new Date()
        };

        await paymentsCollection.updateOne(
            { transactionId: CheckoutRequestID },
            { $set: paymentUpdate },
            { session }
        );

        // Update order status
        const orderUpdate = {
            status: ResultCode === 0 ? 'paid' : 'payment_failed',
            paymentStatus: paymentStatus,
            updatedAt: new Date()
        };

        if (ResultCode === 0) {
            orderUpdate.paymentCompletedAt = new Date();
            if (CallbackMetadata?.Item) {
                const phoneItem = CallbackMetadata.Item.find(item => item.Name === 'PhoneNumber');
                if (phoneItem) orderUpdate.customer.phone = phoneItem.Value.toString();
            }
        } else {
            // Restore product stock if payment failed
            const order = await ordersCollection.findOne(
                { _id: payment.orderId },
                { session }
            );
            
            for (const item of order.items) {
                await productsCollection.updateOne(
                    { _id: item.productId },
                    { $inc: { stock: item.quantity } },
                    { session }
                );
            }
        }

        await ordersCollection.updateOne(
            { _id: payment.orderId },
            { $set: orderUpdate },
            { session }
        );

        await session.commitTransaction();
        res.status(200).json({ success: true });
    } catch (error) {
        await session.abortTransaction();
        console.error('Callback processing error:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        session.endSession();
    }
});

// Payment Status Endpoint
app.get('/api/payments/:paymentId', authenticateToken, async (req, res) => {
    try {
        const paymentsCollection = db.collection('payments');
        const payment = await paymentsCollection.findOne({ 
            _id: new ObjectId(req.params.paymentId),
            orderId: new ObjectId(req.query.orderId)
        });

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        res.json({ 
            success: true, 
            payment: {
                id: payment._id,
                status: payment.status,
                amount: payment.amount,
                method: payment.paymentMethod,
                transactionId: payment.transactionId,
                createdAt: payment.createdAt,
                updatedAt: payment.updatedAt
            }
        });
    } catch (error) {
        console.error('Payment status error:', error);
        res.status(500).json({ success: false, message: 'Error fetching payment status' });
    }
});

// Product Routes
app.get('/products', async (req, res) => {
    try {
        const productsCollection = db.collection('products');
        const products = await productsCollection.find({}).toArray();
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.post('/products', authenticateToken, async (req, res) => {
    try {
        if (req.user.type !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const productsCollection = db.collection('products');
        const product = req.body;
        const result = await productsCollection.insertOne(product);
        res.status(201).json({ _id: result.insertedId, ...product });
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ error: 'Failed to add product' });
    }
});

app.delete('/products/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.type !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const productsCollection = db.collection('products');
        const result = await productsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json({ message: 'Product deleted' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Order Routes
app.get('/orders', authenticateToken, async (req, res) => {
    try {
        const ordersCollection = db.collection('orders');
        const orders = await ordersCollection.find({ userId: new ObjectId(req.user.id) }).toArray();
        res.json(orders.map(order => ({
            _id: order._id,
            date: order.createdAt,
            total: order.total,
            paymentStatus: order.paymentStatus,
            items: order.items,
            status: order.status,
            customer: order.customer
        })));
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

// Authentication Routes
app.post('/api/login', async (req, res) => {
    console.log('Received login request:', req.body);
    const { email, password, loginType } = req.body;
    try {
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ email, password, type: loginType });
        if (user) {
            const token = jwt.sign(
                { id: user._id.toString(), email: user.email, type: user.type },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            res.json({ success: true, token, userId: user._id.toString() });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/register', async (req, res) => {
    const { email, password, type } = req.body;
    try {
        const usersCollection = db.collection('users');
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }
        await usersCollection.insertOne({ email, password, type });
        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        console.error('Error registering:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong' });
});

// Start Server with ngrok
const PORT = process.env.PORT || 5006;
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    try {
        const { default: ngrok } = await import('@ngrok/ngrok');
        const listener = await ngrok.forward({ addr: PORT, authtoken: process.env.NGROK_AUTHTOKEN });
        console.log(`Ingress established at: ${listener.url()}`);
        process.env.BASE_URL = listener.url(); // Update BASE_URL for callbacks
    } catch (error) {
        console.error('ngrok setup failed:', error);
    }
});

// Graceful Shutdown
const shutdown = async () => {
    console.log('Shutting down...');
    try {
        await client.close();
        console.log('MongoDB connection closed');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);