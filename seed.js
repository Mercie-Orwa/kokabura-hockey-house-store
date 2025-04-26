require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
console.log('MongoDB URI:', uri ? uri.replace(/:([^:@]+)@/, ':****@') : 'undefined');

if (!uri) {
    console.error('MONGODB_URI is not defined in .env file');
    process.exit(1);
}

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

async function seedDatabase() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db('hockey_store_db');
        const productsCollection = db.collection('products');

        // Clear existing products
        await productsCollection.deleteMany({});

        // Add new products
        const products = [
            { name: "Hockey Stick", price: 12000, image: "images1/sticks2.jpg", description: "High-quality hockey stick for professionals" },
            { name: "Hockey Ball", price: 3000, image: "images1/balls.jpg", description: "Durable hockey ball for practice" },
            { name: "Hockey Gloves", price: 1000, image: "images1/knuckle guard.jpg", description: "Comfortable gloves for better grip" },
            { name: "Goalers Pad", price: 6000, image: "images1/goalers pads.jpg", description: "Best pads out there" }
        ];

        await productsCollection.insertMany(products);
        console.log('Products added to MongoDB');
    } catch (error) {
        console.error('Error seeding database:', error);
    } finally {
        await client.close();
    }
}

seedDatabase();
