const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'vr_billing.db');

// Ensure directory exists
if (!fs.existsSync(__dirname)) {
    fs.mkdirSync(__dirname, { recursive: true });
}

let db = null;

function generateId() {
    return require('uuid').v4();
}

function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
                return;
            }
            console.log('Connected to SQLite database');
            createTables().then(resolve).catch(reject);
        });
    });
}

async function createTables() {
    // Create tables in correct order
    const createTableQueries = [
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')),
            can_delete_voided INTEGER DEFAULT 0,
            phone_number TEXT DEFAULT '',
            gender TEXT DEFAULT 'neutral',
            bio TEXT DEFAULT '',
            profile_picture TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1,
            last_login TEXT DEFAULT '',
            last_ip TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`,
        
        `CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            sub_category TEXT NOT NULL,
            duration_or_quantity TEXT DEFAULT '',
            price_ksh INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )`,
        
        `CREATE TABLE IF NOT EXISTS stations (
            id TEXT PRIMARY KEY,
            station_name TEXT NOT NULL,
            station_type TEXT NOT NULL,
            station_number INTEGER,
            is_active INTEGER DEFAULT 1,
            in_use INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )`,
        
        `CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            receipt_no TEXT UNIQUE NOT NULL,
            customer_name TEXT DEFAULT 'Guest',
            customer_phone TEXT DEFAULT '',
            total_amount INTEGER NOT NULL,
            amount_paid INTEGER DEFAULT 0,
            balance INTEGER DEFAULT 0,
            payment_method TEXT NOT NULL,
            payment_status TEXT DEFAULT 'pending',
            cashier_id TEXT NOT NULL,
            cashier_name TEXT NOT NULL,
            transaction_date TEXT NOT NULL,
            transaction_time TEXT NOT NULL,
            items_json TEXT NOT NULL,
            station_used TEXT DEFAULT '',
            total_duration_minutes INTEGER DEFAULT 0,
            total_shots INTEGER DEFAULT 0,
            credit_details TEXT DEFAULT '',
            mpesa_receipt TEXT DEFAULT '',
            is_void INTEGER DEFAULT 0,
            is_past INTEGER DEFAULT 0,
            archived INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL
        )`,
        
        `CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        )`,
        
        `CREATE TABLE IF NOT EXISTS inventory (
            id TEXT PRIMARY KEY,
            station_id TEXT NOT NULL,
            item_type TEXT DEFAULT '',
            item_name TEXT NOT NULL,
            quantity INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            last_updated TEXT NOT NULL
        )`
    ];

    // Run each table creation sequentially
    for (const sql of createTableQueries) {
        await new Promise((resolve, reject) => {
            db.run(sql, (err) => {
                if (err) {
                    console.error('Error creating table:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Create indexes after tables exist
    const indexQueries = [
        `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`,
        `CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions(receipt_no)`,
        `CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_games_category ON games(category)`,
        `CREATE INDEX IF NOT EXISTS idx_stations_type ON stations(station_type)`,
        `CREATE INDEX IF NOT EXISTS idx_transactions_archived ON transactions(archived)`,
        `CREATE INDEX IF NOT EXISTS idx_transactions_void ON transactions(is_void)`
    ];

    for (const sql of indexQueries) {
        await new Promise((resolve) => {
            db.run(sql, (err) => {
                if (err) console.error('Index warning:', err.message);
                resolve(); // Don't fail on index errors
            });
        });
    }

    console.log('All tables created successfully');
    await initializeDefaultData();
}

async function initializeDefaultData() {
    // Check if users exist
    const userCount = await getCount('users');
    
    if (userCount === 0) {
        const salt = await bcrypt.genSalt(10);
        const adminHash = await bcrypt.hash('Admin@2026!', salt);
        const cashierHash = await bcrypt.hash('Cashier@2026!', salt);
        const now = new Date().toISOString();
        
        const users = [
            {
                id: generateId(),
                full_name: 'System Administrator',
                username: 'admin',
                password: adminHash,
                role: 'admin',
                can_delete_voided: 1,
                phone_number: '',
                gender: 'male',
                bio: '',
                profile_picture: '',
                is_active: 1,
                last_login: '',
                last_ip: '',
                created_at: now,
                updated_at: now
            },
            {
                id: generateId(),
                full_name: 'Cashier User',
                username: 'cashier',
                password: cashierHash,
                role: 'cashier',
                can_delete_voided: 0,
                phone_number: '',
                gender: 'neutral',
                bio: '',
                profile_picture: '',
                is_active: 1,
                last_login: '',
                last_ip: '',
                created_at: now,
                updated_at: now
            }
        ];
        
        for (const user of users) {
            await insertUser(user);
        }
        console.log('Default users created');
    } else {
        // Update existing admin to have can_delete_voided if missing
        const admin = await getUserByUsername('admin');
        if (admin && (admin.can_delete_voided === undefined || admin.can_delete_voided !== 1)) {
            await updateUser(admin.id, { can_delete_voided: 1 });
            console.log('Updated existing admin user with delete permissions');
        }
    }
    
    // Check if games exist
    const gameCount = await getCount('games');
    if (gameCount === 0) {
        const defaultGames = [
            { category: 'VR Experience Regular', sub_category: '5 mins', duration_or_quantity: '5', price_ksh: 200 },
            { category: 'VR Experience Regular', sub_category: '15 mins', duration_or_quantity: '15', price_ksh: 400 },
            { category: 'VR Experience Regular', sub_category: '30 mins', duration_or_quantity: '30', price_ksh: 600 },
            { category: 'VR Experience Regular', sub_category: '60 mins', duration_or_quantity: '60', price_ksh: 1000 },
            { category: 'VR Family Sharing', sub_category: '2 players 15 mins', duration_or_quantity: '2p_15', price_ksh: 550 },
            { category: 'VR Family Sharing', sub_category: '2 players 30 mins', duration_or_quantity: '2p_30', price_ksh: 900 },
            { category: 'Game Lounge', sub_category: 'Pool 1 game', duration_or_quantity: '1', price_ksh: 100 },
            { category: 'Game Lounge', sub_category: 'Darts 30 mins', duration_or_quantity: '30', price_ksh: 100 },
            { category: 'Game Lounge', sub_category: 'Foosball 30 mins', duration_or_quantity: '30', price_ksh: 100 },
            { category: 'Paintball', sub_category: 'Rookie 10 shots', duration_or_quantity: '10', price_ksh: 300 },
            { category: 'Paintball', sub_category: 'Soldier 20 shots', duration_or_quantity: '20', price_ksh: 500 },
            { category: 'Paintball', sub_category: 'Sergeant 40 shots', duration_or_quantity: '40', price_ksh: 800 }
        ];
        
        for (const game of defaultGames) {
            await insertGame({
                id: generateId(),
                ...game,
                is_active: 1,
                created_at: new Date().toISOString()
            });
        }
        console.log('Default games created');
    }
    
    // Check if stations exist
    const stationCount = await getCount('stations');
    if (stationCount === 0) {
        const defaultStations = [
            ['PS5 Station 1', 'PS5', 1], ['PS5 Station 2', 'PS5', 2], ['PS5 Station 3', 'PS5', 3],
            ['PS4 Station 1', 'PS4', 1], ['PS4 Station 2', 'PS4', 2],
            ['VR Station 1', 'VR', 1], ['VR Station 2', 'VR', 2],
            ['Pool Table 1', 'Pool', 1], ['Pool Table 2', 'Pool', 2],
            ['Darts Station 1', 'Darts', 1], ['Foosball Station 1', 'Foosball', 1],
            ['Paintball Range', 'Paintball', 1]
        ];
        
        for (const [name, type, num] of defaultStations) {
            await insertStation({
                id: generateId(),
                station_name: name,
                station_type: type,
                station_number: num,
                is_active: 1,
                in_use: 0,
                created_at: new Date().toISOString()
            });
        }
        console.log('Default stations created');
    }
}

function getCount(table, where = '') {
    return new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as count FROM ${table} ${where}`, (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}

