// init-db.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function initDatabase() {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db('hockey_store_db');

        // Create users collection and insert sample users
        const usersCollection = db.collection('users');
        await usersCollection.deleteMany({}); // Clear existing data (optional)
        await usersCollection.insertMany([
            { username: 'user1', password: 'user123', type: 'user' },
            { username: 'admin', password: 'admin123', type: 'admin' }
        ]);
        console.log('Users collection initialized with sample data');

        // Create orders collection and insert a sample order
        const ordersCollection = db.collection('orders');
        await ordersCollection.deleteMany({}); // Clear existing data (optional)
        await ordersCollection.insertOne({
            userId: 'sample-user-id',
            items: [
                { _id: 'sample-product-id', name: 'Hockey Stick', price: 1500 },
                { _id: 'sample-product-id-2', name: 'Hockey Ball', price: 200 }
            ],
            total: 1700,
            date: new Date(),
            paymentStatus: 'pending',
            checkoutRequestID: null
        });
        console.log('Orders collection initialized with sample data');

        // Verify collections
        const collections = await db.listCollections().toArray();
        console.log('Collections in database:', collections.map(c => c.name));
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await client.close();
        console.log('MongoDB connection closed');
    }
}
// Payment Schema (payments collection)
{
    _id; ObjectId,
    orderId; ObjectId, // Reference to order
    paymentMethod; String;// 'mpesa'
    amount; Number;
    transactionId; String;// From IntaSend
    phoneNumber; String;
    status; String; // 'initiated', 'pending', 'completed', 'failed'
    metadata; Object; // Raw response from IntaSend
    callbackData; Object; // Payment confirmation data
    createdAt; Date;
    updatedAt; Date
  }
  db.payments.insertOne({
    transactionId: "ws_CO_25042025_084512345678",
    orderId: "663d4f5a1b2c3d4e5f6a7890",
    userId: ObjectId("663d4f5a1b2c3d4e5f6a1234"),
    amount: 1,
    status: "pending",
    phoneNumber: "254708374149",
    BusinessShortCode: "174379",
    createdAt: new Date(),
    updatedAt: new Date()
})

initDatabase();