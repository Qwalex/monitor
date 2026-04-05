import { getDatabase, saveDatabase } from './database.js';

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

function rowToService(row: any[]): Service {
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

export function startServiceMonitoring(onStatusChange: (service: Service, isUp: boolean, downtime?: number) => void): void {
    const db = getDatabase();
    const result = db.exec(
        'SELECT id, name, url, expected_status, check_interval, last_status, downtime_started_at, notify_alerts FROM services WHERE is_active = 1'
    );

    if (result.length === 0 || result[0].values.length === 0) {
        console.log('No services to monitor');
        return;
    }

    for (const row of result[0].values) {
        startMonitoringService(rowToService(row), onStatusChange);
    }

    console.log(`Service monitoring started for ${result[0].values.length} services`);
}

function startMonitoringService(
    service: Service, 
    onStatusChange: (service: Service, isUp: boolean, downtime?: number) => void
): void {
    if (checkTimers.has(service.id)) {
        clearInterval(checkTimers.get(service.id)!);
    }

    const check = async () => {
        const db = getDatabase();
        const fresh = db.exec(
            'SELECT id, name, url, expected_status, check_interval, last_status, downtime_started_at, notify_alerts FROM services WHERE id = ? AND is_active = 1',
            [service.id]
        );
        if (!fresh.length || !fresh[0].values.length) {
            stopServiceMonitoring(service.id);
            return;
        }
        const current = rowToService(fresh[0].values[0]);
        const result = await checkService(current);
        await handleCheckResult(current, result, onStatusChange);
    };

    check();
    const timer = setInterval(check, service.check_interval * 1000);
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
    const db = getDatabase();
    const now = new Date().toISOString();
    const expected = Number(service.expected_status);
    const currUp = Number(result.status) === expected;

    db.run(
        'INSERT INTO service_history (service_id, status, response_time, checked_at) VALUES (?, ?, ?, ?)',
        [service.id, result.status, result.responseTime, now]
    );

    const prevStatus = service.last_status;
    const prevHealth: 'up' | 'down' | 'unknown' =
        prevStatus === null
            ? 'unknown'
            : Number(prevStatus) === expected
              ? 'up'
              : 'down';

    /** Notify only on healthy↔unhealthy transitions, not on every poll or on HTTP code changes while still down. */
    const becameDown = prevHealth === 'up' && !currUp;
    const becameUp = prevHealth === 'down' && currUp;

    if (becameDown) {
        db.run('UPDATE services SET last_check_at = ?, last_status = ?, downtime_started_at = ? WHERE id = ?', [
            now,
            result.status,
            now,
            service.id,
        ]);
        if (service.notify_alerts) {
            onStatusChange(service, false);
        }
    } else if (becameUp) {
        let downtimeSeconds: number | undefined;
        if (service.downtime_started_at) {
            downtimeSeconds = Math.round(
                (Date.now() - new Date(service.downtime_started_at).getTime()) / 1000
            );
        }
        db.run('UPDATE services SET last_check_at = ?, last_status = ?, downtime_started_at = NULL WHERE id = ?', [
            now,
            result.status,
            service.id,
        ]);
        if (service.notify_alerts) {
            onStatusChange(service, true, downtimeSeconds);
        }
    } else {
        if (!currUp && prevHealth === 'down' && !service.downtime_started_at) {
            db.run('UPDATE services SET last_check_at = ?, last_status = ?, downtime_started_at = ? WHERE id = ?', [
                now,
                result.status,
                now,
                service.id,
            ]);
        } else {
            db.run('UPDATE services SET last_check_at = ?, last_status = ? WHERE id = ?', [
                now,
                result.status,
                service.id,
            ]);
        }
    }

    saveDatabase();
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