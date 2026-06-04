const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const store = require('../data/store');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res) => {
    try {
        const users = await store.getAllUsers();
        const safeUsers = users.map(({ password, ...user }) => user);
        res.json(safeUsers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load users.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const user = await store.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const { password, ...safeUser } = user;
        res.json(safeUser);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load user.' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { full_name, username, password, role, phone_number, gender, bio, can_delete_voided } = req.body;

        if (!full_name || !username || !password) {
            return res.status(400).json({ error: 'Full name, username, and password are required.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const validRoles = ['admin', 'cashier'];
        const userRole = role || 'cashier';
        if (!validRoles.includes(userRole)) {
            return res.status(400).json({ error: 'Role must be admin or cashier.' });
        }

        const users = await store.getAllUsers();
        const existing = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (existing) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            id: store.generateId(),
            full_name: full_name.trim(),
            username: username.trim().toLowerCase(),
            password: hashedPassword,
            role: userRole,
            can_delete_voided: can_delete_voided ? 1 : 0,
            phone_number: phone_number || '',
            gender: gender || 'neutral',
            bio: bio || '',
            profile_picture: '',
            is_active: 1,
            last_login: '',
            last_ip: '',
            created_at: store.now(),
            updated_at: store.now()
        };

        await store.createUser(newUser);
        await store.addLog(req.user.id, 'USER_CREATED', `Created user: ${username} (${userRole})`, req.ip, req.headers['user-agent']);

        const { password: _, ...safeUser } = newUser;
        res.status(201).json({ success: true, user: safeUser });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create user.' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const user = await store.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const { full_name, role, is_active, phone_number, gender, bio, can_delete_voided } = req.body;

        if (req.params.id === req.user.id && is_active === false) {
            return res.status(400).json({ error: 'Cannot deactivate your own account.' });
        }
        if (role && !['admin', 'cashier'].includes(role)) {
            return res.status(400).json({ error: 'Role must be admin or cashier.' });
        }

        const updates = {};
        if (full_name !== undefined) updates.full_name = full_name.trim();
        if (role !== undefined) updates.role = role;
        if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
        if (phone_number !== undefined) updates.phone_number = phone_number;
        if (gender !== undefined) updates.gender = gender;
        if (bio !== undefined) updates.bio = bio;
        if (can_delete_voided !== undefined) updates.can_delete_voided = can_delete_voided ? 1 : 0;
        updates.updated_at = store.now();

        await store.updateUser(req.params.id, updates);
        await store.addLog(req.user.id, 'USER_UPDATED', `Updated user: ${user.username}`, req.ip, req.headers['user-agent']);

        const updatedUser = await store.getUserById(req.params.id);
        const { password, ...safeUser } = updatedUser;
        res.json({ success: true, user: safeUser });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update user.' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account.' });
        }

        const user = await store.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        await store.deleteUser(req.params.id);
        await store.addLog(req.user.id, 'USER_DELETED', `Deleted user: ${user.username}`, req.ip, req.headers['user-agent']);

        res.json({ success: true, message: `User ${user.username} deleted successfully.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete user.' });
    }
});

router.post('/:id/reset-password', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'New password is required.' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

        const user = await store.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        await store.updateUser(req.params.id, { password: hashedPassword, updated_at: store.now() });
        await store.addLog(req.user.id, 'USER_PASSWORD_RESET', `Reset password for: ${user.username}`, req.ip, req.headers['user-agent']);

        res.json({ success: true, message: `Password reset for ${user.username}.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reset password.' });
    }
});

module.exports = router;