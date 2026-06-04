const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const adminOnly = [authenticateToken, requireAdmin];

router.get('/', authenticateToken, async (req, res) => {
    try {
        let stations = await store.getAllStations(req.user.role !== 'admin');
        stations.sort((a, b) => a.station_type.localeCompare(b.station_type) || (a.station_number || 0) - (b.station_number || 0));
        res.json(stations);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load stations.' });
    }
});

router.get('/all', ...adminOnly, async (req, res) => {
    try {
        const stations = await store.getAllStations(true);
        stations.sort((a, b) => a.station_type.localeCompare(b.station_type) || (a.station_number || 0) - (b.station_number || 0));
        res.json(stations);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load stations.' });
    }
});

router.post('/', ...adminOnly, async (req, res) => {
    try {
        const { station_name, station_type, station_number } = req.body;
        if (!station_name || !station_type) return res.status(400).json({ error: 'Station name and type are required.' });

        const validTypes = ['PS5', 'PS4', 'VR', 'Pool', 'Foosball', 'Darts', 'Racing', 'Paintball'];
        if (!validTypes.includes(station_type)) {
            return res.status(400).json({ error: `Invalid type. Valid: ${validTypes.join(', ')}` });
        }

        const newStation = {
            id: store.generateId(),
            station_name: station_name.trim(),
            station_type,
            station_number: station_number || null,
            is_active: 1,
            in_use: 0,
            created_at: store.now()
        };

        await store.createStation(newStation);
        await store.addLog(req.user.id, 'STATION_CREATED', `Created station: ${station_name}`, req.ip, req.headers['user-agent']);

        res.status(201).json({ success: true, station: newStation });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create station.' });
    }
});

router.put('/:id', ...adminOnly, async (req, res) => {
    try {
        const station = await store.getStationById(req.params.id);
        if (!station) return res.status(404).json({ error: 'Station not found.' });

        const { station_name, is_active, in_use } = req.body;
        const updates = {};
        
        if (station_name !== undefined) updates.station_name = station_name.trim();
        if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
        if (in_use !== undefined) updates.in_use = in_use ? 1 : 0;

        await store.updateStation(req.params.id, updates);
        await store.addLog(req.user.id, 'STATION_UPDATED', `Updated station: ${station.station_name}`, req.ip, req.headers['user-agent']);

        const updatedStation = await store.getStationById(req.params.id);
        res.json({ success: true, station: updatedStation });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update station.' });
    }
});

router.delete('/:id', ...adminOnly, async (req, res) => {
    try {
        const station = await store.getStationById(req.params.id);
        if (!station) return res.status(404).json({ error: 'Station not found.' });

        await store.deleteStation(req.params.id);
        await store.addLog(req.user.id, 'STATION_DELETED', `Deleted station: ${station.station_name}`, req.ip, req.headers['user-agent']);

        res.json({ success: true, message: `Station "${station.station_name}" deleted.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete station.' });
    }
});

module.exports = router;