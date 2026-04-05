import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase } from '../database.js';
import { getAccountBalance } from '../bybit.js';

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
    balances: {
        coin: string;
        balance: number;
    }[];
    /** Bybit не отдал баланс (неверный ключ, сеть, тип аккаунта и т.д.) */
    balanceUnavailable?: boolean;
}

router.get('/', async (_req: Request, res: Response) => {
    try {
        const db = getDatabase();
        const result = db.exec('SELECT id, name, api_key, api_secret, account_type FROM accounts WHERE is_active = 1');
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.json([]);
        }
        
        const accounts: Account[] = result[0].values.map((row: any[]) => ({
            id: row[0],
            name: row[1],
            apiKey: row[2],
            apiSecret: row[3],
            accountType: row[4],
        }));
        
        const accountBalances: AccountBalance[] = [];

        for (const account of accounts) {
            const walletBalance = await getAccountBalance(account);

            if (walletBalance && walletBalance.totalEquity) {
                const totalEquity = parseFloat(walletBalance.totalEquity || '0');
                accountBalances.push({
                    accountId: account.id,
                    accountName: account.name,
                    balances: [{
                        coin: 'USDT',
                        balance: totalEquity,
                    }],
                });
            } else {
                accountBalances.push({
                    accountId: account.id,
                    accountName: account.name,
                    balances: [],
                    balanceUnavailable: !walletBalance,
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
        const { accountId } = req.params;
        const db = getDatabase();
        
        const result = db.exec(
            'SELECT id, name, api_key, api_secret, account_type FROM accounts WHERE id = ? AND is_active = 1',
            [accountId]
        );
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        const account: Account = {
            id: result[0].values[0][0] as number,
            name: result[0].values[0][1] as string,
            apiKey: result[0].values[0][2] as string,
            apiSecret: result[0].values[0][3] as string,
            accountType: result[0].values[0][4] as string,
        };
        
        const walletBalance = await getAccountBalance(account);

        if (!walletBalance || !walletBalance.totalEquity) {
            return res.json({ accountId: account.id, accountName: account.name, balances: [] });
        }

        const totalEquity = parseFloat(walletBalance.totalEquity || '0');
        res.json({
            accountId: account.id,
            accountName: account.name,
            balances: [{
                coin: 'USDT',
                balance: totalEquity,
            }]
        });
    } catch (error) {
        console.error('Error fetching account balance:', error);
        res.status(500).json({ error: 'Failed to fetch account balance' });
    }
});

router.post('/sync/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const db = getDatabase();
        
        const result = db.exec(
            'SELECT id, name, api_key, api_secret, account_type FROM accounts WHERE id = ? AND is_active = 1',
            [accountId]
        );
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        const account: Account = {
            id: result[0].values[0][0] as number,
            name: result[0].values[0][1] as string,
            apiKey: result[0].values[0][2] as string,
            apiSecret: result[0].values[0][3] as string,
            accountType: result[0].values[0][4] as string,
        };
        
        const walletBalance = await getAccountBalance(account);

        if (!walletBalance || !walletBalance.totalEquity) {
            return res.status(500).json({ error: 'Failed to fetch balance from Bybit' });
        }

        const now = new Date().toISOString();
        const totalEquity = parseFloat(walletBalance.totalEquity || '0');

        if (totalEquity > 0) {
            db.run(
                'INSERT INTO balance_history (account_id, coin, balance, recorded_at) VALUES (?, ?, ?, ?)',
                [account.id, 'USDT', totalEquity, now]
            );
        }

        saveDatabase();

        res.json({
            success: true,
            balances: [{
                coin: 'USDT',
                balance: totalEquity,
            }]
        });
    } catch (error) {
        console.error('Error syncing balance:', error);
        res.status(500).json({ error: 'Failed to sync balance' });
    }
});

export default router;