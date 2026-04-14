import { Router, Request, Response } from 'express';
import { sendHtmlToAll } from '../bot/telegram.js';

const router = Router();

interface RailwayWebhookPayload {
    type?: string;
    severity?: string;
    timestamp?: string;
    details?: {
        status?: string;
        source?: string;
        branch?: string;
        commitHash?: string;
        commitAuthor?: string;
        commitMessage?: string;
    };
    resource?: {
        project?: { name?: string };
        environment?: { name?: string };
        service?: { name?: string };
    };
}

function getBearerToken(value: string | undefined): string | null {
    if (!value) return null;
    const match = value.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? null;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRailwayMessage(payload: RailwayWebhookPayload): string {
    const eventType = payload.type ?? 'unknown';
    const severity = payload.severity ?? 'INFO';
    const project = payload.resource?.project?.name ?? 'unknown';
    const environment = payload.resource?.environment?.name ?? 'unknown';
    const service = payload.resource?.service?.name ?? 'unknown';
    const status = payload.details?.status ?? 'unknown';
    const source = payload.details?.source ?? 'unknown';
    const branch = payload.details?.branch ?? '';
    const commitHash = payload.details?.commitHash ?? '';
    const shortHash = commitHash ? commitHash.slice(0, 8) : '';
    const author = payload.details?.commitAuthor ?? '';
    const commitMessage = payload.details?.commitMessage ?? '';
    const timestamp = payload.timestamp
        ? new Date(payload.timestamp).toLocaleString('ru-RU')
        : new Date().toLocaleString('ru-RU');

    const lines = [
        `🚆 <b>Railway event</b>`,
        ``,
        `Тип: <b>${escapeHtml(eventType)}</b>`,
        `Severity: ${escapeHtml(severity)}`,
        `Проект: ${escapeHtml(project)}`,
        `Окружение: ${escapeHtml(environment)}`,
        `Сервис: ${escapeHtml(service)}`,
        `Статус: ${escapeHtml(status)}`,
        `Источник: ${escapeHtml(source)}`,
    ];

    if (branch) {
        lines.push(`Ветка: ${escapeHtml(branch)}`);
    }
    if (shortHash) {
        lines.push(`Коммит: <code>${escapeHtml(shortHash)}</code>`);
    }
    if (author) {
        lines.push(`Автор: ${escapeHtml(author)}`);
    }
    if (commitMessage) {
        lines.push(`Сообщение: ${escapeHtml(commitMessage)}`);
    }

    lines.push(`Время: ${escapeHtml(timestamp)}`);

    return lines.join('\n');
}

router.post('/webhook', async (req: Request, res: Response) => {
    const configuredToken = process.env.RAILWAY_WEBHOOK_TOKEN;

    if (configuredToken) {
        const authHeader = req.header('authorization');
        const headerToken = getBearerToken(authHeader ?? undefined) ?? req.header('x-railway-token');
        const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
        const providedToken = headerToken ?? queryToken;

        if (providedToken !== configuredToken) {
            return res.status(401).json({ error: 'Unauthorized webhook request' });
        }
    }

    const payload: RailwayWebhookPayload = req.body ?? {};

    try {
        await sendHtmlToAll(formatRailwayMessage(payload));
        return res.json({ ok: true });
    } catch (error) {
        console.error('Failed to process Railway webhook:', error);
        return res.status(500).json({ error: 'Failed to process webhook' });
    }
});

export default router;
