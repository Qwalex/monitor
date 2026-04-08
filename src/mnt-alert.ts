import { getDatabase, saveDatabase, getAppSetting, APP_SETTING } from './database.js';
import type { CoinBalanceRow } from './bybit.js';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * После успешного получения балансов: если MNT &lt; порога — уведомление (Telegram/VK вызывают снаружи).
 * Порог и интервал напоминаний — в таблице `app_settings` (см. GET/PUT /api/settings).
 */
export function buildMntLowAlertHtmlIfNeeded(
    accountId: number,
    accountName: string,
    coinRows: CoinBalanceRow[]
): string | null {
    const threshold = parseFloat(getAppSetting(APP_SETTING.MNT_ALERT_THRESHOLD, '2'));
    if (!Number.isFinite(threshold) || threshold <= 0) {
        return null;
    }

    const reminderHours = parseInt(getAppSetting(APP_SETTING.MNT_LOW_REMINDER_HOURS, '24'), 10) || 24;
    const reminderMs = reminderHours * 3600000;

    const mntRow = coinRows.find((r) => r.coin.toUpperCase() === 'MNT');
    const db = getDatabase();

    if (!mntRow || !Number.isFinite(mntRow.balance)) {
        db.run('UPDATE accounts SET mnt_low_notified_at = NULL WHERE id = ?', [accountId]);
        saveDatabase();
        return null;
    }

    const mnt = mntRow.balance;

    if (mnt >= threshold) {
        db.run('UPDATE accounts SET mnt_low_notified_at = NULL WHERE id = ?', [accountId]);
        saveDatabase();
        return null;
    }

    const info = db.exec('SELECT mnt_low_notified_at FROM accounts WHERE id = ?', [accountId]);
    const lastIso = info[0]?.values?.[0]?.[0] as string | null | undefined;
    const now = Date.now();

    if (lastIso) {
        const last = new Date(lastIso).getTime();
        if (now - last < reminderMs) {
            return null;
        }
    }

    const isoNow = new Date().toISOString();
    db.run('UPDATE accounts SET mnt_low_notified_at = ? WHERE id = ?', [isoNow, accountId]);
    saveDatabase();

    return `⚠️ <b>Низкий баланс MNT</b>

Аккаунт: <b>${escapeHtml(accountName)}</b>
Остаток MNT: ${mnt.toFixed(6)}
Порог: &lt; ${threshold}

Пополните MNT, пока баланс не истёк.`;
}
