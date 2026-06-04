const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { authenticateToken } = require('../middleware/auth');

// ============ PAST TRANSACTIONS ROUTES - MUST come before /:id routes ============
router.get('/past', authenticateToken, async (req, res) => {
    try {
        console.log('📊 GET /past - Fetching past transactions');
        
        // Get ALL transactions from database
        const allTransactions = await store.getAll('transactions');
        
        // Ensure we have an array
        if (!allTransactions || !Array.isArray(allTransactions)) {
            console.log('No transactions found or invalid format');
            return res.json([]);
        }
        
        // Filter to only past transactions (is_past = 1)
        const pastTransactions = allTransactions.filter(tx => tx.is_past === 1);
        
        // Sort by date (newest first)
        pastTransactions.sort((a, b) => {
            const dateA = new Date(a.transaction_date + ' ' + (a.transaction_time || '00:00'));
            const dateB = new Date(b.transaction_date + ' ' + (b.transaction_time || '00:00'));
            return dateB - dateA;
        });
        
        console.log(`📊 Past transactions found: ${pastTransactions.length}`);
        
        // Always return an array
        res.json(pastTransactions);
    } catch (error) {
        console.error('Error loading past transactions:', error);
        // Return empty array on error, not an error object
        res.json([]);
    }
});

router.post('/past', authenticateToken, async (req, res) => {
    try {
        console.log('📝 POST /past - Creating past transaction');
        console.log('Request body:', req.body);
        
        const {
            transaction_date, transaction_time, customer_name, customer_phone,
            past_game, station_used, total_amount, amount_paid, payment_method,
            payment_status, cashier_name, mpesa_receipt, notes,
            total_duration_minutes, total_shots
        } = req.body;

        if (!transaction_date) {
            return res.status(400).json({ error: 'Transaction date is required.' });
        }

        if (!past_game) {
            return res.status(400).json({ error: 'Game/Service is required.' });
        }

        if (!total_amount || total_amount <= 0) {
            return res.status(400).json({ error: 'Valid amount is required.' });
        }

        const receiptNo = await store.getNextReceiptNo();
        console.log(`Generated receipt number: ${receiptNo}`);

        const newTx = {
            id: store.generateId(),
            receipt_no: receiptNo,
            customer_name: customer_name || 'Guest',
            customer_phone: customer_phone || '',
            total_amount: total_amount,
            amount_paid: amount_paid || total_amount,
            balance: 0,
            payment_method: payment_method || 'Cash',
            payment_status: payment_status || 'completed',
            cashier_id: req.user.id,
            cashier_name: cashier_name || req.user.full_name,
            transaction_date: transaction_date,
            transaction_time: transaction_time || '00:00',
            items_json: JSON.stringify([{ game_name: past_game, quantity: 1, total_price: total_amount }]),
            station_used: station_used || 'Manual Entry',
            total_duration_minutes: total_duration_minutes || 0,
            total_shots: total_shots || 0,
            credit_details: '',
            mpesa_receipt: mpesa_receipt || '',
            is_void: 0,
            is_past: 1,
            archived: 0,
            notes: notes || '',
            created_at: store.now()
        };

        await store.createTransaction(newTx);
        await store.addLog(req.user.id, 'PAST_TRANSACTION_CREATED', `Recorded past transaction: ${receiptNo}`, req.ip, req.headers['user-agent']);

        console.log(`✅ Past transaction saved: ${receiptNo} for ${customer_name || 'Guest'} on ${transaction_date}`);

        res.status(201).json({ success: true, transaction: newTx });
    } catch (error) {
        console.error('Error creating past transaction:', error);
        res.status(500).json({ error: 'Failed to create past transaction.' });
    }
});

// ============ REGULAR TRANSACTIONS ============
router.get('/', authenticateToken, async (req, res) => {
    try {
        const filters = {
            date: req.query.date,
            status: req.query.status,
            payment_method: req.query.payment_method,
            include_void: req.query.include_void,
            include_past: req.query.include_past,
            search: req.query.search,
            limit: req.query.limit,
            archived: req.query.archived || 'false'
        };

        let transactions = await store.getTransactions(filters);
        
        // Ensure we return an array
        if (!transactions || !Array.isArray(transactions)) {
            transactions = [];
        }
        
        res.json(transactions);
    } catch (error) {
        console.error('Error listing transactions:', error);
        res.json([]);
    }
});

router.get('/export/csv', authenticateToken, async (req, res) => {
    try {
        const filters = { include_void: req.query.include_void || 'false' };
        if (req.query.date) filters.date = req.query.date;
        if (req.query.include_past === 'true') filters.include_past = 'true';

        let transactions = await store.getTransactions(filters);
        
        if (!transactions || !Array.isArray(transactions)) {
            transactions = [];
        }
        
        transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const headers = ['Receipt No', 'Date', 'Time', 'Customer', 'Phone', 'Total', 'Paid', 'Balance', 'Method', 'Status', 'Cashier', 'Station', 'M-Pesa Code', 'Void', 'Past Transaction'];
        const rows = [headers.join(',')];
        transactions.forEach(tx => {
            rows.push([
                tx.receipt_no, tx.transaction_date, tx.transaction_time,
                `"${(tx.customer_name || 'Guest').replace(/"/g, '""')}"`,
                tx.customer_phone || '', tx.total_amount, tx.amount_paid, tx.balance,
                tx.payment_method, tx.payment_status,
                `"${(tx.cashier_name || '').replace(/"/g, '""')}"`,
                `"${(tx.station_used || '').replace(/"/g, '""')}"`,
                tx.mpesa_receipt || '', tx.is_void ? 'YES' : 'NO',
                tx.is_past ? 'YES' : 'NO'
            ].join(','));
        });

        const csv = rows.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="transactions_${req.query.date || 'all'}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to export.' });
    }
});

