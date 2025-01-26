require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');
const QRCode = require('qrcode');

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

// Encrypt the user's email using the private key
function encryptEmail(email, privateKey) {
    // Generate a key and IV for encryption
    const algorithm = 'aes-256-cbc'; // You can use other algorithms as well
    // Derive a 32-byte key using SHA-256 hash
    const key = crypto.createHash('sha256').update(privateKey).digest();
    const iv = crypto.randomBytes(16); // Initialization vector
    
    // Use createCipheriv instead of createCipher
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(email, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Prepend IV to the encrypted data
    const encryptedData = iv.toString('hex') + ':' + encrypted;
    //TODO: Unit test only
    console.log('iv:', iv);
    console.log('encryptedData:', encryptedData);
    return encryptedData;
}

// Decrypt the email address
function decryptEmail(encryptedEmail, privateKey) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.createHash('sha256').update(privateKey).digest();
    const parts = encryptedEmail.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');   // First 32 chars for IV
    const encryptedText = parts.join(':');          // Rest is the ciphertext

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Function to send a confirmation email
async function sendConfirmationEmail(userData, mode) {
    const email = userData.email;
    const name = `${userData.names[0].firstName} ${userData.names[0].lastName}`;
    const totalFee = userData.totalFee;
    let namelist = `${userData.names[0].firstName} ${userData.names[0].lastName}`;
    if (userData.names[1].firstName !== '') {
        namelist += `, ${userData.names[1].firstName} ${userData.names[1].lastName}`;
    }
    if (userData.names[2].firstName !== '') {
        namelist += `, ${userData.names[2].firstName} ${userData.names[2].lastName}`;
    }
    if (userData.names[3].firstName !== '') {
        namelist += `, ${userData.names[3].firstName} ${userData.names[3].lastName}`;
    }
    let size1 = '';
    let qty1 = '';
    if (userData.tshirts[0].qty > 0) {
        size1 = userData.tshirts[0].size;
        if (userData.tshirts[0].qty == 1) {
            qty1 = `${userData.tshirts[0].qty} piece`;
        } else {
            qty1 = `${userData.tshirts[0].qty} pieces`;
        }
    }
    let size2 = '';
    let qty2 = '';
    if (userData.tshirts[1].qty > 0) {
        size2 = userData.tshirts[1].size;
        if (userData.tshirts[1].qty == 1) {
            qty2 = `${userData.tshirts[1].qty} piece`;
        } else {
            qty2 = `${userData.tshirts[1].qty} pieces`;
        }
    }
    let size3 = '';
    let qty3 = '';
    if (userData.tshirts[2].qty > 0) {
        size3 = userData.tshirts[2].size;
        if (userData.tshirts[2].qty == 1) {
            qty3 = `${userData.tshirts[2].qty} piece`;
        } else {
            qty3 = `${userData.tshirts[2].qty} pieces`;
        }
    }
    let size4 = '';
    let qty4 = '';
    if (userData.tshirts[3].qty > 0) {
        size4 = userData.tshirts[3].size;
        if (userData.tshirts[3].qty == 1) {
            qty4 = `${userData.tshirts[3].qty} piece`;
        } else {
            qty4 = `${userData.tshirts[3].qty} pieces`;
        }
    }

    // Fetch the email template from Google Sheets
    const emailTemplateData = await _getSheetData(sheetEmailTemplate);
    const emailTemplate = emailTemplateData[0][0]; // Assuming the template is in the first cell

    // Replace placeholders in the template
    let emailContent = emailTemplate.replace('{{name}}', name).replace('{{totalFee}}', totalFee);
    emailContent = emailContent.replace('{{namelist}}', namelist);
    emailContent = emailContent.replace('{{size1}}', size1).replace('{{qty1}}', qty1);
    emailContent = emailContent.replace('{{size2}}', size2).replace('{{qty2}}', qty2);
    emailContent = emailContent.replace('{{size3}}', size3).replace('{{qty3}}', qty3);
    emailContent = emailContent.replace('{{size4}}', size4).replace('{{qty4}}', qty4);

    // Handle hidden paragraphs
    const hidden = 'style="display: none;"';
    if (mode == "new") {
        // new mode
        emailContent = emailContent.replace('{{displayControlNew}}', '').replace('{{displayControlChange}}', hidden)
    } else {
        // update mode
        emailContent = emailContent.replace('{{displayControlChange}}', '').replace('{{displayControlNew}}', hidden)
    }
    if (qty1 === '') {
        emailContent = emailContent.replace('{{displayControlTshirt1}}', hidden)
    } else {
        emailContent = emailContent.replace('{{displayControlTshirt1}}', '')
    }
    if (qty2 === '') {
        emailContent = emailContent.replace('{{displayControlTshirt2}}', hidden)
    } else {
        emailContent = emailContent.replace('{{displayControlTshirt2}}', '')
    }
    if (qty3 === '') {
        emailContent = emailContent.replace('{{displayControlTshirt3}}', hidden)
    } else {
        emailContent = emailContent.replace('{{displayControlTshirt3}}', '')
    }
    if (qty4 === '') {
        emailContent = emailContent.replace('{{displayControlTshirt4}}', hidden)
    } else {
        emailContent = emailContent.replace('{{displayControlTshirt4}}', '')
    }

    // Generate QR code from email encrypted with private key
    const encryptedEmail = encryptEmail(userData.email, process.env.QR_PRIVATE_KEY);
    const qrCodeDataUrl = await QRCode.toDataURL(encryptedEmail);
    const qrCodeImageBase64 = qrCodeDataUrl.split(',')[1];  // Stripping the 'data:image/png;base64,' part

    // Send the email
    const mailOptions = {
        from: 'Do not reply - Automatic email of Cornerstone Fellowship <cornerstone.backend@gmail.com>',
        to: email,
        subject: 'Retreat Registration Confirmation',
        html: emailContent,
        attachments: [
            {
              filename: 'qrcode.png',
              content: qrCodeImageBase64, // Get the base64 content
              encoding: 'base64',                            // Specify the encoding type
              cid: 'qrCodeImage'                             // Use the same CID in the <img> tag
            }
          ]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Confirmation email sent successfully');
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
        //numOfHH: row[2],  // Number of households in 3rd column
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
        //TODO unit test only
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
        //TODO: Unit test only
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
            //userData.numOfHH,     // Number of households in the 3rd column
            '',                             // reserve the 3rd column as Suit number for manual data input
            userData.names[0].firstName,    // Name 1 in the 4th column
            userData.names[0].lastName,     // Name 1 in the 5th column
            userData.names[1].firstName,    // Name 2 in the 6th column
            userData.names[1].lastName,     // Name 2 in the 7th column
            userData.names[2].firstName,    // Name 3 in the 8th column
            userData.names[2].lastName,     // Name 3 in the 9th column
            userData.names[3].firstName,    // Name 4 in the 10th column
            userData.names[3].lastName,     // Name 4 in the 11th column
            userData.mobile,            // Mobile in the 12th column
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
            await sendConfirmationEmail(userData, "upd");
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
            await sendConfirmationEmail(userData, "new");
            return res.status(201).json({ message: 'Record saved successfully' });
        }
    } catch (error) {
        console.error('Error during save or update:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Post function to handle check-in
app.post('/checkinQRcode', async (req, res) => {
    console.log("Running check-in QR code route");

    const { staffName, password, encryptedEmail } = req.body;

    // Verify the password
    if (!password || password !== process.env.STAFF_PASSWORD) {
        return res.status(401).json({ message: 'Incorrect staff password' });
    }

    // Decrypt the email address using the private key
    let email;
    try {
        // DecryptEmail is the reverse of encryptEmail
        email = decryptEmail(encryptedEmail, process.env.QR_PRIVATE_KEY);  
    } catch (error) {
        console.error('Error decrypting email:', error);
        return res.status(400).json({ message: 'Invalid QR code' });
    }

    // TODO:  unit test only
    console.log('Decrypted email:', email);
    try {
        // Find the email in the spreadsheet
        const rows = await _getSheetData(sheetName);
        const emailIndex = 0;               // Email in 1st column
        const ClientFirstNameIndex = 3      // FirstName in 4th column
        const ClientLastNameIndex = 4       // FirstName in 5th column
        const staffNameIndex = 23;          // Staff name in 24th column
        const checkinTimestampIndex = 24;   // Check-in timestamp in 25th column

        let rowIndex = -1;
        let existingStaffName = null;
        let existingCheckinTimestamp = null;
        let existingClientName = null;

        for (let i = 0; i < rows.length; i++) {
            if (rows[i][emailIndex] && rows[i][emailIndex].toLowerCase() === email.toLowerCase()) {
                rowIndex = i + 1; // Google Sheets is 1-indexed
                existingClientName = rows[i][ClientFirstNameIndex].toString().trim() + ' ' + rows[i][ClientLastNameIndex].toString().trim()
                existingStaffName = rows[i][staffNameIndex]; // Staff name in 24th column
                existingCheckinTimestamp = rows[i][checkinTimestampIndex]; // Check-in timestamp in 25th column
                break;
            }
        }

        // Handle email found and update check-in
        if (rowIndex > 0) {
            if (!existingCheckinTimestamp) {
                // No check-in yet, update the record
                //const currentTimestamp = new Date().toLocaleString();
                const currentTimestamp = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
                const googleSheetClient = await _getGoogleSheetClient();

                await googleSheetClient.spreadsheets.values.update({
                    spreadsheetId: sheetId,
                    range: `${sheetName}!X${rowIndex}:Y${rowIndex}`, // Columns X and Y are for staffName and check-in timestamp
                    valueInputOption: 'RAW',
                    resource: { values: [[staffName, currentTimestamp]] }, // Staff name in 24th column, timestamp in 25th column
                });

                return res.status(200).json({ message: `${existingClientName}'s Check-in is successful.` });
            } else {
                // Already checked in
                return res.status(200).json({
                    message: `${existingClientName} has already checked in at ${existingCheckinTimestamp} by ${existingStaffName}.`
                });
            }
        } else {
            return res.status(404).json({ message: `${email} has no registration record.` });
        }
    } catch (error) {
        console.error('Error during check-in process:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST function to check staff password
app.post('/loginStaff', (req, res) => {
    console.log("Running login staff route");

    const { staffName, password } = req.body; // Destructure user ID and password from the request body
    //TODO: unit test
    console.log('staffName:', staffName);
    console.log('password:', password);
    // Check if password matches the environment variable
    if (password === process.env.STAFF_PASSWORD) {
        // Return success response if password is correct
        console.log("Staff Login success");
        return res.status(200).json({ message: 'Login success' });
    } else {
        // Return error response if password is incorrect
        console.log("Staff Login failure");
        return res.status(401).json({ message: 'Invalid login ID or password' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
