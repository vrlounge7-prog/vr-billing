const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const adminOnly = [authenticateToken, requireAdmin];

router.get('/', authenticateToken, async (req, res) => {
    try {
        let inventory = await store.getAllInventory();
        const stations = await store.getAllStations(true);
        inventory = inventory.map(item => {
            const station = stations.find(s => s.id === item.station_id);
            return { ...item, station_name: station ? station.station_name : 'Unknown' };
        });
        res.json(inventory);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load inventory.' });
    }
});

router.post('/', ...adminOnly, async (req, res) => {
    try {
        const { station_id, item_type, item_name, quantity, notes } = req.body;
        if (!station_id || !item_name) {
            return res.status(400).json({ error: 'Station ID and item name are required.' });
        }

        const stations = await store.getAllStations(true);
        if (!stations.find(s => s.id === station_id)) {
            return res.status(404).json({ error: 'Station not found.' });
        }

        const newItem = {
            id: store.generateId(),
            station_id,
            item_type: item_type || '',
            item_name: item_name.trim(),
            quantity: parseInt(quantity) || 0,
            notes: notes || '',
            last_updated: store.now()
        };

        await store.createInventoryItem(newItem);
        await store.addLog(req.user.id, 'INVENTORY_ADDED', `Added: ${item_name}`, req.ip, req.headers['user-agent']);

        res.status(201).json({ success: true, item: newItem });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to add inventory item.' });
    }
});

router.put('/:id', ...adminOnly, async (req, res) => {
    try {
        const item = await store.getInventoryById(req.params.id);
        if (!item) return res.status(404).json({ error: 'Inventory item not found.' });

        const { item_name, quantity, notes } = req.body;
        const updates = { last_updated: store.now() };
        
        if (item_name !== undefined) updates.item_name = item_name.trim();
        if (quantity !== undefined) updates.quantity = parseInt(quantity);
        if (notes !== undefined) updates.notes = notes;

        await store.updateInventoryItem(req.params.id, updates);
        await store.addLog(req.user.id, 'INVENTORY_UPDATED', `Updated: ${item.item_name}`, req.ip, req.headers['user-agent']);

        const updatedItem = await store.getInventoryById(req.params.id);
        res.json({ success: true, item: updatedItem });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update inventory item.' });
    }
});

router.delete('/:id', ...adminOnly, async (req, res) => {
    try {
        const item = await store.getInventoryById(req.params.id);
        if (!item) return res.status(404).json({ error: 'Inventory item not found.' });

        await store.deleteInventoryItem(req.params.id);
        await store.addLog(req.user.id, 'INVENTORY_DELETED', `Deleted: ${item.item_name}`, req.ip, req.headers['user-agent']);

        res.json({ success: true, message: `Item "${item.item_name}" deleted.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete inventory item.' });
    }
});

module.exports = router;