const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { authenticateToken } = require('../middleware/auth');

// ============ PAST TRANSACTIONS ROUTES ============
router.get('/past', authenticateToken, async (req, res) => {
    try {
        console.log('📊 GET /past - Fetching past transactions');
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        
        const allTransactions = await store.getAll('transactions');
        
        if (!allTransactions || !Array.isArray(allTransactions)) {
            console.log('No transactions found or invalid format');
            return res.json({ data: [], total: 0, page: 1, totalPages: 0 });
        }
        
        let pastTransactions = allTransactions.filter(tx => tx.is_past === 1);
        
        pastTransactions.sort((a, b) => {
            const dateA = new Date(a.transaction_date + ' ' + (a.transaction_time || '00:00'));
            const dateB = new Date(b.transaction_date + ' ' + (b.transaction_time || '00:00'));
            return dateB - dateA;
        });
        
        const total = pastTransactions.length;
        const paginatedData = pastTransactions.slice(offset, offset + limit);
        
        console.log(`📊 Past transactions found: ${total}, showing page ${page} (${limit} items)`);
        
        res.json({
            data: paginatedData,
            total: total,
            page: page,
            limit: limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Error loading past transactions:', error);
        res.json({ data: [], total: 0, page: 1, totalPages: 0 });
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
            past_game: past_game,
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

// ============ REGULAR TRANSACTIONS with PAGINATION ============
router.get('/', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const offset = (page - 1) * limit;
        
        const filters = {
            date: req.query.date,
            status: req.query.status,
            payment_method: req.query.payment_method,
            include_void: req.query.include_void,
            include_past: req.query.include_past,
            search: req.query.search,
            archived: req.query.archived || 'false'
        };

        let transactions = await store.getTransactions(filters);
        
        if (!transactions || !Array.isArray(transactions)) {
            transactions = [];
        }
        
        const total = transactions.length;
        const paginatedData = transactions.slice(offset, offset + limit);
        
        res.json({
            data: paginatedData,
            total: total,
            page: page,
            limit: limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Error listing transactions:', error);
        res.json({ data: [], total: 0, page: 1, totalPages: 0 });
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

// ============ SINGLE TRANSACTION ============
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

// ============ CREATE TRANSACTION - NO STATION LOCKING! ============
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { customer_name, customer_phone, items, total_amount, station_used, payment_method, split_payment } = req.body;
        
        console.log('📝 CREATE TRANSACTION - Request received');
        console.log('  Customer:', customer_name || 'Guest');
        console.log('  Total Amount:', total_amount);
        console.log('  Payment Method:', payment_method);
        console.log('  Items count:', items ? items.length : 0);
        
        // Validation
        if (!items || !Array.isArray(items) || items.length === 0) {
            console.log('  ERROR: No items in cart');
            return res.status(400).json({ error: 'At least one item is required.' });
        }
        if (!total_amount || total_amount <= 0) {
            console.log('  ERROR: Invalid amount');
            return res.status(400).json({ error: 'Valid total amount is required.' });
        }
        if (!payment_method) {
            console.log('  ERROR: No payment method');
            return res.status(400).json({ error: 'Payment method is required.' });
        }

        // Generate receipt number
        const receiptNo = await store.getNextReceiptNo();
        console.log(`  Receipt Number: ${receiptNo}`);
        
        const totalDuration = items.reduce((sum, item) => sum + (item.total_duration || 0), 0);
        const totalShots = items.reduce((sum, item) => sum + (item.total_shots || 0), 0);

        // Handle split payment details
        let creditDetails = '';
        let splitDetails = null;
        
        if (payment_method === 'Split' && split_payment) {
            splitDetails = {
                type: 'split',
                cash: split_payment.cash || 0,
                mpesa: split_payment.mpesa || 0,
                total: split_payment.total || total_amount,
                mpesa_receipt: '' // Will be filled during verification
            };
            creditDetails = JSON.stringify(splitDetails);
            console.log('  Split Payment Details:', splitDetails);
        }

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
            credit_details: creditDetails,
            mpesa_receipt: '',
            is_void: 0,
            is_past: 0,
            archived: 0,
            notes: '',
            past_game: '',
            created_at: store.now()
        };

        await store.createTransaction(newTx);
        await store.addLog(req.user.id, 'TRANSACTION_CREATED', `Created receipt ${receiptNo}`, req.ip, req.headers['user-agent']);
        
        console.log(`✅ TRANSACTION CREATED SUCCESSFULLY: ${receiptNo}`);
        res.status(201).json({ success: true, transaction: newTx });
        
    } catch (error) {
        console.error('❌ ERROR creating transaction:', error);
        console.error('  Error message:', error.message);
        console.error('  Stack trace:', error.stack);
        res.status(500).json({ error: 'Failed to create transaction: ' + error.message });
    }
});

// ============ VERIFY PAYMENT ============
router.post('/:id/verify', authenticateToken, async (req, res) => {
    try {
        const tx = await store.getTransactionById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transaction not found.' });

        const { amount_paid, mpesa_receipt, credit_details, split_cash, split_mpesa } = req.body;
        const paid = amount_paid || tx.total_amount;
        const balance = paid - tx.total_amount;

        let creditDetails = credit_details || '';
        let paymentMethod = tx.payment_method;

        // Handle split payment verification
        if (tx.payment_method === 'Split' || (split_cash !== undefined && split_mpesa !== undefined)) {
            let splitData = {};
            try {
                // Try to parse existing credit_details
                if (tx.credit_details && typeof tx.credit_details === 'string') {
                    splitData = JSON.parse(tx.credit_details);
                } else if (tx.credit_details && typeof tx.credit_details === 'object') {
                    splitData = tx.credit_details;
                }
            } catch (e) {
                splitData = {};
            }

            // Update with verification data
            splitData.type = 'split';
            splitData.cash = split_cash || splitData.cash || 0;
            splitData.mpesa = split_mpesa || splitData.mpesa || 0;
            splitData.total = (splitData.cash || 0) + (splitData.mpesa || 0);
            if (mpesa_receipt) {
                splitData.mpesa_receipt = mpesa_receipt;
            }
            creditDetails = JSON.stringify(splitData);
            paymentMethod = 'Split (Cash + M-Pesa)';
            
            console.log('Split payment verified:', splitData);
        }

        await store.updateTransaction(req.params.id, {
            amount_paid: paid,
            balance: balance,
            payment_status: 'completed',
            mpesa_receipt: mpesa_receipt || '',
            credit_details: creditDetails,
            payment_method: paymentMethod
        });

        const updatedTx = await store.getTransactionById(req.params.id);
        await store.addLog(req.user.id, 'PAYMENT_VERIFIED', `Verified payment for ${tx.receipt_no}`, req.ip, req.headers['user-agent']);
        res.json({ success: true, transaction: updatedTx });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to verify payment.' });
    }
});

// ============ VOID TRANSACTION ============
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

// ============ ARCHIVE / UNARCHIVE ============
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
