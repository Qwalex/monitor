import { accountsCollection, getAppSetting, APP_SETTING } from './database.js';
import type { CoinBalanceRow } from './bybit.js';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * После успешного получения балансов: если MNT &lt; порога — уведомление (Telegram/VK вызывают снаружи).
 * Порог и интервал напоминаний — в коллекции `app_settings` (см. GET/PUT /api/settings).
 */
export async function buildMntLowAlertHtmlIfNeeded(
    accountId: number,
    accountName: string,
    coinRows: CoinBalanceRow[]
): Promise<string | null> {
    const threshold = parseFloat(await getAppSetting(APP_SETTING.MNT_ALERT_THRESHOLD, '2'));
    if (!Number.isFinite(threshold) || threshold <= 0) {
        return null;
    }

    const reminderHours = parseInt(await getAppSetting(APP_SETTING.MNT_LOW_REMINDER_HOURS, '24'), 10) || 24;
    const reminderMs = reminderHours * 3600000;

    const mntRow = coinRows.find((r) => r.coin.toUpperCase() === 'MNT');

    if (!mntRow || !Number.isFinite(mntRow.balance)) {
        await accountsCollection().updateOne({ _id: accountId }, { $set: { mnt_low_notified_at: null } });
        return null;
    }

    const mnt = mntRow.balance;

    if (mnt >= threshold) {
        await accountsCollection().updateOne({ _id: accountId }, { $set: { mnt_low_notified_at: null } });
        return null;
    }

    const acc = await accountsCollection().findOne({ _id: accountId }, { projection: { mnt_low_notified_at: 1 } });
    const lastIso = acc?.mnt_low_notified_at ?? null;
    const now = Date.now();

    if (lastIso) {
        const last = new Date(lastIso).getTime();
        if (now - last < reminderMs) {
            return null;
        }
    }

    const isoNow = new Date().toISOString();
    await accountsCollection().updateOne({ _id: accountId }, { $set: { mnt_low_notified_at: isoNow } });

    return `⚠️ <b>Низкий баланс MNT</b>

Аккаунт: <b>${escapeHtml(accountName)}</b>
Остаток MNT: ${mnt.toFixed(6)}
Порог: &lt; ${threshold}

Пополните MNT, пока баланс не истёк.`;
}
