// data/database-pg.js
// PostgreSQL version for Supabase

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

let pool = null;
let dbInitialized = false;

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 10,
            min: 2
        });
        
        // Test connection
        pool.on('error', (err) => {
            console.error('Unexpected database error:', err);
        });
    }
    return pool;
}

async function initDatabase() {
    if (dbInitialized) return;
    
    console.log('🔄 Initializing Supabase PostgreSQL connection...');
    try {
        const result = await query('SELECT NOW()');
        console.log('✅ Supabase connection successful');
        dbInitialized = true;
    } catch (err) {
        console.error('❌ Supabase connection failed:', err.message);
        throw err;
    }
}

async function query(text, params) {
    const client = await getPool().connect();
    const start = Date.now();
    try {
        const res = await client.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.log('Slow query:', { text, duration, rows: res.rowCount });
        }
        return res;
    } finally {
        client.release();
    }
}

function generateId() {
    return uuidv4();
}

// ============ USER FUNCTIONS ============
async function getUserByUsername(username) {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0];
}

async function getUserById(id) {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
}

async function getAllUsers() {
    const result = await query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
}

async function updateUser(id, fields) {
    const allowedFields = ['full_name', 'username', 'password', 'role', 'can_delete_voided', 
                           'phone_number', 'gender', 'bio', 'profile_picture', 'is_active', 
                           'last_login', 'last_ip', 'updated_at'];
    
    const updates = [];
    const values = [];
    let idx = 1;
    
    for (const [key, value] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
            updates.push(`${key} = $${idx}`);
            values.push(value);
            idx++;
        }
    }
    
    if (updates.length === 0) return;
    
    values.push(id);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
}

async function createUser(user) {
    const queryText = `
        INSERT INTO users (id, full_name, username, password, role, can_delete_voided, 
                          phone_number, gender, bio, profile_picture, is_active, 
                          last_login, last_ip, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;
    await query(queryText, [
        user.id, user.full_name, user.username, user.password, user.role,
        user.can_delete_voided, user.phone_number, user.gender, user.bio,
        user.profile_picture, user.is_active, user.last_login, user.last_ip,
        user.created_at, user.updated_at
    ]);
}

async function deleteUser(id) {
    await query('DELETE FROM users WHERE id = $1', [id]);
}

// ============ GAME FUNCTIONS ============
async function getAllGames(includeInactive = false) {
    let sql = 'SELECT * FROM games';
    if (!includeInactive) {
        sql += ' WHERE is_active = 1';
    }
    sql += ' ORDER BY category, price_ksh';
    const result = await query(sql);
    return result.rows;
}

async function getGameById(id) {
    const result = await query('SELECT * FROM games WHERE id = $1', [id]);
    return result.rows[0];
}

async function createGame(game) {
    const queryText = `
        INSERT INTO games (id, category, sub_category, duration_or_quantity, price_ksh, 
                          is_active, platform, is_fixed, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await query(queryText, [
        game.id, game.category, game.sub_category, game.duration_or_quantity,
        game.price_ksh, game.is_active, game.platform || '', game.is_fixed || 0,
        game.created_at
    ]);
}

async function updateGame(id, fields) {
    const allowedFields = ['category', 'sub_category', 'duration_or_quantity', 'price_ksh', 
                           'is_active', 'platform', 'is_fixed'];
    
    const updates = [];
    const values = [];
    let idx = 1;
    
    for (const [key, value] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
            updates.push(`${key} = $${idx}`);
            values.push(value);
            idx++;
        }
    }
    
    if (updates.length === 0) return;
    
    values.push(id);
    await query(`UPDATE games SET ${updates.join(', ')} WHERE id = $${idx}`, values);
}

async function deleteGame(id) {
    await query('DELETE FROM games WHERE id = $1', [id]);
}

// ============ STATION FUNCTIONS ============
async function getAllStations(includeInactive = false) {
    let sql = 'SELECT * FROM stations';
    if (!includeInactive) {
        sql += ' WHERE is_active = 1';
    }
    sql += ' ORDER BY station_type, station_number';
    const result = await query(sql);
    return result.rows;
}

async function getStationById(id) {
    const result = await query('SELECT * FROM stations WHERE id = $1', [id]);
    return result.rows[0];
}

