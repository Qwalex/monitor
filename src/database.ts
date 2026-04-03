import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

let db: Database | null = null;
let dbPath: string;

export async function initDatabase(): Promise<Database> {
    const SQL = await initSqlJs();
    
    dbPath = process.env.DATABASE_PATH || './data/monitor.db';
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }
    
    createTables();
    saveDatabase();
    
    return db;
}

function createTables(): void {
    if (!db) return;
    
    db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            api_secret TEXT NOT NULL,
            account_type TEXT DEFAULT 'UNIFIED',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS balance_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            coin TEXT NOT NULL,
            balance REAL NOT NULL,
            recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_balance_history_account 
        ON balance_history(account_id)
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_balance_history_date 
        ON balance_history(recorded_at)
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            expected_status INTEGER DEFAULT 200,
            check_interval INTEGER DEFAULT 60,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_check_at TEXT,
            last_status INTEGER,
            downtime_started_at TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS service_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id INTEGER NOT NULL,
            status INTEGER NOT NULL,
            response_time INTEGER,
            checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_service_history_service 
        ON service_history(service_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_service_history_date 
        ON service_history(checked_at)
    `);
}

export function saveDatabase(): void {
    if (!db || !dbPath) return;
    
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

export function getDatabase(): Database {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

export function closeDatabase(): void {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
    }
}