// ============ DATABASE SELECTION ============
// Automatically choose between SQLite (local) and Supabase PostgreSQL (cloud)
let database;

if (process.env.DATABASE_URL) {
    console.log('✅ Using Supabase PostgreSQL database (Cloud)');
    database = require('./database-pg');
} else {
    console.log('📁 Using SQLite database (Local file)');
    database = require('./database');
}

const { v4: uuidv4 } = require('uuid');

let dbInitialized = false;

async function ensureDb() {
    if (!dbInitialized) {
        await database.initDatabase();
        dbInitialized = true;
    }
}

function generateId() {
    return uuidv4();
}

function generateReceiptNo() {
    return `VR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function now() {
    return new Date().toISOString();
}

async function addLog(userId, action, details, ipAddress, userAgent) {
    await ensureDb();
    await database.insertLog({
        id: generateId(),
        user_id: userId,
        action: action,
        details: details,
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: now()
    });
}

// ============ USER FUNCTIONS ============
async function getUserByUsername(username) {
    await ensureDb();
    return await database.getUserByUsername(username);
}

async function getUserById(id) {
    await ensureDb();
    return await database.getUserById(id);
}

async function getAllUsers() {
    await ensureDb();
    return await database.getAllUsers();
}

async function updateUser(id, data) {
    await ensureDb();
    return await database.updateUser(id, data);
}

async function createUser(userData) {
    await ensureDb();
    return await database.createUser(userData);
}

async function deleteUser(id) {
    await ensureDb();
    return await database.deleteUser(id);
}

// ============ GAME FUNCTIONS ============
async function getAllGames(includeInactive = false) {
    await ensureDb();
    return await database.getAllGames(includeInactive);
}

async function getGameById(id) {
    await ensureDb();
    return await database.getGameById(id);
}

async function createGame(gameData) {
    await ensureDb();
    return await database.createGame(gameData);
}

async function updateGame(id, gameData) {
    await ensureDb();
    return await database.updateGame(id, gameData);
}

async function deleteGame(id) {
    await ensureDb();
    return await database.deleteGame(id);
}

// ============ STATION FUNCTIONS ============
async function getAllStations(includeInactive = false) {
    await ensureDb();
    return await database.getAllStations(includeInactive);
}

async function getStationById(id) {
    await ensureDb();
    return await database.getStationById(id);
}

async function createStation(stationData) {
    await ensureDb();
    return await database.createStation(stationData);
}

async function updateStation(id, stationData) {
    await ensureDb();
    return await database.updateStation(id, stationData);
}

async function deleteStation(id) {
    await ensureDb();
    return await database.deleteStation(id);
}

// ============ TRANSACTION FUNCTIONS ============
async function createTransaction(txData) {
    await ensureDb();
    return await database.insertTransaction(txData);
}

async function updateTransaction(id, txData) {
    await ensureDb();
    return await database.updateTransaction(id, txData);
}

async function permanentlyDeleteTransaction(id) {
    await ensureDb();
    console.log('store.permanentlyDeleteTransaction called for ID:', id);
    return await database.hardDeleteTransaction(id);
}

async function getTransactions(filters = {}) {
    await ensureDb();
    return await database.getTransactions(filters);
}

async function getTransactionById(id) {
    await ensureDb();
    return await database.getTransactionById(id);
}

async function getDailySummary(date, includePast = false) {
    await ensureDb();
    return await database.getDailySummary(date, includePast);
}

async function getNextReceiptNo() {
    await ensureDb();
    return await database.getNextReceiptNo();
}

// ============ INVENTORY FUNCTIONS ============
async function getAllInventory() {
    await ensureDb();
    return await database.getAllInventory();
}

async function getInventoryById(id) {
    await ensureDb();
    return await database.getInventoryById(id);
}

async function createInventoryItem(itemData) {
    await ensureDb();
    return await database.createInventoryItem(itemData);
}

async function updateInventoryItem(id, itemData) {
    await ensureDb();
    return await database.updateInventoryItem(id, itemData);
}

async function deleteInventoryItem(id) {
    await ensureDb();
    return await database.deleteInventoryItem(id);
}

// ============ AUDIT FUNCTIONS ============
async function getAuditLogs(filters = {}) {
    await ensureDb();
    return await database.getLogs(filters);
}

async function deleteAuditLog(id) {
    await ensureDb();
    return await database.deleteAuditLog(id);
}

async function getAuditActions() {
    await ensureDb();
    const logs = await database.getAll('logs');
    const actions = [...new Set(logs.map(log => log.action))];
    return actions.sort();
}

async function getAuditStats() {
    await ensureDb();
    const logs = await database.getAll('logs');
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(log => log.created_at.startsWith(today));
    const actions = {};
    todayLogs.forEach(log => { actions[log.action] = (actions[log.action] || 0) + 1; });
    const sortedActions = Object.entries(actions).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([action, count]) => ({ action, count }));
    return { total_logs: logs.length, today_logs: todayLogs.length, top_actions: sortedActions };
}

// ============ GENERAL GET ALL FUNCTION ============
async function getAll(table, where = '') {
    await ensureDb();
    return await database.getAll(table, where);
}

module.exports = {
    ensureDb,
    generateId,
    generateReceiptNo,
    now,
    addLog,
    getUserByUsername,
    getUserById,
    getAllUsers,
    updateUser,
    createUser,
    deleteUser,
    getAllGames,
    getGameById,
    createGame,
    updateGame,
    deleteGame,
    getAllStations,
    getStationById,
    createStation,
    updateStation,
    deleteStation,
    createTransaction,
    updateTransaction,
    permanentlyDeleteTransaction,
    getTransactions,
    getTransactionById,
    getDailySummary,
    getNextReceiptNo,
    getAllInventory,
    getInventoryById,
    createInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    getAuditLogs,
    deleteAuditLog,
    getAuditActions,
    getAuditStats,
    getAll
};