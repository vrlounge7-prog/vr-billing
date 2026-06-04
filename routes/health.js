const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'VR Billing System API is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

router.get('/version', (req, res) => {
    res.json({
        version: '2.0.0',
        name: 'VR Billing System',
        description: 'POS & Management System'
    });
});

module.exports = router;