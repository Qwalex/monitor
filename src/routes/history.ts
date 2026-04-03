import { Router, Request, Response } from 'express';
import { getDatabase } from '../database.js';

const router = Router();

router.get('/all', (req: Request, res: Response) => {
    try {
        const db = getDatabase();
        const { accountId, from, to, limit = 100 } = req.query;
        
        let query = `
            SELECT bh.id, bh.account_id, a.name as account_name, bh.coin, bh.balance, bh.recorded_at
            FROM balance_history bh
            JOIN accounts a ON bh.account_id = a.id
            WHERE 1=1
        `;
        const params: any[] = [];
        
        if (accountId) {
            query += ' AND bh.account_id = ?';
            params.push(accountId);
        }
        
        if (from) {
            query += ' AND bh.recorded_at >= ?';
            params.push(from);
        }
        
        if (to) {
            query += ' AND bh.recorded_at <= ?';
            params.push(to);
        }
        
        query += ' ORDER BY bh.recorded_at DESC LIMIT ?';
        params.push(parseInt(limit as string));
        
        const result = db.exec(query, params);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.json([]);
        }
        
        const history = result[0].values.map((row: any[]) => ({
            id: row[0],
            accountId: row[1],
            accountName: row[2],
            coin: row[3],
            balance: row[4],
            recordedAt: row[5],
        }));
        
        res.json(history);
    } catch (error) {
        console.error('Error fetching balance history:', error);
        res.status(500).json({ error: 'Failed to fetch balance history' });
    }
});

router.get('/chart', (req: Request, res: Response) => {
    try {
        const db = getDatabase();
        const { period = '24h' } = req.query;

        let fromDate: string;
        const now = new Date();

        switch (period) {
            case '24h':
                fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
                break;
            case '7d':
                fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
                break;
            case '30d':
                fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
                break;
            default:
                fromDate = '1970-01-01T00:00:00.000Z';
        }

        // Get all accounts
        const accountsResult = db.exec('SELECT id, name FROM accounts ORDER BY id');
        const accounts = accountsResult.length > 0 ? accountsResult[0].values.map((row: any[]) => ({
            id: row[0],
            name: row[1]
        })) : [];

        // Get balance history grouped by time slot and account
        const historyResult = db.exec(`
            SELECT
                bh.recorded_at,
                bh.account_id,
                a.name as account_name,
                bh.balance
            FROM balance_history bh
            JOIN accounts a ON bh.account_id = a.id
            WHERE bh.recorded_at >= ?
            ORDER BY bh.recorded_at ASC
        `, [fromDate]);

        if (historyResult.length === 0 || historyResult[0].values.length === 0) {
            return res.json({ accounts: [], data: {} });
        }

        // Group by time slots (hourly)
        const timeSlots: Map<string, Map<number, number>> = new Map();

        for (const row of historyResult[0].values) {
            const timestamp = row[0] as string;
            const accountId = row[1] as number;
            const balance = row[3] as number;

            // Round to hour
            const date = new Date(timestamp);
            date.setMinutes(0, 0, 0);
            const slotKey = date.toISOString();

            if (!timeSlots.has(slotKey)) {
                timeSlots.set(slotKey, new Map());
            }
            timeSlots.get(slotKey)!.set(accountId, balance);
        }

        // Build response
        const timestamps = Array.from(timeSlots.keys()).sort();
        const data: Record<string, Record<string, number>> = {};

        for (const ts of timestamps) {
            data[ts] = {};
            const slotData = timeSlots.get(ts)!;
            for (const acc of accounts) {
                data[ts][acc.name] = slotData.get(acc.id) || 0;
            }
        }

        // Build response with individual account data
        const accountData: Record<string, { timestamps: string[], balances: number[] }> = {};

        for (const acc of accounts) {
            const accBalances: number[] = [];
            const accTimestamps: string[] = [];

            for (const ts of timestamps) {
                accTimestamps.push(ts);
                accBalances.push(data[ts]?.[acc.name] || 0);
            }

            accountData[acc.name] = {
                timestamps: accTimestamps,
                balances: accBalances
            };
        }

        res.json({
            accounts: accounts.map((a: any) => a.name),
            timestamps: timestamps,
            data: data,
            accountData: accountData
        });
    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

export default router;