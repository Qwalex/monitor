import { Router, Request, Response } from 'express';
import { getAppSetting, setAppSetting, APP_SETTING } from '../database.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
    try {
        const mnt_alert_threshold =
            parseFloat(await getAppSetting(APP_SETTING.MNT_ALERT_THRESHOLD, '2')) || 2;
        const mnt_low_reminder_hours =
            parseInt(await getAppSetting(APP_SETTING.MNT_LOW_REMINDER_HOURS, '24'), 10) || 24;
        res.json({ mnt_alert_threshold, mnt_low_reminder_hours });
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ error: 'Failed to read settings' });
    }
});

router.put('/', async (req: Request, res: Response) => {
    try {
        const { mnt_alert_threshold, mnt_low_reminder_hours } = req.body;

        if (mnt_alert_threshold === undefined && mnt_low_reminder_hours === undefined) {
            return res.status(400).json({ error: 'Укажите mnt_alert_threshold и/или mnt_low_reminder_hours' });
        }

        if (mnt_alert_threshold !== undefined) {
            const t =
                typeof mnt_alert_threshold === 'string'
                    ? parseFloat(mnt_alert_threshold)
                    : Number(mnt_alert_threshold);
            if (!Number.isFinite(t) || t <= 0) {
                return res.status(400).json({ error: 'mnt_alert_threshold должен быть числом > 0' });
            }
            await setAppSetting(APP_SETTING.MNT_ALERT_THRESHOLD, String(t));
        }

        if (mnt_low_reminder_hours !== undefined) {
            const h = parseInt(String(mnt_low_reminder_hours), 10);
            if (!Number.isFinite(h) || h < 1 || h > 8760) {
                return res.status(400).json({
                    error: 'mnt_low_reminder_hours должен быть от 1 до 8760 (часов)',
                });
            }
            await setAppSetting(APP_SETTING.MNT_LOW_REMINDER_HOURS, String(h));
        }

        const out = {
            mnt_alert_threshold:
                parseFloat(await getAppSetting(APP_SETTING.MNT_ALERT_THRESHOLD, '2')) || 2,
            mnt_low_reminder_hours:
                parseInt(await getAppSetting(APP_SETTING.MNT_LOW_REMINDER_HOURS, '24'), 10) || 24,
        };
        res.json(out);
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

export default router;
