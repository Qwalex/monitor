import cron from 'node-cron';
import { getDatabase, saveDatabase } from './database.js';
import { getAccountBalance, coinRowsFromWallet } from './bybit.js';
import { buildMntLowAlertHtmlIfNeeded } from './mnt-alert.js';
import { sendHtmlWithFallback } from './bot/telegram.js';

export function startScheduler(): void {
    cron.schedule('0 * * * *', async () => {
        console.log('Running scheduled balance sync...');
        await syncAllBalances();
        console.log('Scheduled balance sync completed');
    });
    
    console.log('Scheduler started - will sync balances every hour');
}

async function syncAllBalances(): Promise<void> {
    const db = getDatabase();
    const result = db.exec('SELECT id, name, api_key, api_secret, account_type FROM accounts WHERE is_active = 1');
    
    if (result.length === 0 || result[0].values.length === 0) {
        console.log('No accounts to sync');
        return;
    }
    
    const now = new Date().toISOString();
    let syncedCount = 0;
    
    for (const row of result[0].values) {
        const account = {
            id: row[0] as number,
            name: row[1] as string,
            apiKey: row[2] as string,
            apiSecret: row[3] as string,
            accountType: row[4] as string,
        };
        
        try {
            const walletBalance = await getAccountBalance(account);

            if (walletBalance) {
                const rows = coinRowsFromWallet(walletBalance);
                const te = parseFloat(String(walletBalance.totalEquity ?? '0'));
                if (Number.isFinite(te) && te > 0) {
                    db.run(
                        'INSERT INTO balance_history (account_id, coin, balance, recorded_at) VALUES (?, ?, ?, ?)',
                        [account.id, 'PORTFOLIO_USD', te, now]
                    );
                }
                for (const r of rows) {
                    if (r.balance > 0) {
                        db.run(
                            'INSERT INTO balance_history (account_id, coin, balance, recorded_at) VALUES (?, ?, ?, ?)',
                            [account.id, r.coin, r.balance, now]
                        );
                    }
                }
                if (rows.length > 0) {
                    syncedCount++;
                    console.log(`Synced balance for account: ${account.name} (${rows.map((x) => `${x.coin}:${x.balance}`).join(', ')})`);
                }

                const mntHtml = buildMntLowAlertHtmlIfNeeded(account.id, account.name, rows);
                if (mntHtml) {
                    void sendHtmlWithFallback(mntHtml);
                }
            }
        } catch (error) {
            console.error(`Error syncing account ${account.name}:`, error);
        }
    }
    
    saveDatabase();
    console.log(`Synced ${syncedCount} accounts`);
}

export async function runManualSync(): Promise<void> {
    await syncAllBalances();
}