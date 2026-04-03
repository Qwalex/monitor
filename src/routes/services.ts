import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase } from '../database.js';
import { startServiceMonitoring, addServiceMonitoring, stopServiceMonitoring } from '../services.js';

const router = Router();

interface Service {
    id: number;
    name: string;
    url: string;
    expected_status: number;
    check_interval: number;
    is_active: number;
    created_at: string;
    last_check_at: string | null;
    last_status: number | null;
    downtime_started_at: string | null;
}

router.get('/', (_req: Request, res: Response) => {
    try {
        const db = getDatabase();
        const result = db.exec(`
            SELECT id, name, url, expected_status, check_interval, is_active, created_at, last_check_at, last_status, downtime_started_at
            FROM services 
            WHERE is_active = 1
        `);

        if (result.length === 0 || result[0].values.length === 0) {
            return res.json([]);
        }

        const services: Service[] = result[0].values.map((row: any[]) => ({
            id: row[0],
            name: row[1],
            url: row[2],
            expected_status: row[3],
            check_interval: row[4],
            is_active: row[5],
            created_at: row[6],
            last_check_at: row[7],
            last_status: row[8],
            downtime_started_at: row[9],
        }));

        res.json(services);
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ error: 'Failed to fetch services' });
    }
});

router.post('/', (req: Request, res: Response) => {
    try {
        const { name, url, expected_status = 200, check_interval = 60 } = req.body;

        if (!name || !url) {
            return res.status(400).json({ error: 'Missing required fields: name, url' });
        }

        const db = getDatabase();
        db.run(
            'INSERT INTO services (name, url, expected_status, check_interval) VALUES (?, ?, ?, ?)',
            [name, url, expected_status, check_interval]
        );

        saveDatabase();

        const result = db.exec('SELECT last_insert_rowid()');
        const id = result[0].values[0][0];

        // Start monitoring the new service
        const newService: Service = {
            id: id as number,
            name,
            url,
            expected_status,
            check_interval,
            is_active: 1,
            created_at: new Date().toISOString(),
            last_check_at: null,
            last_status: null,
            downtime_started_at: null,
        };
        addServiceMonitoring(newService);

        res.status(201).json({ id, name, url, expected_status, check_interval });
    } catch (error) {
        console.error('Error creating service:', error);
        res.status(500).json({ error: 'Failed to create service' });
    }
});

router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const db = getDatabase();

        db.run('UPDATE services SET is_active = 0 WHERE id = ?', [id]);
        saveDatabase();

        // Stop monitoring this service
        stopServiceMonitoring(parseInt(id as string));

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({ error: 'Failed to delete service' });
    }
});

router.get('/:id/history', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { limit = 100 } = req.query;
        const db = getDatabase();

        const result = db.exec(`
            SELECT id, service_id, status, response_time, checked_at
            FROM service_history
            WHERE service_id = ?
            ORDER BY checked_at DESC
            LIMIT ?
        `, [id, parseInt(limit as string)]);

        if (result.length === 0 || result[0].values.length === 0) {
            return res.json([]);
        }

        const history = result[0].values.map((row: any[]) => ({
            id: row[0],
            serviceId: row[1],
            status: row[2],
            responseTime: row[3],
            checkedAt: row[4],
        }));

        res.json(history);
    } catch (error) {
        console.error('Error fetching service history:', error);
        res.status(500).json({ error: 'Failed to fetch service history' });
    }
});

router.get('/:id/stats', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { from, to } = req.query;
        const db = getDatabase();

        let query = `
            SELECT 
                COUNT(*) as total_checks,
                SUM(CASE WHEN status = (SELECT expected_status FROM services WHERE id = ?) THEN 1 ELSE 0 END) as successful_checks,
                AVG(response_time) as avg_response_time,
                MIN(response_time) as min_response_time,
                MAX(response_time) as max_response_time
            FROM service_history
            WHERE service_id = ?
        `;
        const params: any[] = [id, id];

        if (from) {
            query += ' AND checked_at >= ?';
            params.push(from);
        }

        if (to) {
            query += ' AND checked_at <= ?';
            params.push(to);
        }

        const result = db.exec(query, params);

        if (result.length === 0 || result[0].values.length === 0) {
            return res.json({});
        }

        const row = result[0].values[0];
        const totalChecks = row[0] as number;
        const successfulChecks = row[1] as number;
        const uptime = totalChecks > 0 ? (successfulChecks / totalChecks * 100) : 0;

        res.json({
            totalChecks,
            successfulChecks,
            failedChecks: totalChecks - successfulChecks,
            avgResponseTime: row[2] ? Math.round(row[2] as number) : null,
            minResponseTime: row[3],
            maxResponseTime: row[4],
            uptimePercent: Math.round(uptime * 100) / 100,
        });
    } catch (error) {
        console.error('Error fetching service stats:', error);
        res.status(500).json({ error: 'Failed to fetch service stats' });
    }
});

export default router;