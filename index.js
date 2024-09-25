require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

const cors = require('cors');
app.use(cors());

// Middleware to parse JSON bodies
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

// Request OTP Route
app.post('/sendOTP', (req, res) => {
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

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(error);
      return res.status(500).send('Failed to send OTP');
    }
    console.log(`OTP sent: ${otp}`);
    res.status(200).send('OTP sent to your email');
  });
});

// Verify OTP Route
app.post('/verifyOTP', (req, res) => {
  console.log("Running Verify OTP Route");
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).send('Email and OTP are required');
  }

  // Check if OTP matches
  const storedOtp = otpStore[email];
  if (storedOtp && storedOtp == otp) {
    res.status(200).send('Login successful');
  } else {
    res.status(400).send('Invalid OTP');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
