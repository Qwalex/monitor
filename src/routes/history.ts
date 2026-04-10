import { Router, Request, Response } from 'express';
import { accountsCollection, balanceHistoryCollection } from '../database.js';

const router = Router();

router.get('/all', async (req: Request, res: Response) => {
    try {
        const { accountId, from, to, limit = '100' } = req.query;
        const lim = Math.min(5000, Math.max(1, parseInt(String(limit), 10) || 100));

        const match: Record<string, unknown> = { coin: { $ne: 'PORTFOLIO_USD' } };
        if (accountId) {
            match.account_id = parseInt(String(accountId), 10);
        }
        const recordedFilter: Record<string, string> = {};
        if (from) recordedFilter.$gte = String(from);
        if (to) recordedFilter.$lte = String(to);
        if (Object.keys(recordedFilter).length > 0) {
            match.recorded_at = recordedFilter;
        }

        const pipeline: object[] = [
            { $match: match },
            {
                $lookup: {
                    from: 'accounts',
                    localField: 'account_id',
                    foreignField: '_id',
                    as: 'acc',
                },
            },
            { $unwind: '$acc' },
            { $match: { 'acc.is_active': 1 } },
            { $sort: { recorded_at: -1 } },
            { $limit: lim },
            {
                $project: {
                    _id: 1,
                    account_id: 1,
                    account_name: '$acc.name',
                    coin: 1,
                    balance: 1,
                    recorded_at: 1,
                },
            },
        ];

        const rows = await balanceHistoryCollection()
            .aggregate<{ _id: number; account_id: number; account_name: string; coin: string; balance: number; recorded_at: string }>(
                pipeline
            )
            .toArray();

        const history = rows.map((row) => ({
            id: row._id,
            accountId: row.account_id,
            accountName: row.account_name,
            coin: row.coin,
            balance: row.balance,
            recordedAt: row.recorded_at,
        }));

        res.json(history);
    } catch (error) {
        console.error('Error fetching balance history:', error);
        res.status(500).json({ error: 'Failed to fetch balance history' });
    }
});

router.get('/chart', async (req: Request, res: Response) => {
    try {
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

        const accountDocs = await accountsCollection().find({ is_active: 1 }).sort({ _id: 1 }).toArray();
        const accounts = accountDocs.map((a) => ({ id: a._id, name: a.name }));

        const historyRows = await balanceHistoryCollection()
            .aggregate<{
                recorded_at: string;
                account_id: number;
                account_name: string;
                balance: number;
                coin: string;
            }>([
                { $match: { recorded_at: { $gte: fromDate } } },
                {
                    $lookup: {
                        from: 'accounts',
                        localField: 'account_id',
                        foreignField: '_id',
                        as: 'acc',
                    },
                },
                { $unwind: '$acc' },
                { $match: { 'acc.is_active': 1 } },
                { $sort: { recorded_at: 1 } },
                {
                    $project: {
                        recorded_at: 1,
                        account_id: 1,
                        balance: 1,
                        coin: 1,
                        account_name: '$acc.name',
                    },
                },
            ])
            .toArray();

        if (historyRows.length === 0) {
            return res.json({ accounts: [], data: {} });
        }

        const timeSlots: Map<string, Map<number, number>> = new Map();

        type SlotSource = { balance: number; priority: number };
        const slotSources: Map<string, Map<number, SlotSource>> = new Map();

        for (const row of historyRows) {
            const timestamp = row.recorded_at;
            const accountId = row.account_id;
            const balance = row.balance;
            const coin = String(row.coin ?? '');
            if (coin !== 'PORTFOLIO_USD' && coin !== 'USDT') {
                continue;
            }
            const priority = coin === 'PORTFOLIO_USD' ? 2 : 1;

            const date = new Date(timestamp);
            date.setMinutes(0, 0, 0);
            const slotKey = date.toISOString();

            if (!slotSources.has(slotKey)) {
                slotSources.set(slotKey, new Map());
            }
            const accMap = slotSources.get(slotKey)!;
            const prev = accMap.get(accountId);
            if (!prev || priority > prev.priority) {
                accMap.set(accountId, { balance, priority });
            }
        }

        for (const [slotKey, accMap] of slotSources) {
            const m = new Map<number, number>();
            for (const [aid, src] of accMap) {
                m.set(aid, src.balance);
            }
            timeSlots.set(slotKey, m);
        }

        const timestamps = Array.from(timeSlots.keys()).sort();
        const data: Record<string, Record<string, number>> = {};

        for (const ts of timestamps) {
            data[ts] = {};
            const slotData = timeSlots.get(ts)!;
            for (const acc of accounts) {
                data[ts][acc.name] = slotData.get(acc.id) || 0;
            }
        }

        const accountData: Record<string, { timestamps: string[]; balances: number[] }> = {};

        for (const acc of accounts) {
            const accBalances: number[] = [];
            const accTimestamps: string[] = [];

            for (const ts of timestamps) {
                accTimestamps.push(ts);
                accBalances.push(data[ts]?.[acc.name] || 0);
            }

            accountData[acc.name] = {
                timestamps: accTimestamps,
                balances: accBalances,
            };
        }

        res.json({
            accounts: accounts.map((a) => a.name),
            timestamps: timestamps,
            data: data,
            accountData: accountData,
        });
    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

export default router;
