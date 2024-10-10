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
const sheetId = process.env.GOOGLE_SHEET_ID;
const sheetName = process.env.GOOGLE_SHEET_NAME;
const sheetEmailTemplate = process.env.GOOGLE_SHEET_EMAIL_TEMPLATE;
const sheetEmailFailLog = process.env.GOOGLE_SHEET_EMAIL_FAIL_LOG;
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
    // Initialize Google Auth with credentials from environment variables
    const auth = new GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Ensure newlines are handled properly
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    // Get an authenticated client
    const authClient = await auth.getClient();
    // Return the Google Sheets API client
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

// Function to send a confirmation email
async function sendConfirmationEmail(userData) {
    const email = userData.email;
    const name = `${userData.names[0].firstName} ${userData.names[0].lastName}`;
    const totalFee = userData.totalFee;

    // Fetch the email template from Google Sheets
    const emailTemplateData = await _getSheetData(sheetEmailTemplate);
    const emailTemplate = emailTemplateData[0][0]; // Assuming the template is in the first cell

    // Replace placeholders in the template
    const emailContent = emailTemplate.replace('{{name}}', name).replace('{{totalFee}}', totalFee);

    // Send the email
    const mailOptions = {
        from: 'Do not reply - Automatic email of Cornerstone Fellowship <cornerstone.backend@gmail.com>',
        to: email,
        subject: 'Retreat Registration Confirmation',
        text: emailContent,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Confirmation email sent to ${email}`);
    } catch (error) {
        console.error('Error sending confirmation email:', error);
        // Log the error to the email_fail_log tab
        await logEmailFailure(email, error.message);
    }
}

// Function to log email failure
async function logEmailFailure(email, errorMessage) {
    const timestamp = new Date().toISOString(); // Current timestamp in ISO format
    const logData = [[email, timestamp, errorMessage]]; // Prepare data for logging

    const googleSheetClient = await _getGoogleSheetClient();
    
    try {
        await googleSheetClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: sheetEmailFailLog, // Specify the log tab
            valueInputOption: 'RAW',
            resource: { values: logData },
        });
        console.log(`Logged email failure for ${email} at ${timestamp}`);
    } catch (logError) {
        console.error('Error logging email failure:', logError);
    }
}

// Function to map a single row to a JSON structure
function mapRowToJson(openFlag, row) {
    return {
        systemOpen: openFlag,
        email: row[0],  // Assuming email is in the 1st column
        paidFlag: row[1],  // Paid indicator in 2nd column
        numOfHH: row[2],  // Paid indicator in 3rd column
        names: [
            {   // 1st person
                firstName: row[3] || '', // First Name 1 in 4th column
                lastName:  row[4] || '', // Last  Name 1 in 5th column    
            },
            {
                firstName: row[5] || '', // First Name 2 in 6th column
                lastName:  row[6] || '', // Last  Name 2 in 7th column
            },
            {
                firstName: row[7] || '', // First Name 3 in 8th column
                lastName:  row[8] || '', // Last  Name 3 in 9th column    
            },
            {
                firstName: row[9] || '', // First Name 4 in 10th column
                lastName:  row[10] || '', // Last  Name 4 in 11th column    
            },
        ],
        mobile: row[11], // in 12nd column
        tshirts: [
            {   //T shirt 1
                size:  row[12], // in 13rd column
                qty:   row[13], // in 14th column
            },
            {   //T shirt 2
                size:  row[14], // in 15th column
                qty:   row[15], // in 16th column
            },
            {   //T shirt 3
                size:  row[16], // in 17th column
                qty:   row[17], // in 18th column
            },
            {   //T shirt 4
                size:  row[18], // in 19th column
                qty:   row[19], // in 20th column
            },
        ],
        totalFee: row[20], // in 21st column
        regDate:  row[21], // in 22nd column
        updTimestamp:  row[22]  // in 23rd column
    };
}

// Function to get the local date
function getLocalDate() {
    const date = new Date();
    
    // Get components
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
    const day = String(date.getDate()).padStart(2, '0');

    // Format as yyyy-mm-dd
    return `${year}-${month}-${day}`;
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
    console.log("Running verify OTP Route");
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
                systemOpen: systemOpen,
                email: email
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

// Function to save or update a user record
app.post('/saveOrUpdate', async (req, res) => {
    console.log("Running Save or Update Route");

    const userData = req.body; // The JSON data from frontend
    const email = userData.email;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        // Fetch all the existing rows in the sheet
        const rows = await _getSheetData(sheetName);
        const emailIndex = 0; // Assuming the email is in the first column

        // Check if email already exists in the sheet
        let rowIndex = -1;
        let existingRegDate = null; // To hold the existing regDate
        let existingPaidFlag = null; // To hold the existing paidFlag
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][emailIndex] && rows[i][emailIndex].toLowerCase() === email.toLowerCase()) {
                rowIndex = i + 1; // Google Sheets is 1-indexed
                existingRegDate = rows[i][21]; // Get the existing regDate (22nd column)
                existingPaidFlag = rows[i][1]; // Get the existing paid flag (2nd column)
                break;
            }
        }
        // Keep the current paid flag of default to N for new records
        const paidFlag = existingPaidFlag ? existingPaidFlag : 'N';

        // Set regDate and updDate based on action type
        const currentDate = new Date().toISOString(); // Current date in ISO format
        const regDate = existingRegDate ? existingRegDate : getLocalDate(); // Use the existing regDate for update, otherwise use current local date
        const updTimestamp = currentDate; // Always use the current date as updDate

        // Prepare the row data in the format that matches the Google Sheet
        const rowValues = [
            userData.email,        // Email in the 1st column
            paidFlag,              // Paid flag in the 2nd column
            userData.numOfHH,     // Number of households in the 3rd column
            userData.names[0].firstName,    // Name 1 in the 4th column
            userData.names[0].lastName,     // Name 1 in the 5th column
            userData.names[1].firstName,    // Name 2 in the 6th column
            userData.names[1].lastName,     // Name 2 in the 7th column
            userData.names[2].firstName,    // Name 3 in the 8th column
            userData.names[2].lastName,     // Name 3 in the 9th column
            userData.names[3].firstName,    // Name 4 in the 10th column
            userData.names[3].lastName,     // Name 4 in the 11th column
            userData.mobile,            // Mobile in the 12nd column
            userData.tshirts[0].size,   // T-shirt 1 Size in the 13th column
            userData.tshirts[0].qty,    // T-shirt 1 Qty in the 14th column
            userData.tshirts[1].size,   // T-shirt 2 Size in the 15th column
            userData.tshirts[1].qty,    // T-shirt 2 Qty in the 16th column
            userData.tshirts[2].size,   // T-shirt 3 Size in the 17th column
            userData.tshirts[2].qty,    // T-shirt 3 Qty in the 18th column
            userData.tshirts[3].size,   // T-shirt 4 Size in the 19th column
            userData.tshirts[3].qty,    // T-shirt 4 Qty in the 20th column
            userData.totalFee,          // Total Fee in the 21st column
            regDate,                    // Registration Date in the 22nd column (set only if new, unchanged if updating)
            updTimestamp                // Update Date in the 23rd column (always set to current timestamp)
        ];

        const googleSheetClient = await _getGoogleSheetClient();

        if (rowIndex > 0) {
            // Email exists, update the existing row
            await googleSheetClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `${sheetName}!A${rowIndex}:W${rowIndex}`, // Assuming 23 columns (A to W)
                valueInputOption: 'RAW',
                resource: { values: [rowValues] },
            });
            // Send confirmation email
            await sendConfirmationEmail(userData);
            return res.status(200).json({ message: 'Record updated successfully' });
        } else {
            // Email doesn't exist, append a new row
            await googleSheetClient.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: sheetName,
                valueInputOption: 'RAW',
                resource: { values: [rowValues] },
            });
            // Send confirmation email
            await sendConfirmationEmail(userData);
            return res.status(201).json({ message: 'Record saved successfully' });
        }
    } catch (error) {
        console.error('Error during save or update:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
