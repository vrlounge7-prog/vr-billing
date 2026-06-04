require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const xss = require('xss');
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('./middleware/auth');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const gameRoutes = require('./routes/games');
const stationRoutes = require('./routes/stations');
const inventoryRoutes = require('./routes/inventory');
const auditRoutes = require('./routes/audit');
const store = require('./data/store');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ MIDDLEWARE ============
app.use((req, res, next) => {
    if (req.body) {
        for (let key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = xss(req.body[key]);
            }
        }
    }
    next();
});

app.use(express.json({ limit: '1mb' }));

// IMPORTANT: Parse raw body for M-Pesa callback BEFORE json middleware
// Safaricom sends callback as JSON, so express.json() handles it fine
// But we need to make sure the callback route works properly

// Static files - admin MUST come before public
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use(express.static(path.join(__dirname, 'public')));

// ============ RATE LIMITERS ============
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/login', loginLimiter);
app.use('/api', apiLimiter);

// ============ ROUTES ============
app.use('/api', healthRoutes);
app.use('/api', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/audit', auditRoutes);
const printRoutes = require('./routes/print');
app.use('/api/print', printRoutes);

// ============ M-PESA ROUTES ============
const mpesaRoutes = require('./routes/mpesa');
app.use('/api/mpesa', mpesaRoutes);

// ============ DELETE TRANSACTION PERMANENTLY - HARD DELETE ============
app.delete('/api/transactions/:id/permanent', authenticateToken, async (req, res) => {
    console.log('='.repeat(50));
    console.log('HARD DELETE /api/transactions/:id/permanent called');
    console.log('Transaction ID:', req.params.id);
    
    try {
        const { adminPassword } = req.body;
        
        // Get the requesting user from database
        const requestingUser = await store.getUserById(req.user.id);
        
        if (!requestingUser) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if (requestingUser.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required.' });
        }

        var hasPermission = requestingUser.can_delete_voided === 1 || requestingUser.username === 'admin';
        if (!hasPermission) {
            return res.status(403).json({ error: 'You do not have permission to delete transactions. Contact System Admin.' });
        }

        if (!adminPassword) {
            return res.status(400).json({ error: 'Password is required.' });
        }

        const isValid = await bcrypt.compare(adminPassword, requestingUser.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password. Use your own admin login password.' });
        }

        const transaction = await store.getTransactionById(req.params.id);
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found.' });
        }
        
        console.log('Transaction found:', transaction.receipt_no);
        console.log('Transaction type:', transaction.is_past ? 'PAST TRANSACTION' : 'REGULAR');

        // HARD DELETE - Remove completely from database
        await store.permanentlyDeleteTransaction(req.params.id);
        console.log('Transaction HARD DELETED from database');

        await store.addLog(req.user.id, 'TRANSACTION_HARD_DELETED',
            `Hard deleted receipt: ${transaction.receipt_no} by ${requestingUser.username}`,
            req.ip, req.headers['user-agent']);
        console.log('Audit log added');

        res.json({ success: true, message: `Transaction ${transaction.receipt_no} permanently deleted.` });
        
    } catch (error) {
        console.error('ERROR in delete endpoint:', error);
        res.status(500).json({ error: 'Failed to delete transaction: ' + error.message });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use('/api/*', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.get('*', (req, res) => {
    if (req.path.startsWith('/admin/')) {
        return res.status(404).send('Admin page not found');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database and start server
async function startServer() {
    await store.ensureDb();
    
    // Verify admin has delete permission
    const admin = await store.getUserByUsername('admin');
    if (admin && admin.can_delete_voided !== 1) {
        await store.updateUser(admin.id, { can_delete_voided: 1 });
        console.log('Admin user updated with delete permission');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n========================================`);
        console.log(`   VR BILLING SYSTEM IS RUNNING!`);
        console.log(`========================================`);
        console.log(`   http://localhost:${PORT}`);
        console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   Database: SQLite3`);
        console.log(`   M-Pesa: ${process.env.MPESA_ENV || 'sandbox'}`);
        console.log(`========================================\n`);
    });
}

startServer();