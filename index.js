require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const serviceAccountKeyFile = "./config/service-account.json";
const sheetId = process.env.GOOGLE_SHEET_ID;
const sheetName = process.env.GOOGLE_SHEET_NAME;

const cors = require('cors');
app.use(cors());
app.use(bodyParser.json());

// Simple in-memory storage for OTPs
let otpStore = {};

// Configure nodemailer with Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,  // Your Gmail account
        pass: process.env.GMAIL_PASS,  // Your Gmail App password
    },
});

// Function to auth the Google Sheet
async function _getGoogleSheetClient() {
    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountKeyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// Function to access Google Sheet and get rows
async function _getSheetData() {
    const googleSheetClient = await _getGoogleSheetClient();
    const res = await googleSheetClient.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: sheetName,
    });
    return res.data.values;
}

// Function to search for email in Google Sheet
async function _findUserByEmail(email) {
    const rows = await _getSheetData();
    const emailIndex = 0; // Assuming the email is in the first column
    for (const row of rows) {
        if (row[emailIndex] && row[emailIndex].toLowerCase() === email.toLowerCase()) {
            return row; // Return the row if the email matches
        }
    }
    return null; // Return null if no matching email found
}

// Request OTP Route
app.post('/sendOTP', async (req, res) => {
    console.log("Running Request OTP Route");
    const email = req.body.email;
    if (!email) {
        return res.status(400).send('Email is required');
    }

    // Generate a 6-digit OTP
    const otp = crypto.randomInt(100000, 999999);
    otpStore[email] = otp;  // Store the OTP in memory

    // Send email with the OTP
    const mailOptions = {
        from: 'Do not reply - Automatic email of Cornerstone Fellowship <cornerstone.backend@gmail.com>',
        to: email,
        subject: 'Your OTP Code',
        text: `Your OTP code is ${otp}.`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`OTP sent: ${otp}`);
        res.status(200).send('OTP sent to your email');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Failed to send OTP');
    }
});

// Verify OTP Route
app.post('/verifyOTP', async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: 'Email and OTP are required' });
    }

    try {
        // Verify OTP from memory or database (your logic)
        const storedOtp = otpStore[email];
        if (!storedOtp || storedOtp != otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        // OTP is valid, so delete it from the store
        delete otpStore[email];

        // Search for the user by email in the Google Sheet
        const userRow = await _findUserByEmail(email);

        if (!userRow) {
            console.log(`No user data found`);
            return res.status(200).json({ message: 'Login successful. No user data found.' });
        }

        // Construct the userData object based on the row data (e.g., names from columns)
        const userData = {
            email: userRow[0],  // Assuming email is in the first column
            names: [
                userRow[1] || '', // Name 1 in second column
                userRow[2] || '', // Name 2 in third column
                userRow[3] || '', // Name 3 in fourth column
                userRow[4] || '', // Name 4 in fifth column
            ]
        };

        // Return the userData object along with the success message
        res.status(200).json({
            message: 'Login successful with user data found',
            userData
        });
        const userDataJSON = JSON.stringify(userData);
        console.log(`User data fetched: ${userDataJSON}`);
    } catch (error) {
        console.error('Error during OTP verification:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
