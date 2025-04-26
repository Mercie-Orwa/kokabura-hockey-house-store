// MongoDB Playground
// Use Ctrl+Space inside a snippet or a string literal to trigger completions.

// The current database to use.
use("hockey_store_db");

// Find a document in a collection.
db.getCollection("users").findOne({

});

db.users.find().pretty()

db.users.insertOne({
    email: "testuser@example.com",
    password: "password123",
    type: "customer"
})
db.users.insertOne({
    email: "adminuser@example.com",
    password: "admin123",
    type: "admin"
})