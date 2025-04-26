const axios = require('axios');
require('dotenv').config();

async function getDarajaAccessToken() {
    const url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.get(url, {
        headers: { Authorization: `Basic ${auth}` }
    });
    return response.data.access_token;
}

function generateTimestamp() {
    const now = new Date();
    return now.getFullYear() +
        ("0" + (now.getMonth() + 1)).slice(-2) +
        ("0" + now.getDate()).slice(-2) +
        ("0" + now.getHours()).slice(-2) +
        ("0" + now.getMinutes()).slice(-2) +
        ("0" + now.getSeconds()).slice(-2);
}

function generatePassword(shortCode, passkey, timestamp) {
    return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');
}

async function testStkPush() {
    try {
        const accessToken = await getDarajaAccessToken();
        console.log('Access Token:', accessToken);

        const timestamp = generateTimestamp();
        const password = generatePassword(
            process.env.MPESA_SHORTCODE,
            process.env.MPESA_PASSKEY,
            timestamp
        );

        const stkPushUrl = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
        const stkPushPayload = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: 1,
            PartyA: "254708374149",
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: "254708374149",
            CallBackURL: `${process.env.BASE_URL}/api/payments/callback`,
            AccountReference: "TEST_123",
            TransactionDesc: "Test Payment"
        };

        const response = await axios.post(stkPushUrl, stkPushPayload, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        console.log('STK Push Response:', response.data);
    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
    }
}

testStkPush();