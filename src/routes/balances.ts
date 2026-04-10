import { Router, Request, Response } from 'express';
import { accountsCollection, balanceHistoryCollection, nextId } from '../database.js';
import { getAccountBalance, coinRowsFromWallet } from '../bybit.js';
import { buildMntLowAlertHtmlIfNeeded } from '../mnt-alert.js';
import { sendHtmlWithFallback } from '../bot/telegram.js';

const router = Router();

interface Account {
    id: number;
    name: string;
    apiKey: string;
    apiSecret: string;
    accountType: string;
}

interface AccountBalance {
    accountId: number;
    accountName: string;
    /** Суммарная оценка в USDT (если Bybit отдал totalEquity) */
    totalEquityUsd?: number;
    balances: {
        coin: string;
        balance: number;
    }[];
    /** Bybit не отдал баланс (неверный ключ, сеть, тип аккаунта и т.д.) */
    balanceUnavailable?: boolean;
}

router.get('/', async (_req: Request, res: Response) => {
    try {
        const docs = await accountsCollection()
            .find({ is_active: 1 })
            .project({ _id: 1, name: 1, api_key: 1, api_secret: 1, account_type: 1 })
            .toArray();

        const accounts: Account[] = docs.map((d) => ({
            id: d._id,
            name: d.name,
            apiKey: d.api_key,
            apiSecret: d.api_secret,
            accountType: d.account_type,
        }));

        const accountBalances: AccountBalance[] = [];

        for (const account of accounts) {
            const walletBalance = await getAccountBalance(account);

            if (walletBalance) {
                const rows = coinRowsFromWallet(walletBalance);
                const totalEq = parseFloat(String(walletBalance.totalEquity ?? '0'));
                if (rows.length > 0) {
                    accountBalances.push({
                        accountId: account.id,
                        accountName: account.name,
                        totalEquityUsd: Number.isFinite(totalEq) ? totalEq : undefined,
                        balances: rows.map((r) => ({
                            coin: r.coin,
                            balance: r.balance,
                        })),
                    });
                } else {
                    accountBalances.push({
                        accountId: account.id,
                        accountName: account.name,
                        balances: [],
                        balanceUnavailable: false,
                    });
                }
            } else {
                accountBalances.push({
                    accountId: account.id,
                    accountName: account.name,
                    balances: [],
                    balanceUnavailable: true,
                });
            }
        }

        res.json(accountBalances);
    } catch (error) {
        console.error('Error fetching balances:', error);
        res.status(500).json({ error: 'Failed to fetch balances' });
    }
});

router.get('/:accountId', async (req: Request, res: Response) => {
    try {
        const accountId = parseInt(req.params.accountId as string, 10);
        if (Number.isNaN(accountId)) {
            return res.status(400).json({ error: 'Invalid account id' });
        }

        const d = await accountsCollection().findOne({ _id: accountId, is_active: 1 });
        if (!d) {
            return res.status(404).json({ error: 'Account not found' });
        }

        const account: Account = {
            id: d._id,
            name: d.name,
            apiKey: d.api_key,
            apiSecret: d.api_secret,
            accountType: d.account_type,
        };

        const walletBalance = await getAccountBalance(account);

        if (!walletBalance) {
            return res.json({
                accountId: account.id,
                accountName: account.name,
                balances: [],
                balanceUnavailable: true,
            });
        }

        const rows = coinRowsFromWallet(walletBalance);
        const totalEq = parseFloat(String(walletBalance.totalEquity ?? '0'));
        res.json({
            accountId: account.id,
            accountName: account.name,
            totalEquityUsd: Number.isFinite(totalEq) ? totalEq : undefined,
            balances: rows.map((r) => ({ coin: r.coin, balance: r.balance })),
            balanceUnavailable: rows.length === 0,
        });
    } catch (error) {
        console.error('Error fetching account balance:', error);
        res.status(500).json({ error: 'Failed to fetch account balance' });
    }
});

router.post('/sync/:accountId', async (req: Request, res: Response) => {
    try {
        const accountId = parseInt(req.params.accountId as string, 10);
        if (Number.isNaN(accountId)) {
            return res.status(400).json({ error: 'Invalid account id' });
        }

        const d = await accountsCollection().findOne({ _id: accountId, is_active: 1 });
        if (!d) {
            return res.status(404).json({ error: 'Account not found' });
        }

        const account: Account = {
            id: d._id,
            name: d.name,
            apiKey: d.api_key,
            apiSecret: d.api_secret,
            accountType: d.account_type,
        };

        const walletBalance = await getAccountBalance(account);

        if (!walletBalance) {
            return res.status(500).json({ error: 'Failed to fetch balance from Bybit' });
        }

        const rows = coinRowsFromWallet(walletBalance);
        if (rows.length === 0) {
            return res.status(500).json({ error: 'No coin balances from Bybit' });
        }

        const now = new Date().toISOString();
        const te = parseFloat(String(walletBalance.totalEquity ?? '0'));
        const inserts: { _id: number; account_id: number; coin: string; balance: number; recorded_at: string }[] = [];

        if (Number.isFinite(te) && te > 0) {
            inserts.push({
                _id: await nextId('balance_history'),
                account_id: account.id,
                coin: 'PORTFOLIO_USD',
                balance: te,
                recorded_at: now,
            });
        }
        for (const r of rows) {
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

        const mntHtml = await buildMntLowAlertHtmlIfNeeded(account.id, account.name, rows);
        if (mntHtml) {
            void sendHtmlWithFallback(mntHtml);
        }

        res.json({
            success: true,
            balances: rows.map((r) => ({ coin: r.coin, balance: r.balance })),
        });
    } catch (error) {
        console.error('Error syncing balance:', error);
        res.status(500).json({ error: 'Failed to sync balance' });
    }
});

export default router;
