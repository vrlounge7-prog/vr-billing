// data/database-pg.js - Updated for pooler compatibility with full table creation
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

let pool = null;
let dbInitialized = false;

function getPool() {
    if (!pool) {
        const connectionString = process.env.DATABASE_URL;
        const isPooler = connectionString && connectionString.includes('pooler.supabase.com');

        console.log(`📡 Connection type: ${isPooler ? 'Pooler (Port 6543)' : 'Direct (Port 5432)'}`);

        pool = new Pool({
            connectionString: connectionString,
            ssl: {
                rejectUnauthorized: false,
                require: true
            },
            max: 10,
            min: 2,
            connectionTimeoutMillis: 30000,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
            ...(isPooler && {
                statement_timeout: 10000,
                query_timeout: 10000,
                idle_in_transaction_session_timeout: 10000
            })
        });

        pool.on('error', (err) => {
            console.error('Database pool error:', err.message);
        });

        pool.connect((err, client, release) => {
            if (err) {
                console.error('❌ Pool connection test failed:', err.message);
            } else {
                console.log('✅ Database pool ready');
                release();
            }
        });
    }
    return pool;
}

async function initDatabase() {
    if (dbInitialized) return;

    console.log('🔄 Initializing Supabase connection...');

    let retries = 3;
    while (retries > 0) {
        try {
            const result = await query('SELECT NOW() as now');
            console.log('✅ Supabase connected successfully!');
            console.log('📅 Server time:', result.rows[0].now);
            
            // Create tables and initialize data
            await createTables();
            await initializeDefaultData();
            
            dbInitialized = true;
            return;
        } catch (err) {
            retries--;
            console.log(`❌ Connection attempt failed. ${retries} retries left.`);
            if (retries === 0) {
                console.error('❌ All connection attempts failed:', err.message);
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function query(text, params) {
    const client = await getPool().connect();
    try {
        const res = await client.query(text, params);
        return res;
    } finally {
        client.release();
    }
}

function generateId() {
    return uuidv4();
}

async function createTables() {
    console.log('Creating tables if not exist...');
    
    // Create users table
    await query(`
        CREATE TABLE IF NOT EXISTS users (
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
        )
    `);
    
    // Create games table
    await query(`
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            sub_category TEXT NOT NULL,
            duration_or_quantity TEXT DEFAULT '',
            price_ksh INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1,
            platform TEXT DEFAULT '',
            is_fixed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    `);
    
    // Create stations table
    await query(`
        CREATE TABLE IF NOT EXISTS stations (
            id TEXT PRIMARY KEY,
            station_name TEXT NOT NULL,
            station_type TEXT NOT NULL,
            station_number INTEGER,
            is_active INTEGER DEFAULT 1,
            in_use INTEGER DEFAULT 0,
            setup_time INTEGER DEFAULT 2,
            created_at TEXT NOT NULL
        )
    `);
    
    // Create transactions table
    await query(`
        CREATE TABLE IF NOT EXISTS transactions (
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
            past_game TEXT DEFAULT '',
            created_at TEXT NOT NULL
        )
    `);
    
    // Create logs table
    await query(`
        CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        )
    `);
    
    // Create inventory table
    await query(`
        CREATE TABLE IF NOT EXISTS inventory (
            id TEXT PRIMARY KEY,
            station_id TEXT NOT NULL,
            item_type TEXT DEFAULT '',
            item_name TEXT NOT NULL,
            quantity INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            last_updated TEXT NOT NULL
        )
    `);
    
    // Create receipt_sequence table
    await query(`
        CREATE TABLE IF NOT EXISTS receipt_sequence (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_number INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL
        )
    `);
    
    // Create indexes
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions(receipt_no)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_cashier_id ON transactions(cashier_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_payment_status ON transactions(payment_status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_archived ON transactions(archived)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_void ON transactions(is_void)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_games_category ON games(category)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_stations_type ON stations(station_type)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_inventory_station_id ON inventory(station_id)`);
    
    console.log('Tables created/verified');
}

async function initializeDefaultData() {
    console.log('Checking for default data...');
    
    // Check if users exist
    const userCount = await getCount('users');
    
    if (userCount === 0) {
        console.log('No users found, creating default users...');
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
            await createUser(user);
        }
        console.log('✅ Default users created successfully!');
        console.log('   Admin login: admin / Admin@2026!');
        console.log('   Cashier login: cashier / Cashier@2026!');
    } else {
        console.log(`Found ${userCount} existing users, skipping user initialization`);
        
        // Make sure admin has delete permission
        try {
            const admin = await getUserByUsername('admin');
            if (admin && (admin.can_delete_voided !== 1)) {
                await updateUser(admin.id, { can_delete_voided: 1 });
                console.log('Updated existing admin user with delete permissions');
            }
        } catch (err) {
            console.log('Admin check skipped - admin user may not exist yet');
        }
    }
    
    // Check if games exist
    const gameCount = await getCount('games');
    if (gameCount === 0) {
        console.log('No games found, creating default games...');
        const defaultGames = [
            { category: 'VR Experience Regular', sub_category: '5 mins', duration_or_quantity: '5', price_ksh: 200, platform: '', is_fixed: 0 },
            { category: 'VR Experience Regular', sub_category: '15 mins', duration_or_quantity: '15', price_ksh: 400, platform: '', is_fixed: 0 },
            { category: 'VR Experience Regular', sub_category: '30 mins', duration_or_quantity: '30', price_ksh: 600, platform: '', is_fixed: 0 },
            { category: 'VR Experience Regular', sub_category: '60 mins', duration_or_quantity: '60', price_ksh: 1000, platform: '', is_fixed: 0 },
            { category: 'VR Family Sharing', sub_category: '2 players 15 mins', duration_or_quantity: '2p_15', price_ksh: 550, platform: '', is_fixed: 0 },
            { category: 'VR Family Sharing', sub_category: '2 players 30 mins', duration_or_quantity: '2p_30', price_ksh: 900, platform: '', is_fixed: 0 },
            { category: 'Game Lounge', sub_category: 'Pool 1 game', duration_or_quantity: '1', price_ksh: 100, platform: '', is_fixed: 1 },
            { category: 'Game Lounge', sub_category: 'Darts 30 mins', duration_or_quantity: '30', price_ksh: 100, platform: '', is_fixed: 0 },
            { category: 'Game Lounge', sub_category: 'Foosball 30 mins', duration_or_quantity: '30', price_ksh: 100, platform: '', is_fixed: 0 },
            { category: 'Paintball', sub_category: 'Rookie 10 shots', duration_or_quantity: '10', price_ksh: 300, platform: '', is_fixed: 1 },
            { category: 'Paintball', sub_category: 'Soldier 20 shots', duration_or_quantity: '20', price_ksh: 500, platform: '', is_fixed: 1 },
            { category: 'Paintball', sub_category: 'Sergeant 40 shots', duration_or_quantity: '40', price_ksh: 800, platform: '', is_fixed: 1 },
            { category: 'Race Simulator', sub_category: '15 mins', duration_or_quantity: '15', price_ksh: 200, platform: '', is_fixed: 0 },
            { category: 'Race Simulator', sub_category: '30 mins', duration_or_quantity: '30', price_ksh: 350, platform: '', is_fixed: 0 },
            { category: 'Race Simulator', sub_category: '60 mins', duration_or_quantity: '60', price_ksh: 600, platform: '', is_fixed: 0 }
        ];
        
        for (const game of defaultGames) {
            await createGame({
                id: generateId(),
                ...game,
                is_active: 1,
                created_at: new Date().toISOString()
            });
        }
        console.log('✅ Default games created successfully!');
    }
    
    // Check if stations exist
    const stationCount = await getCount('stations');
    if (stationCount === 0) {
        console.log('No stations found, creating default stations...');
        const defaultStations = [
            ['PS5 Station 1', 'PS5', 1, 3], ['PS5 Station 2', 'PS5', 2, 3], ['PS5 Station 3', 'PS5', 3, 3],
            ['PS4 Station 1', 'PS4', 1, 3], ['PS4 Station 2', 'PS4', 2, 3],
            ['VR Station 1', 'VR', 1, 2], ['VR Station 2', 'VR', 2, 2],
            ['Pool Table 1', 'Pool', 1, 2], ['Pool Table 2', 'Pool', 2, 2],
            ['Darts Station 1', 'Darts', 1, 2], ['Foosball Station 1', 'Foosball', 1, 2],
            ['Paintball Range', 'Paintball', 1, 5],
            ['Race Simulator 1', 'Race Simulator', 1, 2], ['Race Simulator 2', 'Race Simulator', 2, 2]
        ];
        
        for (const [name, type, num, setupTime] of defaultStations) {
            await createStation({
                id: generateId(),
                station_name: name,
                station_type: type,
                station_number: num,
                is_active: 1,
                in_use: 0,
                setup_time: setupTime,
                created_at: new Date().toISOString()
            });
        }
        console.log('✅ Default stations created successfully!');
    }
    
    // Initialize receipt sequence
    await query(`
        INSERT INTO receipt_sequence (id, last_number, updated_at) 
        VALUES (1, 0, NOW()) 
        ON CONFLICT (id) DO NOTHING
    `);
    
    console.log('Default data initialization complete!');
}

async function getCount(table, where = '') {
    const result = await query(`SELECT COUNT(*) as count FROM ${table} ${where}`);
    return parseInt(result.rows[0].count);
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
        sql += ` AND (receipt_no ILIKE $${paramIndex} OR customer_name ILIKE $${paramIndex + 1} OR 
                customer_phone ILIKE $${paramIndex + 2} OR cashier_name ILIKE $${paramIndex + 3} OR 
                payment_method ILIKE $${paramIndex + 4})`;
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
        await query(`INSERT INTO receipt_sequence (id, last_number, updated_at) VALUES (1, 0, NOW()) ON CONFLICT (id) DO NOTHING`);
        const result = await query(
            `UPDATE receipt_sequence 
             SET last_number = last_number + 1, updated_at = NOW() 
             WHERE id = 1 
             RETURNING last_number`
        );

        let nextNum = 1;
        if (result.rows.length > 0) {
            nextNum = result.rows[0].last_number;
        }

        return `${prefix}-${String(nextNum).padStart(6, '0')}`;
    } catch (err) {
        console.error('Error getting receipt number:', err);
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