function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getUserById(id) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getAll(table, where = '') {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM ${table} ${where}`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getById(table, id) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM ${table} WHERE id = ?`, [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function deleteById(table, id) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM ${table} WHERE id = ?`, [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function insertUser(user) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO users (id, full_name, username, password, role, can_delete_voided, phone_number, gender, bio, profile_picture, is_active, last_login, last_ip, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, user.full_name, user.username, user.password, user.role, user.can_delete_voided, user.phone_number, user.gender, user.bio, user.profile_picture, user.is_active, user.last_login, user.last_ip, user.created_at, user.updated_at],
            (err) => err ? reject(err) : resolve()
        );
    });
}

function updateUser(id, fields) {
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
        updates.push(`${key} = ?`);
        values.push(value);
    }
    values.push(id);
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values, (err) => err ? reject(err) : resolve());
    });
}

function insertGame(game) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO games (id, category, sub_category, duration_or_quantity, price_ksh, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [game.id, game.category, game.sub_category, game.duration_or_quantity, game.price_ksh, game.is_active, game.created_at],
            (err) => err ? reject(err) : resolve()
        );
    });
}

function updateGame(id, fields) {
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
        updates.push(`${key} = ?`);
        values.push(value);
    }
    values.push(id);
    return new Promise((resolve, reject) => {
        db.run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, values, (err) => err ? reject(err) : resolve());
    });
}

function insertStation(station) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO stations (id, station_name, station_type, station_number, is_active, in_use, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [station.id, station.station_name, station.station_type, station.station_number, station.is_active, station.in_use, station.created_at],
            (err) => err ? reject(err) : resolve()
        );
    });
}

function updateStation(id, fields) {
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
        updates.push(`${key} = ?`);
        values.push(value);
    }
    values.push(id);
    return new Promise((resolve, reject) => {
        db.run(`UPDATE stations SET ${updates.join(', ')} WHERE id = ?`, values, (err) => err ? reject(err) : resolve());
    });
}

function insertTransaction(tx) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO transactions (id, receipt_no, customer_name, customer_phone, total_amount, amount_paid, balance, 
             payment_method, payment_status, cashier_id, cashier_name, transaction_date, transaction_time, items_json, 
             station_used, total_duration_minutes, total_shots, credit_details, mpesa_receipt, is_void, is_past, archived, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tx.id, tx.receipt_no, tx.customer_name, tx.customer_phone, tx.total_amount, tx.amount_paid, tx.balance,
             tx.payment_method, tx.payment_status, tx.cashier_id, tx.cashier_name, tx.transaction_date, tx.transaction_time,
             tx.items_json, tx.station_used, tx.total_duration_minutes, tx.total_shots, tx.credit_details, tx.mpesa_receipt,
             tx.is_void || 0, tx.is_past || 0, tx.archived || 0, tx.notes || '', tx.created_at],
            (err) => err ? reject(err) : resolve()
        );
    });
}

function updateTransaction(id, fields) {
    return new Promise((resolve, reject) => {
        const updates = [];
        const values = [];
        for (const [key, value] of Object.entries(fields)) {
            updates.push(`${key} = ?`);
            values.push(value);
        }
        values.push(id);
        
        db.run(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`, values, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// HARD DELETE - Permanently removes transaction from database
function hardDeleteTransaction(id) {
    return new Promise((resolve, reject) => {
        console.log('hardDeleteTransaction called for ID:', id);
        db.run(`DELETE FROM transactions WHERE id = ?`, [id], (err) => {
            if (err) {
                console.error('hardDeleteTransaction error:', err);
                reject(err);
            } else {
                console.log('hardDeleteTransaction successful for ID:', id);
                resolve();
            }
        });
    });
}

function insertLog(log) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO logs (id, user_id, action, details, ip_address, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [log.id, log.user_id, log.action, log.details, log.ip_address, log.user_agent, log.created_at],
            (err) => err ? reject(err) : resolve()
        );
    });
}

