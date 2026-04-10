import { Router, Request, Response } from 'express';
import { servicesCollection, serviceHistoryCollection, nextId } from '../database.js';
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

function rowToMonitoringService(doc: {
    _id: number;
    name: string;
    url: string;
    expected_status: number;
    check_interval: number;
    last_status: number | null;
    downtime_started_at: string | null;
    notify_alerts: number;
}): MonitoringService {
    return {
        id: doc._id,
        name: doc.name,
        url: doc.url,
        expected_status: doc.expected_status,
        check_interval: doc.check_interval,
        last_status: doc.last_status,
        downtime_started_at: doc.downtime_started_at,
        notify_alerts: doc.notify_alerts ?? 1,
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

function serviceToApi(d: {
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
}): Service {
    return {
        id: d._id,
        name: d.name,
        url: d.url,
        expected_status: d.expected_status,
        check_interval: d.check_interval,
        is_active: d.is_active,
        created_at: d.created_at,
        last_check_at: d.last_check_at,
        last_status: d.last_status,
        downtime_started_at: d.downtime_started_at,
        notify_alerts: d.notify_alerts ?? 1,
    };
}

router.get('/', async (_req: Request, res: Response) => {
    try {
        const docs = await servicesCollection().find({ is_active: 1 }).sort({ _id: 1 }).toArray();
        res.json(docs.map(serviceToApi));
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ error: 'Failed to fetch services' });
    }
});

router.get('/:id', async (req: Request, res: Response) => {
    try {
        const serviceId = parseInt(req.params.id as string, 10);
        if (Number.isNaN(serviceId)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const d = await servicesCollection().findOne({ _id: serviceId, is_active: 1 });
        if (!d) {
            return res.status(404).json({ error: 'Service not found' });
        }

        res.json(serviceToApi(d));
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({ error: 'Failed to fetch service' });
    }
});

router.post('/', (req: Request, res: Response, next) => {
    void (async () => {
        console.log('[Services] POST /api/services called', req.body);
        try {
            const { name, url, expected_status = 200, check_interval = 60, notify_alerts = true } = req.body;
            const notifyFlag = notify_alerts === false || notify_alerts === 0 ? 0 : 1;

            if (!name || !url) {
                return res.status(400).json({ error: 'Missing required fields: name, url' });
            }

            const id = await nextId('services');
            const created_at = new Date().toISOString();
            await servicesCollection().insertOne({
                _id: id,
                name,
                url,
                expected_status,
                check_interval,
                is_active: 1,
                created_at,
                last_check_at: null,
                last_status: null,
                downtime_started_at: null,
                notify_alerts: notifyFlag,
            });

            console.log(`[Services] Inserted service with id=${id}`);

            console.log(`[Services] Starting monitoring for: ${name} (${url})`);

            addServiceMonitoring(
                {
                    id,
                    name,
                    url,
                    expected_status,
                    check_interval,
                    last_status: null,
                    downtime_started_at: null,
                    notify_alerts: notifyFlag,
                },
                onServiceStatusChange
            );

            console.log(`[Services] Monitoring started for service id=${id}`);

            res.status(201).json({ id, name, url, expected_status, check_interval, notify_alerts: notifyFlag });
        } catch (error) {
            console.error('Error creating service:', error);
            res.status(500).json({ error: 'Failed to create service' });
            next(error);
        }
    })();
});

router.put('/:id', (req: Request, res: Response, next) => {
    void (async () => {
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

            const exist = await servicesCollection().findOne({ _id: serviceId, is_active: 1 });
            if (!exist) {
                return res.status(404).json({ error: 'Service not found' });
            }

            stopServiceMonitoring(serviceId);

            await servicesCollection().updateOne(
                { _id: serviceId },
                {
                    $set: {
                        name,
                        url,
                        expected_status,
                        check_interval,
                        notify_alerts: notifyFlag,
                    },
                }
            );

            const refreshed = await servicesCollection().findOne({ _id: serviceId });
            if (!refreshed) {
                return res.status(500).json({ error: 'Failed to load updated service' });
            }

            addServiceMonitoring(rowToMonitoringService(refreshed), onServiceStatusChange);

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
    })();
});

router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        await servicesCollection().updateOne({ _id: id }, { $set: { is_active: 0 } });

        stopServiceMonitoring(id);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({ error: 'Failed to delete service' });
    }
});

