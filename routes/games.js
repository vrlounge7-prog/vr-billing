const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const adminOnly = [authenticateToken, requireAdmin];

router.get('/', authenticateToken, async (req, res) => {
    try {
        let games = await store.getAllGames(req.user.role !== 'admin');
        games.sort((a, b) => a.category.localeCompare(b.category) || a.price_ksh - b.price_ksh);
        res.json(games);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load games.' });
    }
});

router.get('/all', ...adminOnly, async (req, res) => {
    try {
        const games = await store.getAllGames(true);
        games.sort((a, b) => a.category.localeCompare(b.category) || a.price_ksh - b.price_ksh);
        res.json(games);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load games.' });
    }
});

router.post('/', ...adminOnly, async (req, res) => {
    try {
        const { category, sub_category, duration_or_quantity, price_ksh } = req.body;
        if (!category || !sub_category || price_ksh === undefined) {
            return res.status(400).json({ error: 'Category, sub_category, and price_ksh are required.' });
        }
        if (price_ksh < 0) return res.status(400).json({ error: 'Price cannot be negative.' });

        const newGame = {
            id: store.generateId(),
            category: category.trim(),
            sub_category: sub_category.trim(),
            duration_or_quantity: duration_or_quantity || '',
            price_ksh: parseInt(price_ksh),
            is_active: 1,
            created_at: store.now()
        };

        await store.createGame(newGame);
        await store.addLog(req.user.id, 'GAME_CREATED', `Created game: ${sub_category}`, req.ip, req.headers['user-agent']);

        res.status(201).json({ success: true, game: newGame });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create game.' });
    }
});

router.put('/:id', ...adminOnly, async (req, res) => {
    try {
        const game = await store.getGameById(req.params.id);
        if (!game) return res.status(404).json({ error: 'Game not found.' });

        const { category, sub_category, duration_or_quantity, price_ksh, is_active } = req.body;
        const updates = {};
        
        if (category !== undefined) updates.category = category.trim();
        if (sub_category !== undefined) updates.sub_category = sub_category.trim();
        if (duration_or_quantity !== undefined) updates.duration_or_quantity = duration_or_quantity;
        if (price_ksh !== undefined) {
            if (price_ksh < 0) return res.status(400).json({ error: 'Price cannot be negative.' });
            updates.price_ksh = parseInt(price_ksh);
        }
        if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;

        await store.updateGame(req.params.id, updates);
        await store.addLog(req.user.id, 'GAME_UPDATED', `Updated game: ${game.sub_category}`, req.ip, req.headers['user-agent']);

        const updatedGame = await store.getGameById(req.params.id);
        res.json({ success: true, game: updatedGame });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update game.' });
    }
});

router.delete('/:id', ...adminOnly, async (req, res) => {
    try {
        const game = await store.getGameById(req.params.id);
        if (!game) return res.status(404).json({ error: 'Game not found.' });

        await store.deleteGame(req.params.id);
        await store.addLog(req.user.id, 'GAME_DELETED', `Deleted game: ${game.sub_category}`, req.ip, req.headers['user-agent']);

        res.json({ success: true, message: `Game "${game.sub_category}" deleted.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete game.' });
    }
});

module.exports = router;