function insertInventoryItem(item) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO inventory (id, station_id, item_type, item_name, quantity, notes, last_updated)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [item.id, item.station_id, item.item_type, item.item_name, item.quantity, item.notes, item.last_updated],
            (err) => err ? reject(err) : resolve()
        );
    });
}

function updateInventoryItem(id, fields) {
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
        updates.push(`${key} = ?`);
        values.push(value);
    }
    values.push(id);
    return new Promise((resolve, reject) => {
        db.run(`UPDATE inventory SET ${updates.join(', ')} WHERE id = ?`, values, (err) => err ? reject(err) : resolve());
    });
}

function getTransactions(filters = {}) {
    let sql = `SELECT * FROM transactions WHERE 1=1`;
    const params = [];
    if (filters.date) { sql += ` AND transaction_date = ?`; params.push(filters.date); }
    if (filters.status) { sql += ` AND payment_status = ?`; params.push(filters.status); }
    if (filters.payment_method) { sql += ` AND payment_method = ?`; params.push(filters.payment_method); }
    if (filters.include_void !== 'true') { sql += ` AND is_void = 0`; }
    if (filters.include_past !== 'true') { sql += ` AND is_past = 0`; }
    if (filters.archived === 'true') { sql += ` AND archived = 1`; }
    else if (filters.archived === 'false') { sql += ` AND archived = 0`; }
    if (filters.search) {
        sql += ` AND (receipt_no LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR cashier_name LIKE ? OR payment_method LIKE ?)`;
        const search = `%${filters.search}%`;
        params.push(search, search, search, search, search);
    }
    sql += ` ORDER BY created_at DESC`;
    if (filters.limit) { sql += ` LIMIT ?`; params.push(parseInt(filters.limit)); }
    
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getLogs(filters = {}) {
    let sql = `SELECT * FROM logs WHERE 1=1`;
    const params = [];
    if (filters.search) {
        sql += ` AND (action LIKE ? OR details LIKE ?)`;
        const search = `%${filters.search}%`;
        params.push(search, search);
    }
    if (filters.action) { sql += ` AND action = ?`; params.push(filters.action); }
    if (filters.user_id) { sql += ` AND user_id = ?`; params.push(filters.user_id); }
    if (filters.date_from) { sql += ` AND created_at >= ?`; params.push(filters.date_from); }
    if (filters.date_to) { sql += ` AND created_at <= ?`; params.push(filters.date_to + 'T23:59:59.999Z'); }
    sql += ` ORDER BY created_at DESC`;
    if (filters.limit) { sql += ` LIMIT ?`; params.push(parseInt(filters.limit)); }
    
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getDailySummary(date, includePast = false) {
    return new Promise((resolve, reject) => {
        let sql = `SELECT 
            COUNT(*) as transaction_count,
            SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END) as cash,
            SUM(CASE WHEN payment_method = 'Mpesa' THEN total_amount ELSE 0 END) as mpesa,
            SUM(CASE WHEN payment_method = 'Credit' THEN total_amount ELSE 0 END) as credit,
            SUM(total_amount) as total
         FROM transactions 
         WHERE transaction_date = ? AND is_void = 0 AND payment_status = 'completed'`;
        
        if (!includePast) {
            sql += ` AND is_past = 0`;
        }
        
        db.get(sql, [date], (err, row) => {
            if (err) reject(err);
            else resolve(row || { transaction_count: 0, cash: 0, mpesa: 0, credit: 0, total: 0 });
        });
    });
}

function getNextReceiptNo() {
    return new Promise((resolve, reject) => {
        db.get(`SELECT receipt_no FROM transactions ORDER BY created_at DESC LIMIT 1`, (err, row) => {
            if (err) reject(err);
            else {
                let lastNum = 0;
                if (row && row.receipt_no) {
                    const match = row.receipt_no.match(/VR-(\d+)/);
                    if (match) lastNum = parseInt(match[1]);
                }
                const newNum = String(lastNum + 1).padStart(6, '0');
                resolve(`VR-${newNum}`);
            }
        });
    });
}

function closeDatabase() {
    if (db) {
        db.close((err) => {
            if (err) console.error('Error closing database:', err.message);
            else console.log('Database connection closed');
        });
    }
}

module.exports = {
    initDatabase,
    closeDatabase,
    generateId: () => generateId(),
    getCount,
    getUserByUsername,
    getUserById,
    getAll,
    getById,
    deleteById,
    insertUser,
    updateUser,
    insertGame,
    updateGame,
    insertStation,
    updateStation,
    insertTransaction,
    updateTransaction,
    hardDeleteTransaction,
    insertLog,
    insertInventoryItem,
    updateInventoryItem,
    getTransactions,
    getLogs,
    getDailySummary,
    getNextReceiptNo,
    getDb: () => db
};