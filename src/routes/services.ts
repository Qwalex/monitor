import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase } from '../database.js';
import type { Service as MonitoringService } from '../services.js';
import { startServiceMonitoring, addServiceMonitoring, stopServiceMonitoring } from '../services.js';
import { sendServiceDownAlert, sendServiceUpAlert } from '../bot/telegram.js';

const router = Router();

function onServiceStatusChange(service: MonitoringService, isUp: boolean, downtime?: number): void {
    if (isUp) {
        sendServiceUpAlert(service, downtime);
    } else {
        sendServiceDownAlert(service);
    }
}

function rowToMonitoringService(row: any[]): MonitoringService {
    return {
        id: row[0] as number,
        name: row[1] as string,
        url: row[2] as string,
        expected_status: row[3] as number,
        check_interval: row[4] as number,
        last_status: row[5] as number | null,
        downtime_started_at: row[6] as string | null,
        notify_alerts: (row[7] as number) ?? 1,
    };
}

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
    notify_alerts: number;
}

router.get('/', (_req: Request, res: Response) => {
    try {
        const db = getDatabase();
        const result = db.exec(`
            SELECT id, name, url, expected_status, check_interval, is_active, created_at, last_check_at, last_status, downtime_started_at, notify_alerts
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
            notify_alerts: row[10] ?? 1,
        }));

        res.json(services);
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ error: 'Failed to fetch services' });
    }
});

router.get('/:id', (req: Request, res: Response) => {
    try {
        const serviceId = parseInt(req.params.id as string, 10);
        if (Number.isNaN(serviceId)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const db = getDatabase();
        const result = db.exec(
            `
            SELECT id, name, url, expected_status, check_interval, is_active, created_at, last_check_at, last_status, downtime_started_at, notify_alerts
            FROM services
            WHERE id = ? AND is_active = 1
        `,
            [serviceId]
        );

        if (!result.length || !result[0].values.length) {
            return res.status(404).json({ error: 'Service not found' });
        }

        const row = result[0].values[0];
        res.json({
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
            notify_alerts: row[10] ?? 1,
        });
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({ error: 'Failed to fetch service' });
    }
});

router.post('/', (req: Request, res: Response, next) => {
    console.log('[Services] POST /api/services called', req.body);
    try {
        const { name, url, expected_status = 200, check_interval = 60, notify_alerts = true } = req.body;
        const notifyFlag = notify_alerts === false || notify_alerts === 0 ? 0 : 1;

        if (!name || !url) {
            return res.status(400).json({ error: 'Missing required fields: name, url' });
        }

        const db = getDatabase();
        db.run(
            'INSERT INTO services (name, url, expected_status, check_interval, created_at, notify_alerts) VALUES (?, ?, ?, ?, ?, ?)',
            [name, url, expected_status, check_interval, new Date().toISOString(), notifyFlag]
        );

        // Get the last inserted ID before saving
        const result = db.exec('SELECT last_insert_rowid() as id');
        let id = result[0].values[0][0] as number;

        // Save after getting ID
        saveDatabase();

        // If ID is 0, fetch the max ID as fallback
        if (id === 0) {
            const maxResult = db.exec('SELECT MAX(id) as max_id FROM services');
            id = maxResult[0].values[0][0] as number;
        }

        console.log(`[Services] Inserted service with id=${id}`);

        // Start monitoring the new service
        const newService: Service = {
            id: id,
            name,
            url,
            expected_status,
            check_interval,
            is_active: 1,
            created_at: new Date().toISOString(),
            last_check_at: null,
            last_status: null,
            downtime_started_at: null,
            notify_alerts: notifyFlag,
        };
        console.log(`[Services] Starting monitoring for: ${name} (${url})`);

        // Start monitoring immediately (first check will happen synchronously)
        addServiceMonitoring(newService, onServiceStatusChange);

        console.log(`[Services] Monitoring started for service id=${id}`);

        res.status(201).json({ id, name, url, expected_status, check_interval, notify_alerts: notifyFlag });
    } catch (error) {
        console.error('Error creating service:', error);
        res.status(500).json({ error: 'Failed to create service' });
        next(error);
    }
});

router.put('/:id', (req: Request, res: Response, next) => {
    try {
        const serviceId = parseInt(req.params.id as string, 10);
        if (Number.isNaN(serviceId)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const { name, url, expected_status = 200, check_interval = 60, notify_alerts = true } = req.body;
        const notifyFlag = notify_alerts === false || notify_alerts === 0 ? 0 : 1;

        if (!name || !url) {
            return res.status(400).json({ error: 'Missing required fields: name, url' });
        }

        const db = getDatabase();
        const exists = db.exec('SELECT id FROM services WHERE id = ? AND is_active = 1', [serviceId]);
        if (!exists.length || !exists[0].values.length) {
            return res.status(404).json({ error: 'Service not found' });
        }

        stopServiceMonitoring(serviceId);

        db.run(
            'UPDATE services SET name = ?, url = ?, expected_status = ?, check_interval = ?, notify_alerts = ? WHERE id = ?',
            [name, url, expected_status, check_interval, notifyFlag, serviceId]
        );
        saveDatabase();

        const refreshed = db.exec(
            'SELECT id, name, url, expected_status, check_interval, last_status, downtime_started_at, notify_alerts FROM services WHERE id = ?',
            [serviceId]
        );
        if (!refreshed.length || !refreshed[0].values.length) {
            return res.status(500).json({ error: 'Failed to load updated service' });
        }

        addServiceMonitoring(rowToMonitoringService(refreshed[0].values[0]), onServiceStatusChange);

        res.json({
            id: serviceId,
            name,
            url,
            expected_status,
            check_interval,
            notify_alerts: notifyFlag,
        });
    } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).json({ error: 'Failed to update service' });
        next(error);
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

router.patch('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const serviceId = parseInt(id as string, 10);
        if (Number.isNaN(serviceId)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const { notify_alerts } = req.body;
        if (notify_alerts === undefined) {
            return res.status(400).json({ error: 'Missing notify_alerts (boolean or 0/1)' });
        }

        const notifyFlag = notify_alerts === false || notify_alerts === 0 ? 0 : 1;
        const db = getDatabase();

        const exists = db.exec('SELECT id FROM services WHERE id = ? AND is_active = 1', [serviceId]);
        if (!exists.length || !exists[0].values.length) {
            return res.status(404).json({ error: 'Service not found' });
        }

        db.run('UPDATE services SET notify_alerts = ? WHERE id = ?', [notifyFlag, serviceId]);
        saveDatabase();

        res.json({ id: serviceId, notify_alerts: notifyFlag });
    } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).json({ error: 'Failed to update service' });
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