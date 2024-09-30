require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const host = process.env.HOST || 'localhost'; // Default to 'localhost' if not set
const port = process.env.PORT || 3000;
// User render.com 's secret folder for the json file in production
//const serviceAccountKeyFile = "/etc/secrets/service-account.json";
const serviceAccountKeyFile = "./config/service-account.json";
const sheetId = process.env.GOOGLE_SHEET_ID;
const sheetName = process.env.GOOGLE_SHEET_NAME;
const sheetSystem = process.env.GOOGLE_SHEET_SYSTEM;

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
async function _getSheetData(tabToRead) {
    const googleSheetClient = await _getGoogleSheetClient();
    const res = await googleSheetClient.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: tabToRead,
    });
    return res.data.values;
}

// Function to search for email in Google Sheet
async function _findUserByEmail(email) {
    const rows = await _getSheetData(sheetName);
    const emailIndex = 0; // Assuming the email is in the first column
    for (const row of rows) {
        if (row[emailIndex] && row[emailIndex].toLowerCase() === email.toLowerCase()) {
            return row; // Return the row if the email matches
        }
    }
    return null; // Return null if no matching email found
}

// Function to search whether the system is open for registration
async function _findSystemRegStatus() {
    const rows = await _getSheetData(sheetSystem);
    const controlIndex = 0; // Assuming the control keyword is in the first column
    for (const row of rows) {
        if (row[controlIndex] && row[controlIndex] === 'OpenForReg') {
            return row[1]; // Return the status if keyword matches
        } else {
            return 'N'; // Assume system not open of keyword not found
        }
    }
    return 'N'; // Assume system not open if sheet is empty
}

// Function to map a single row to a JSON structure
function mapRowToJson(openFlag, row) {
    return {
        systemOpen: openFlag,
        email: row[0],  // Assuming email is in the 1st column
        paidFlag: row[1],  // Paid indicator in 2nd column
        numOfFam: row[2],  // Paid indicator in 3rd column
        names: [
            row[3] || '', // Name 1 in 4th column
            row[4] || '', // Name 2 in 5th column
            row[5] || '', // Name 3 in 6th column
            row[6] || '', // Name 4 in 7th column
        ],
        mobile: row[7], // in 8th column
        tshirts: [
            {   //T shirt 1
                color: row[8], // in 9th column
                size:  row[9], // in 10th column
                qty:   row[10], // in 11th column
            },
            {   //T shirt 2
                color: row[11], // in 12nd column
                size:  row[12], // in 13rd column
                qty:   row[13], // in 14th column
            },
            {   //T shirt 3
                color: row[14], // in 15th column
                size:  row[15], // in 16th column
                qty:   row[16], // in 17th column
            },
            {   //T shirt 4
                color: row[17], // in 18th column
                size:  row[18], // in 19th column
                qty:   row[19], // in 20th column
            },
        ],
        totalFee: row[20], // in 21st column
        regDate:  row[21], // in 22nd column
        updDate:  row[22]  // in 23rd column
    };
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
        //TODO unit test codes only to hard code a testing account
        //const storedOtp = otpStore[email];
        var storedOtp;
        if (email === 'abc@bb.com') {
            storedOtp = 999999;
        } else {
            storedOtp = otpStore[email];
        }

        if (!storedOtp || storedOtp != otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        // OTP is valid, so delete it from the store
        delete otpStore[email];

        // Search for the user by email in the Google Sheet
        const userRow = await _findUserByEmail(email);
        // See if the system is open for regristration
        const systemOpen = await _findSystemRegStatus();
        console.log(`System Open status: ${systemOpen}`);

        // No user record found in the spreadsheet
        if (!userRow) {
            console.log(`No user data found`);
            const userData = {
                systemOpen: systemOpen
            };
            return res.status(404).json({ message: 'Login successful. No user data found.', userData });
        }

        // Construct the userData object based on the row data (e.g., names from columns)
        const userData = mapRowToJson(systemOpen, userRow);

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
    console.log(`Server is running on http://${host}:${port}`);
});
