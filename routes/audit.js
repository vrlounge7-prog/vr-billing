const express = require('express');
const router = express.Router();
const store = require('../data/store');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res) => {
    try {
        const filters = {
            search: req.query.search,
            action: req.query.action,
            user_id: req.query.user_id,
            date_from: req.query.date_from,
            date_to: req.query.date_to,
            limit: req.query.limit
        };
        
        let logs = await store.getAuditLogs(filters);
        const users = await store.getAllUsers();
        const userMap = {};
        users.forEach(u => { userMap[u.id] = u.full_name || u.username; });

        logs = logs.map(log => ({ ...log, user_name: userMap[log.user_id] || log.user_id || 'System' }));
        res.json(logs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load audit logs.' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { adminPassword } = req.body;
        const users = await store.getAllUsers();
        const requestingUser = users.find(u => u.id === req.user.id);

        if (!adminPassword) {
            return res.status(400).json({ error: 'Password is required.' });
        }

        const isValid = await bcrypt.compare(adminPassword, requestingUser.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password.' });
        }

        await store.deleteAuditLog(req.params.id);
        res.json({ success: true, message: 'Log deleted.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete log.' });
    }
});

router.get('/actions', async (req, res) => {
    try {
        const actions = await store.getAuditActions();
        res.json(actions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load actions.' });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const stats = await store.getAuditStats();
        res.json(stats);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load stats.' });
    }
});

router.get('/export/csv', async (req, res) => {
    try {
        const filters = {
            date_from: req.query.date_from,
            date_to: req.query.date_to
        };
        
        let logs = await store.getAuditLogs(filters);
        const users = await store.getAllUsers();
        const userMap = {};
        users.forEach(u => { userMap[u.id] = u.full_name || u.username; });
        logs = logs.map(log => ({ ...log, user_name: userMap[log.user_id] || log.user_id || 'System' }));
        logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const rows = [['Date/Time', 'User', 'Action', 'Details', 'IP Address'].join(',')];
        logs.forEach(log => {
            rows.push([
                `"${new Date(log.created_at).toLocaleString()}"`,
                `"${(log.user_name || 'System').replace(/"/g, '""')}"`,
                `"${log.action}"`,
                `"${(log.details || '').replace(/"/g, '""')}"`,
                log.ip_address || ''
            ].join(','));
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(rows.join('\n'));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to export audit logs.' });
    }
});

module.exports = router;