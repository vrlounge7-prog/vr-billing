const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');

// Load credentials from .env file
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const MPESA_PASSKEY = process.env.MPESA_PASSKEY;
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '174379';
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'https://yourdomain.com/api/mpesa/callback';
const MPESA_ENV = process.env.MPESA_ENV || 'sandbox';

// Choose the correct API URL based on environment
const MPESA_BASE_URL = MPESA_ENV === 'production' 
    ? 'https://api.safaricom.co.ke' 
    : 'https://sandbox.safaricom.co.ke';

// ===== HELPER FUNCTIONS =====

// Get OAuth token from Safaricom
async function getAccessToken() {
    try {
        const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
        const response = await axios.get(
            `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            { headers: { Authorization: `Basic ${auth}` } }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('M-Pesa Auth Error:', error.response?.data || error.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

// Generate the password needed for STK Push
function generatePassword() {
    const timestamp = getTimestamp();
    const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
    return { password, timestamp };
}

// Generate timestamp in the format Safaricom expects (YYYYMMDDHHmmss)
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// Format Kenyan phone number to 254 format
function formatPhoneNumber(phone) {
    let formatted = phone.replace(/^0+/, '').replace(/^\+/, '').replace(/\s/g, '');
    if (formatted.startsWith('254')) {
        return formatted;
    } else if (formatted.length === 9 && formatted.startsWith('7')) {
        return '254' + formatted;
    } else if (formatted.length === 9 && formatted.startsWith('1')) {
        return '254' + formatted;
    } else if (formatted.length === 10 && formatted.startsWith('0')) {
        return '254' + formatted.substring(1);
    }
    return null;
}

// ===== ROUTES =====

// POST /api/mpesa/stkpush - Send STK Push to customer's phone
router.post('/stkpush', authenticateToken, async (req, res) => {
    try {
        const { phone, amount, accountReference, transactionDesc } = req.body;

        // Validation
        if (!phone || !amount) {
            return res.status(400).json({ 
                success: false, 
                error: 'Phone number and amount are required' 
            });
        }

        // Format the phone number
        const formattedPhone = formatPhoneNumber(phone);
        if (!formattedPhone) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid phone number. Use format: 0712345678 or 254712345678' 
            });
        }

        console.log('Sending STK Push to:', formattedPhone, 'Amount:', amount);

        // Get access token
        const token = await getAccessToken();
        
        // Generate password and timestamp
        const { password, timestamp } = generatePassword();

        // Prepare STK Push request data
        const stkData = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline', // Use 'CustomerBuyGoodsOnline' for Till numbers
            Amount: Math.round(amount), // Must be a whole number
            PartyA: formattedPhone,
            PartyB: MPESA_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: MPESA_CALLBACK_URL,
            AccountReference: accountReference || 'VR Billing',
            TransactionDesc: transactionDesc || 'Game Payment'
        };

        console.log('STK Push Request:', JSON.stringify(stkData, null, 2));

        // Send STK Push request to Safaricom
        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            stkData,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        console.log('STK Push Response:', response.data);

        // Return success
        res.json({
            success: true,
            message: 'STK Push sent! Check your phone and enter your M-Pesa PIN.',
            data: {
                MerchantRequestID: response.data.MerchantRequestID,
                CheckoutRequestID: response.data.CheckoutRequestID,
                ResponseCode: response.data.ResponseCode,
                ResponseDescription: response.data.ResponseDescription,
                CustomerMessage: response.data.CustomerMessage
            }
        });

    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
        
        // Handle specific Safaricom errors
        let errorMessage = 'STK Push failed';
        if (error.response?.data?.errorMessage) {
            errorMessage = error.response.data.errorMessage;
        } else if (error.response?.data?.errorCode) {
            errorMessage = `Error ${error.response.data.errorCode}: ${error.response.data.errorMessage || 'Unknown error'}`;
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage,
            details: error.response?.data || error.message
        });
    }
});

// POST /api/mpesa/stkquery - Check STK Push payment status
router.post('/stkquery', authenticateToken, async (req, res) => {
    try {
        const { checkoutRequestID } = req.body;

        if (!checkoutRequestID) {
            return res.status(400).json({ 
                success: false, 
                error: 'CheckoutRequestID is required' 
            });
        }

        const token = await getAccessToken();
        const { password, timestamp } = generatePassword();

        const queryData = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestID
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
            queryData,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        console.log('STK Query Response:', response.data);

        res.json({
            success: true,
            data: response.data
        });

    } catch (error) {
        console.error('STK Query Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'STK Query failed',
            details: error.response?.data || error.message
        });
    }
});

// POST /api/mpesa/callback - Safaricom sends payment results here
router.post('/callback', async (req, res) => {
    try {
        console.log('=== M-PESA CALLBACK RECEIVED ===');
        console.log('Body:', JSON.stringify(req.body, null, 2));

        const callbackData = req.body.Body?.stkCallback;

        if (!callbackData) {
            console.log('Invalid callback - no stkCallback found');
            return res.json({ ResultCode: 1, ResultDesc: 'Invalid callback data' });
        }

        const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callbackData;

        if (ResultCode === 0) {
            // PAYMENT SUCCESSFUL
            const metadata = {};
            if (CallbackMetadata?.Item) {
                CallbackMetadata.Item.forEach(item => {
                    metadata[item.Name] = item.Value;
                });
            }

            console.log('=== PAYMENT SUCCESSFUL ===');
            console.log('Amount:', metadata.Amount);
            console.log('MpesaReceiptNumber:', metadata.MpesaReceiptNumber);
            console.log('TransactionDate:', metadata.TransactionDate);
            console.log('PhoneNumber:', metadata.PhoneNumber);

            // TODO: Update your database here
            // Example: Update transaction status to 'completed'
            // await store.updateTransactionMpesaStatus(CheckoutRequestID, {
            //     payment_status: 'completed',
            //     mpesa_receipt: metadata.MpesaReceiptNumber,
            //     payment_date: metadata.TransactionDate
            // });

        } else {
            // PAYMENT FAILED OR CANCELLED
            console.log('=== PAYMENT FAILED/CANCELLED ===');
            console.log('ResultCode:', ResultCode);
            console.log('ResultDesc:', ResultDesc);
        }

        // Always respond with this to acknowledge receipt
        res.json({ ResultCode: 0, ResultDesc: 'Callback received successfully' });

    } catch (error) {
        console.error('Callback Error:', error);
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal error' });
    }
});

module.exports = router;