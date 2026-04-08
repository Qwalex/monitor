import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

let db: Database | null = null;
let dbPath: string;

type SqlValue = string | number | Uint8Array | null;

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

function migrateServicesNotifyColumn(): void {
    if (!db) return;
    const info = db.exec('PRAGMA table_info(services)');
    if (!info.length || !info[0].values.length) return;
    const columnNames = new Set(
        info[0].values.map((row: SqlValue[]) => String(row[1]))
    );
    if (!columnNames.has('notify_alerts')) {
        db.run('ALTER TABLE services ADD COLUMN notify_alerts INTEGER NOT NULL DEFAULT 1');
    }
}

function migrateAccountsMntNotifyColumn(): void {
    if (!db) return;
    const info = db.exec('PRAGMA table_info(accounts)');
    if (!info.length || !info[0].values.length) return;
    const columnNames = new Set(
        info[0].values.map((row: SqlValue[]) => String(row[1]))
    );
    if (!columnNames.has('mnt_low_notified_at')) {
        db.run('ALTER TABLE accounts ADD COLUMN mnt_low_notified_at TEXT');
    }
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
            downtime_started_at TEXT,
            notify_alerts INTEGER NOT NULL DEFAULT 1
        )
    `);

    migrateServicesNotifyColumn();
    migrateAccountsMntNotifyColumn();

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

    db.run(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    migrateAppSettingsDefaults();
}

/** Ключи настроек в `app_settings`. */
export const APP_SETTING = {
    MNT_ALERT_THRESHOLD: 'mnt_alert_threshold',
    MNT_LOW_REMINDER_HOURS: 'mnt_low_reminder_hours',
} as const;

function migrateAppSettingsDefaults(): void {
    if (!db) return;
    const defaults: [string, string][] = [
        [APP_SETTING.MNT_ALERT_THRESHOLD, '2'],
        [APP_SETTING.MNT_LOW_REMINDER_HOURS, '24'],
    ];
    for (const [k, v] of defaults) {
        db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`, [k, v]);
    }
}

export function getAppSetting(key: string, defaultValue: string): string {
    const database = getDatabase();
    const r = database.exec('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (r.length && r[0].values.length > 0) {
        return String(r[0].values[0][0]);
    }
    return defaultValue;
}

export function setAppSetting(key: string, value: string): void {
    const database = getDatabase();
    database.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
    saveDatabase();
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