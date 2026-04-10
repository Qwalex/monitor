import cron from 'node-cron';
import { accountsCollection, balanceHistoryCollection, nextId } from './database.js';
import { getAccountBalance, coinRowsFromWallet } from './bybit.js';
import { buildMntLowAlertHtmlIfNeeded } from './mnt-alert.js';
import { sendHtmlWithFallback } from './bot/telegram.js';

export function startScheduler(): void {
    cron.schedule('0 * * * *', () => {
        void (async () => {
            console.log('Running scheduled balance sync...');
            await syncAllBalances();
            console.log('Scheduled balance sync completed');
        })();
    });

    console.log('Scheduler started - will sync balances every hour');
}

async function syncAllBalances(): Promise<void> {
    const rows = await accountsCollection()
        .find({ is_active: 1 })
        .project({ _id: 1, name: 1, api_key: 1, api_secret: 1, account_type: 1 })
        .toArray();

    if (rows.length === 0) {
        console.log('No accounts to sync');
        return;
    }

    const now = new Date().toISOString();
    let syncedCount = 0;

    for (const row of rows) {
        const account = {
            id: row._id,
            name: row.name,
            apiKey: row.api_key,
            apiSecret: row.api_secret,
            accountType: row.account_type,
        };

        try {
            const walletBalance = await getAccountBalance(account);

            if (walletBalance) {
                const coinRows = coinRowsFromWallet(walletBalance);
                const te = parseFloat(String(walletBalance.totalEquity ?? '0'));
                const inserts: {
                    _id: number;
                    account_id: number;
                    coin: string;
                    balance: number;
                    recorded_at: string;
                }[] = [];

                if (Number.isFinite(te) && te > 0) {
                    inserts.push({
                        _id: await nextId('balance_history'),
                        account_id: account.id,
                        coin: 'PORTFOLIO_USD',
                        balance: te,
                        recorded_at: now,
                    });
                }
                for (const r of coinRows) {
                    if (r.balance > 0) {
                        inserts.push({
                            _id: await nextId('balance_history'),
                            account_id: account.id,
                            coin: r.coin,
                            balance: r.balance,
                            recorded_at: now,
                        });
                    }
                }
                if (inserts.length > 0) {
                    await balanceHistoryCollection().insertMany(inserts);
                }

                if (coinRows.length > 0) {
                    syncedCount++;
                    console.log(
                        `Synced balance for account: ${account.name} (${coinRows.map((x) => `${x.coin}:${x.balance}`).join(', ')})`
                    );
                }

                const mntHtml = await buildMntLowAlertHtmlIfNeeded(account.id, account.name, coinRows);
                if (mntHtml) {
                    void sendHtmlWithFallback(mntHtml);
                }
            }
        } catch (error) {
            console.error(`Error syncing account ${account.name}:`, error);
        }
    }

    console.log(`Synced ${syncedCount} accounts`);
}

export async function runManualSync(): Promise<void> {
    await syncAllBalances();
}
