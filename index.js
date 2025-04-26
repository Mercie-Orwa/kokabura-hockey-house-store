const http = require('http');
const ngrok = require('@ngrok/ngrok');

// Create webserver
http.createServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/html' });
	res.end('Congrats you have created an ngrok web server');
}).listen(5005, () => console.log('Node.js web server at 5005 is running...'));

// Get your endpoint online
ngrok.connect({ addr: 5005, authtoken_from_env: true })
	.then(listener => console.log(`Ingress established at: ${listener.url()}`));

	require('dotenv').config();
	const express = require('express');
	const { MongoClient, ObjectId } = require('mongodb');
	const cors = require('cors');
	const jwt = require('jsonwebtoken');
	const axios = require('axios');
	const port = process.env.PORT;
	
	const app = express();

	app.listen(port, () => {
		console.log('app is running on localhost:${port}');
	});
	app.use(cors());
	app.use(express.json());
	appuse(express.urlencoded({extended: true}));