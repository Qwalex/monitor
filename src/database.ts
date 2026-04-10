import { MongoClient, Db, Collection } from 'mongodb';

let client: MongoClient | null = null;
let mongoDb: Db | null = null;

const COL = {
    counters: 'counters',
    accounts: 'accounts',
    balanceHistory: 'balance_history',
    services: 'services',
    serviceHistory: 'service_history',
    appSettings: 'app_settings',
} as const;

export interface AccountDoc {
    _id: number;
    name: string;
    api_key: string;
    api_secret: string;
    account_type: string;
    created_at: string;
    is_active: number;
    mnt_low_notified_at?: string | null;
}

export interface BalanceHistoryDoc {
    _id: number;
    account_id: number;
    coin: string;
    balance: number;
    recorded_at: string;
}

export interface ServiceDoc {
    _id: number;
    name: string;
    url: string;
    expected_status: number;
    check_interval: number;
    is_active: number;
    created_at: string;
    last_check_at: string | null;
    last_status: number | null;
    downtime_started_at: string | null;
    notify_alerts: number;
}

export interface ServiceHistoryDoc {
    _id: number;
    service_id: number;
    status: number;
    response_time: number | null;
    checked_at: string;
}

export interface AppSettingDoc {
    _id: string;
    value: string;
}

/** Ключи настроек в `app_settings`. */
export const APP_SETTING = {
    MNT_ALERT_THRESHOLD: 'mnt_alert_threshold',
    MNT_LOW_REMINDER_HOURS: 'mnt_low_reminder_hours',
} as const;

function mongoUri(): string {
    const u = (process.env.MONGODB_URI || process.env.MONGO_URL || '').trim();
    if (!u) {
        throw new Error('Задайте MONGODB_URI или MONGO_URL (строка подключения MongoDB).');
    }
    return u;
}

export async function initDatabase(): Promise<void> {
    client = new MongoClient(mongoUri());
    await client.connect();
    mongoDb = client.db();

    await ensureIndexes();
    await seedAppSettingsDefaults();
}

function db(): Db {
    if (!mongoDb) {
        throw new Error('База не инициализирована. Вызовите initDatabase().');
    }
    return mongoDb;
}

export function accountsCollection(): Collection<AccountDoc> {
    return db().collection<AccountDoc>(COL.accounts);
}

export function balanceHistoryCollection(): Collection<BalanceHistoryDoc> {
    return db().collection<BalanceHistoryDoc>(COL.balanceHistory);
}

export function servicesCollection(): Collection<ServiceDoc> {
    return db().collection<ServiceDoc>(COL.services);
}

export function serviceHistoryCollection(): Collection<ServiceHistoryDoc> {
    return db().collection<ServiceHistoryDoc>(COL.serviceHistory);
}

function countersCollection(): Collection<{ _id: string; seq: number }> {
    return db().collection(COL.counters);
}

async function ensureIndexes(): Promise<void> {
    await accountsCollection().createIndex({ is_active: 1 });
    await balanceHistoryCollection().createIndex({ account_id: 1 });
    await balanceHistoryCollection().createIndex({ recorded_at: 1 });
    await servicesCollection().createIndex({ is_active: 1 });
    await serviceHistoryCollection().createIndex({ service_id: 1 });
    await serviceHistoryCollection().createIndex({ checked_at: 1 });
    await db().collection(COL.appSettings).createIndex({ _id: 1 });
}

async function seedAppSettingsDefaults(): Promise<void> {
    const c = db().collection<AppSettingDoc>(COL.appSettings);
    const defaults: [string, string][] = [
        [APP_SETTING.MNT_ALERT_THRESHOLD, '2'],
        [APP_SETTING.MNT_LOW_REMINDER_HOURS, '24'],
    ];
    for (const [_id, value] of defaults) {
        await c.updateOne({ _id }, { $setOnInsert: { value } }, { upsert: true });
    }
}

/** Следующий числовой id для коллекции с автоинкрементом. */
export async function nextId(sequence: 'accounts' | 'services' | 'balance_history' | 'service_history'): Promise<number> {
    const key =
        sequence === 'accounts'
            ? 'accounts'
            : sequence === 'services'
              ? 'services'
              : sequence === 'balance_history'
                ? 'balance_history'
                : 'service_history';
    const r = await countersCollection().findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
    );
    const seq = r?.seq;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) {
        throw new Error(`counter ${key} failed`);
    }
    return seq;
}

export async function getAppSetting(key: string, defaultValue: string): Promise<string> {
    const doc = await db().collection<AppSettingDoc>(COL.appSettings).findOne({ _id: key });
    return doc?.value ?? defaultValue;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
    await db().collection<AppSettingDoc>(COL.appSettings).updateOne(
        { _id: key },
        { $set: { value } },
        { upsert: true }
    );
}

export async function closeDatabase(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        mongoDb = null;
    }
}