router.get('/daily-summary/:date', authenticateToken, async (req, res) => {
    try {
        const includePast = req.query.include_past === 'true';
        const summary = await store.getDailySummary(req.params.date, includePast);
        res.json(summary);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to get summary.' });
    }
});

// ============ SINGLE TRANSACTION (must come AFTER specific routes) ============
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const tx = await store.getTransactionById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transaction not found.' });
        res.json(tx);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load transaction.' });
    }
});

router.post('/', authenticateToken, async (req, res) => {
    try {
        const { customer_name, customer_phone, items, total_amount, station_used, payment_method } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required.' });
        }
        if (!total_amount || total_amount <= 0) {
            return res.status(400).json({ error: 'Valid total amount is required.' });
        }
        if (!payment_method) {
            return res.status(400).json({ error: 'Payment method is required.' });
        }

        const receiptNo = await store.getNextReceiptNo();
        const totalDuration = items.reduce((sum, item) => sum + (item.total_duration || 0), 0);
        const totalShots = items.reduce((sum, item) => sum + (item.total_shots || 0), 0);

        const newTx = {
            id: store.generateId(),
            receipt_no: receiptNo,
            customer_name: customer_name || 'Guest',
            customer_phone: customer_phone || '',
            total_amount: total_amount,
            amount_paid: 0,
            balance: 0,
            payment_method: payment_method,
            payment_status: 'pending',
            cashier_id: req.user.id,
            cashier_name: req.user.full_name,
            transaction_date: new Date().toISOString().split('T')[0],
            transaction_time: new Date().toLocaleTimeString(),
            items_json: JSON.stringify(items),
            station_used: station_used || '',
            total_duration_minutes: totalDuration,
            total_shots: totalShots,
            credit_details: '',
            mpesa_receipt: '',
            is_void: 0,
            is_past: 0,
            archived: 0,
            notes: '',
            created_at: store.now()
        };

        await store.createTransaction(newTx);
        await store.addLog(req.user.id, 'TRANSACTION_CREATED', `Created receipt ${receiptNo}`, req.ip, req.headers['user-agent']);
        res.status(201).json({ success: true, transaction: newTx });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create transaction.' });
    }
});

router.post('/:id/verify', authenticateToken, async (req, res) => {
    try {
        const tx = await store.getTransactionById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transaction not found.' });

        const { amount_paid, mpesa_receipt, credit_details } = req.body;
        const paid = amount_paid || tx.total_amount;
        const balance = paid - tx.total_amount;

        await store.updateTransaction(req.params.id, {
            amount_paid: paid,
            balance: balance,
            payment_status: 'completed',
            mpesa_receipt: mpesa_receipt || '',
            credit_details: credit_details ? JSON.stringify(credit_details) : ''
        });

        const updatedTx = await store.getTransactionById(req.params.id);
        await store.addLog(req.user.id, 'PAYMENT_VERIFIED', `Verified payment for ${tx.receipt_no}`, req.ip, req.headers['user-agent']);
        res.json({ success: true, transaction: updatedTx });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to verify payment.' });
    }
});

router.post('/:id/void', authenticateToken, async (req, res) => {
    try {
        const tx = await store.getTransactionById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transaction not found.' });
        if (tx.is_void) return res.status(400).json({ error: 'Transaction is already voided.' });

        await store.updateTransaction(req.params.id, { is_void: 1 });
        await store.addLog(req.user.id, 'TRANSACTION_VOIDED', `Voided receipt ${tx.receipt_no}`, req.ip, req.headers['user-agent']);

        const updatedTx = await store.getTransactionById(req.params.id);
        res.json({ success: true, transaction: updatedTx });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to void transaction.' });
    }
});

router.post('/:id/archive', authenticateToken, async (req, res) => {
    try {
        const tx = await store.getTransactionById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transaction not found.' });

        await store.updateTransaction(req.params.id, { archived: 1 });
        await store.addLog(req.user.id, 'TRANSACTION_ARCHIVED', `Archived receipt ${tx.receipt_no}`, req.ip, req.headers['user-agent']);
        res.json({ success: true, message: 'Transaction archived.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to archive transaction.' });
    }
});

router.post('/:id/unarchive', authenticateToken, async (req, res) => {
    try {
        const tx = await store.getTransactionById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transaction not found.' });

        await store.updateTransaction(req.params.id, { archived: 0 });
        await store.addLog(req.user.id, 'TRANSACTION_UNARCHIVED', `Unarchived receipt ${tx.receipt_no}`, req.ip, req.headers['user-agent']);
        res.json({ success: true, message: 'Transaction unarchived.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to unarchive transaction.' });
    }
});

module.exports = router;