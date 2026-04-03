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
        
        const result = db.exec(`
            SELECT 
                bh.recorded_at,
                SUM(bh.balance) as total_balance
            FROM balance_history bh
            WHERE bh.recorded_at >= ?
            GROUP BY date(bh.recorded_at), strftime('%H', bh.recorded_at)
            ORDER BY bh.recorded_at ASC
        `, [fromDate]);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.json([]);
        }
        
        const chartData = result[0].values.map((row: any[]) => ({
            timestamp: row[0],
            totalBalance: row[1],
        }));
        
        res.json(chartData);
    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

export default router;