router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const serviceId = parseInt(req.params.id as string, 10);
        if (Number.isNaN(serviceId)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const { notify_alerts } = req.body;
        if (notify_alerts === undefined) {
            return res.status(400).json({ error: 'Missing notify_alerts (boolean or 0/1)' });
        }

        const notifyFlag = notify_alerts === false || notify_alerts === 0 ? 0 : 1;

        const exist = await servicesCollection().findOne({ _id: serviceId, is_active: 1 });
        if (!exist) {
            return res.status(404).json({ error: 'Service not found' });
        }

        await servicesCollection().updateOne({ _id: serviceId }, { $set: { notify_alerts: notifyFlag } });

        res.json({ id: serviceId, notify_alerts: notifyFlag });
    } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).json({ error: 'Failed to update service' });
    }
});

router.get('/:id/history', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const { limit = '100' } = req.query;
        const lim = Math.min(5000, Math.max(1, parseInt(String(limit), 10) || 100));

        const rows = await serviceHistoryCollection()
            .find({ service_id: id })
            .sort({ checked_at: -1 })
            .limit(lim)
            .toArray();

        const history = rows.map((row) => ({
            id: row._id,
            serviceId: row.service_id,
            status: row.status,
            responseTime: row.response_time,
            checkedAt: row.checked_at,
        }));

        res.json(history);
    } catch (error) {
        console.error('Error fetching service history:', error);
        res.status(500).json({ error: 'Failed to fetch service history' });
    }
});

router.get('/:id/stats', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid service id' });
        }

        const { from, to } = req.query;

        const svc = await servicesCollection().findOne({ _id: id });
        if (!svc) {
            return res.status(404).json({ error: 'Service not found' });
        }
        const expectedStatus = svc.expected_status;

        const match: Record<string, unknown> = { service_id: id };
        const checked: Record<string, string> = {};
        if (from) checked.$gte = String(from);
        if (to) checked.$lte = String(to);
        if (Object.keys(checked).length > 0) {
            match.checked_at = checked;
        }

        const agg = await serviceHistoryCollection()
            .aggregate<{
                total_checks: number;
                successful_checks: number;
                avg_response_time: number | null;
                min_response_time: number | null;
                max_response_time: number | null;
            }>([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        total_checks: { $sum: 1 },
                        successful_checks: {
                            $sum: { $cond: [{ $eq: ['$status', expectedStatus] }, 1, 0] },
                        },
                        avg_response_time: { $avg: '$response_time' },
                        min_response_time: { $min: '$response_time' },
                        max_response_time: { $max: '$response_time' },
                    },
                },
            ])
            .toArray();

        if (agg.length === 0) {
            return res.json({
                totalChecks: 0,
                successfulChecks: 0,
                failedChecks: 0,
                avgResponseTime: null,
                minResponseTime: null,
                maxResponseTime: null,
                uptimePercent: 0,
            });
        }

        const row = agg[0];
        const totalChecks = row.total_checks;
        const successfulChecks = row.successful_checks;
        const uptime = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0;

        res.json({
            totalChecks,
            successfulChecks,
            failedChecks: totalChecks - successfulChecks,
            avgResponseTime: row.avg_response_time != null ? Math.round(row.avg_response_time) : null,
            minResponseTime: row.min_response_time,
            maxResponseTime: row.max_response_time,
            uptimePercent: Math.round(uptime * 100) / 100,
        });
    } catch (error) {
        console.error('Error fetching service stats:', error);
        res.status(500).json({ error: 'Failed to fetch service stats' });
    }
});

export default router;