async function createStation(station) {
    const queryText = `
        INSERT INTO stations (id, station_name, station_type, station_number, is_active, in_use, setup_time, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    await query(queryText, [
        station.id, station.station_name, station.station_type, station.station_number,
        station.is_active, station.in_use, station.setup_time || 2, station.created_at
    ]);
}

async function updateStation(id, fields) {
    const allowedFields = ['station_name', 'station_type', 'station_number', 'is_active', 'in_use', 'setup_time'];
    
    const updates = [];
    const values = [];
    let idx = 1;
    
    for (const [key, value] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
            updates.push(`${key} = $${idx}`);
            values.push(value);
            idx++;
        }
    }
    
    if (updates.length === 0) return;
    
    values.push(id);
    await query(`UPDATE stations SET ${updates.join(', ')} WHERE id = $${idx}`, values);
}

async function deleteStation(id) {
    await query('DELETE FROM stations WHERE id = $1', [id]);
}

// ============ TRANSACTION FUNCTIONS ============
async function insertTransaction(tx) {
    const queryText = `
        INSERT INTO transactions (
            id, receipt_no, customer_name, customer_phone, total_amount, amount_paid, balance,
            payment_method, payment_status, cashier_id, cashier_name, transaction_date,
            transaction_time, items_json, station_used, total_duration_minutes, total_shots,
            credit_details, mpesa_receipt, is_void, is_past, archived, notes, past_game, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
    `;
    await query(queryText, [
        tx.id, tx.receipt_no, tx.customer_name, tx.customer_phone, tx.total_amount,
        tx.amount_paid, tx.balance, tx.payment_method, tx.payment_status, tx.cashier_id,
        tx.cashier_name, tx.transaction_date, tx.transaction_time, tx.items_json,
        tx.station_used, tx.total_duration_minutes || 0, tx.total_shots || 0,
        tx.credit_details || '', tx.mpesa_receipt || '', tx.is_void || 0,
        tx.is_past || 0, tx.archived || 0, tx.notes || '', tx.past_game || '', tx.created_at
    ]);
}

async function updateTransaction(id, fields) {
    const allowedFields = ['amount_paid', 'balance', 'payment_status', 'mpesa_receipt', 
                           'credit_details', 'is_void', 'archived', 'notes'];
    
    const updates = [];
    const values = [];
    let idx = 1;
    
    for (const [key, value] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
            updates.push(`${key} = $${idx}`);
            values.push(value);
            idx++;
        }
    }
    
    if (updates.length === 0) return;
    
    values.push(id);
    await query(`UPDATE transactions SET ${updates.join(', ')} WHERE id = $${idx}`, values);
}

async function getTransactionById(id) {
    const result = await query('SELECT * FROM transactions WHERE id = $1', [id]);
    return result.rows[0];
}

async function getTransactions(filters = {}) {
    let sql = 'SELECT * FROM transactions WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (filters.date) {
        sql += ` AND transaction_date = $${paramIndex}`;
        params.push(filters.date);
        paramIndex++;
    }
    if (filters.status) {
        sql += ` AND payment_status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
    }
    if (filters.payment_method) {
        sql += ` AND payment_method = $${paramIndex}`;
        params.push(filters.payment_method);
        paramIndex++;
    }
    if (filters.include_void !== 'true') {
        sql += ` AND is_void = 0`;
    }
    if (filters.include_past !== 'true') {
        sql += ` AND is_past = 0`;
    }
    if (filters.archived === 'true') {
        sql += ` AND archived = 1`;
    } else if (filters.archived === 'false') {
        sql += ` AND archived = 0`;
    }
    if (filters.search) {
        sql += ` AND (receipt_no LIKE $${paramIndex} OR customer_name LIKE $${paramIndex + 1} OR 
                customer_phone LIKE $${paramIndex + 2} OR cashier_name LIKE $${paramIndex + 3} OR 
                payment_method LIKE $${paramIndex + 4})`;
        const search = `%${filters.search}%`;
        params.push(search, search, search, search, search);
        paramIndex += 5;
    }
    
    sql += ` ORDER BY created_at DESC`;
    
    if (filters.limit && !isNaN(parseInt(filters.limit))) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(parseInt(filters.limit));
    }
    
    const result = await query(sql, params);
    return result.rows;
}

async function getNextReceiptNo() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const prefix = `${year}${month}${day}`;
    
    try {
        const result = await query(
            `UPDATE receipt_sequence 
             SET last_number = last_number + 1, updated_at = NOW() 
             WHERE id = 1 
             RETURNING last_number`
        );
        
        let nextNum = 1;
        if (result.rows.length > 0) {
            nextNum = result.rows[0].last_number;
        } else {
            await query(`INSERT INTO receipt_sequence (id, last_number, updated_at) VALUES (1, 1, NOW())`);
            nextNum = 1;
        }
        
        return `${prefix}-${String(nextNum).padStart(6, '0')}`;
    } catch (err) {
        console.error('Error getting receipt number:', err);
        // Fallback: use timestamp-based receipt number
        return `${prefix}-${Date.now()}`;
    }
}

async function hardDeleteTransaction(id) {
    console.log('hardDeleteTransaction called for ID:', id);
    await query('DELETE FROM transactions WHERE id = $1', [id]);
    console.log('hardDeleteTransaction successful for ID:', id);
}

