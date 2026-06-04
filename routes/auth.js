const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const store = require('../data/store');
const { generateToken, authenticateToken } = require('../middleware/auth');

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const user = await store.getUserByUsername(username);
        
        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            await store.addLog(user.id || 'unknown', 'LOGIN_FAILED', `Failed login attempt for ${username}`, req.ip, req.headers['user-agent']);
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        await store.updateUser(user.id, {
            last_login: store.now(),
            last_ip: req.ip || 'unknown'
        });

        const token = generateToken(user);
        await store.addLog(user.id, 'LOGIN_SUCCESS', `User ${username} logged in successfully`, req.ip, req.headers['user-agent']);

        const { password: _, ...userData } = user;
        res.json({ success: true, token, user: userData });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

router.get('/me', authenticateToken, async (req, res) => {
    const user = await store.getUserById(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }
    const { password, ...userData } = user;
    res.json(userData);
});

router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required.' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
        }

        const user = await store.getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }

        const salt = await bcrypt.genSalt(12);
        const hash = await bcrypt.hash(newPassword, salt);

        await store.updateUser(req.user.id, { password: hash, updated_at: store.now() });
        await store.addLog(req.user.id, 'PASSWORD_CHANGED', 'User changed their password', req.ip, req.headers['user-agent']);

        res.json({ success: true, message: 'Password changed successfully.' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

router.post('/logout', authenticateToken, async (req, res) => {
    await store.addLog(req.user.id, 'LOGOUT', `User ${req.user.username} logged out`, req.ip, req.headers['user-agent']);
    res.json({ success: true, message: 'Logged out successfully.' });
});

router.get('/verify-token', authenticateToken, (req, res) => {
    res.json({
        valid: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role,
            full_name: req.user.full_name
        }
    });
});

module.exports = router;