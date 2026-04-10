import { servicesCollection, serviceHistoryCollection, nextId, type ServiceDoc } from './database.js';

export interface Service {
    id: number;
    name: string;
    url: string;
    expected_status: number;
    check_interval: number;
    last_status: number | null;
    downtime_started_at: string | null;
    /** 1 = send Telegram alerts on down/up, 0 = silent monitoring */
    notify_alerts: number;
}

let checkTimers: Map<number, NodeJS.Timeout> = new Map();

function docToService(doc: Pick<
    ServiceDoc,
    | '_id'
    | 'name'
    | 'url'
    | 'expected_status'
    | 'check_interval'
    | 'last_status'
    | 'downtime_started_at'
    | 'notify_alerts'
>): Service {
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

export async function startServiceMonitoring(
    onStatusChange: (service: Service, isUp: boolean, downtime?: number) => void
): Promise<void> {
    const docs = await servicesCollection().find({ is_active: 1 }).toArray();

    if (docs.length === 0) {
        console.log('No services to monitor');
        return;
    }

    for (const row of docs) {
        startMonitoringService(docToService(row), onStatusChange);
    }

    console.log(`Service monitoring started for ${docs.length} services`);
}

function startMonitoringService(
    service: Service,
    onStatusChange: (service: Service, isUp: boolean, downtime?: number) => void
): void {
    if (checkTimers.has(service.id)) {
        clearInterval(checkTimers.get(service.id)!);
    }

    const check = async () => {
        const fresh = await servicesCollection().findOne({ _id: service.id, is_active: 1 });
        if (!fresh) {
            stopServiceMonitoring(service.id);
            return;
        }
        const current = docToService(fresh);
        const result = await checkService(current);
        await handleCheckResult(current, result, onStatusChange);
    };

    void check();
    const timer = setInterval(() => void check(), service.check_interval * 1000);
    checkTimers.set(service.id, timer);
}

async function checkService(service: Service): Promise<{ status: number; responseTime: number; error?: string }> {
    const startTime = Date.now();

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(service.url, {
            signal: controller.signal,
            method: 'GET',
        });

        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        return {
            status: response.status,
            responseTime,
        };
    } catch (error: any) {
        const responseTime = Date.now() - startTime;
        return {
            status: 0,
            responseTime,
            error: error.message || 'Unknown error',
        };
    }
}

async function handleCheckResult(
    service: Service,
    result: { status: number; responseTime: number; error?: string },
    onStatusChange: (service: Service, isUp: boolean, downtime?: number) => void
): Promise<void> {
    const now = new Date().toISOString();
    const expected = Number(service.expected_status);
    const currUp = Number(result.status) === expected;

    const histId = await nextId('service_history');
    await serviceHistoryCollection().insertOne({
        _id: histId,
        service_id: service.id,
        status: result.status,
        response_time: result.responseTime,
        checked_at: now,
    });

    const prevStatus = service.last_status;
    const prevHealth: 'up' | 'down' | 'unknown' =
        prevStatus === null ? 'unknown' : Number(prevStatus) === expected ? 'up' : 'down';

    /** Notify only on healthy↔unhealthy transitions, not on every poll or on HTTP code changes while still down. */
    const becameDown = prevHealth === 'up' && !currUp;
    const becameUp = prevHealth === 'down' && currUp;

    if (becameDown) {
        await servicesCollection().updateOne(
            { _id: service.id },
            {
                $set: {
                    last_check_at: now,
                    last_status: result.status,
                    downtime_started_at: now,
                },
            }
        );
        if (service.notify_alerts) {
            onStatusChange(service, false);
        }
    } else if (becameUp) {
        let downtimeSeconds: number | undefined;
        if (service.downtime_started_at) {
            downtimeSeconds = Math.round((Date.now() - new Date(service.downtime_started_at).getTime()) / 1000);
        }
        await servicesCollection().updateOne(
            { _id: service.id },
            {
                $set: {
                    last_check_at: now,
                    last_status: result.status,
                    downtime_started_at: null,
                },
            }
        );
        if (service.notify_alerts) {
            onStatusChange(service, true, downtimeSeconds);
        }
    } else {
        if (!currUp && prevHealth === 'down' && !service.downtime_started_at) {
            await servicesCollection().updateOne(
                { _id: service.id },
                {
                    $set: {
                        last_check_at: now,
                        last_status: result.status,
                        downtime_started_at: now,
                    },
                }
            );
        } else {
            await servicesCollection().updateOne(
                { _id: service.id },
                {
                    $set: {
                        last_check_at: now,
                        last_status: result.status,
                    },
                }
            );
        }
    }
}

export function addServiceMonitoring(
    service: Service,
    onStatusChange?: (service: Service, isUp: boolean, downtime?: number) => void
): void {
    console.log(`[Services] addServiceMonitoring called for: ${service.name} (id=${service.id})`);
    const callback = onStatusChange || (() => {});
    try {
        startMonitoringService(service, callback);
        console.log(`[Services] Monitoring started successfully for: ${service.name}`);
    } catch (error) {
        console.error(`[Services] Failed to start monitoring for ${service.name}:`, error);
    }
}

export function stopServiceMonitoring(serviceId: number): void {
    if (checkTimers.has(serviceId)) {
        clearInterval(checkTimers.get(serviceId)!);
        checkTimers.delete(serviceId);
    }
}

export function stopAllServiceMonitoring(): void {
    for (const timer of checkTimers.values()) {
        clearInterval(timer);
    }
    checkTimers.clear();
}