async function getDailySummary(date, includePast = false) {
    let sql = `
        SELECT 
            COUNT(*) as transaction_count,
            COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as cash,
            COALESCE(SUM(CASE WHEN payment_method = 'Mpesa' THEN total_amount ELSE 0 END), 0) as mpesa,
            COALESCE(SUM(CASE WHEN payment_method = 'Credit' THEN total_amount ELSE 0 END), 0) as credit,
            COALESCE(SUM(total_amount), 0) as total
        FROM transactions 
        WHERE transaction_date = $1 AND is_void = 0 AND payment_status = 'completed'
    `;
    
    if (!includePast) {
        sql += ` AND is_past = 0`;
    }
    
    const result = await query(sql, [date]);
    return result.rows[0] || { transaction_count: 0, cash: 0, mpesa: 0, credit: 0, total: 0 };
}

// ============ LOG FUNCTIONS ============
async function insertLog(log) {
    const queryText = `
        INSERT INTO logs (id, user_id, action, details, ip_address, user_agent, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await query(queryText, [
        log.id, log.user_id, log.action, log.details, log.ip_address, log.user_agent, log.created_at
    ]);
}

async function getLogs(filters = {}) {
    let sql = 'SELECT * FROM logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (filters.search) {
        sql += ` AND (action ILIKE $${paramIndex} OR details ILIKE $${paramIndex + 1})`;
        const search = `%${filters.search}%`;
        params.push(search, search);
        paramIndex += 2;
    }
    if (filters.action) {
        sql += ` AND action = $${paramIndex}`;
        params.push(filters.action);
        paramIndex++;
    }
    if (filters.user_id) {
        sql += ` AND user_id = $${paramIndex}`;
        params.push(filters.user_id);
        paramIndex++;
    }
    if (filters.date_from) {
        sql += ` AND created_at >= $${paramIndex}`;
        params.push(filters.date_from);
        paramIndex++;
    }
    if (filters.date_to) {
        sql += ` AND created_at <= $${paramIndex}`;
        params.push(filters.date_to + 'T23:59:59.999Z');
        paramIndex++;
    }
    
    sql += ` ORDER BY created_at DESC`;
    
    if (filters.limit) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(parseInt(filters.limit));
    }
    
    const result = await query(sql, params);
    return result.rows;
}

async function deleteAuditLog(id) {
    await query('DELETE FROM logs WHERE id = $1', [id]);
}

// ============ INVENTORY FUNCTIONS ============
async function getAllInventory() {
    const result = await query('SELECT * FROM inventory ORDER BY last_updated DESC');
    return result.rows;
}

async function getInventoryById(id) {
    const result = await query('SELECT * FROM inventory WHERE id = $1', [id]);
    return result.rows[0];
}

async function createInventoryItem(item) {
    const queryText = `
        INSERT INTO inventory (id, station_id, item_type, item_name, quantity, notes, last_updated)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await query(queryText, [
        item.id, item.station_id, item.item_type, item.item_name, 
        item.quantity, item.notes, item.last_updated
    ]);
}

async function updateInventoryItem(id, fields) {
    const allowedFields = ['item_name', 'item_type', 'quantity', 'notes', 'last_updated'];
    
    const updates = [];
    const values = [];
    let idx = 1;
    
    for (const [key, value] of Object.entries(fields)) {
        if (allowedFields.includes(key)) {
            updates.push(`${key} = $${idx}`);
            values.push(value);
            idx++;
        }
    }
    
    if (updates.length === 0) return;
    
    values.push(id);
    await query(`UPDATE inventory SET ${updates.join(', ')} WHERE id = $${idx}`, values);
}

async function deleteInventoryItem(id) {
    await query('DELETE FROM inventory WHERE id = $1', [id]);
}

// ============ UTILITY FUNCTIONS ============
async function getAll(table, where = '') {
    const result = await query(`SELECT * FROM ${table} ${where}`);
    return result.rows;
}

async function getById(table, id) {
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0];
}

async function deleteById(table, id) {
    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

async function getCount(table, where = '') {
    const result = await query(`SELECT COUNT(*) as count FROM ${table} ${where}`);
    return parseInt(result.rows[0].count);
}

function closeDatabase() {
    if (pool) {
        pool.end();
    }
}

// ============ EXPORTS ============
module.exports = {
    initDatabase,
    closeDatabase,
    generateId: () => generateId(),
    getPool,
    query,
    getCount,
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
    insertTransaction,
    updateTransaction,
    getTransactionById,
    getTransactions,
    hardDeleteTransaction,
    getDailySummary,
    getNextReceiptNo,
    insertLog,
    getLogs,
    deleteAuditLog,
    getAllInventory,
    getInventoryById,
    createInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    getAll,
    getById,
    deleteById
};