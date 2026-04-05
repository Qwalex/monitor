/** Plain text for VK (no HTML in messages.send). */
export function htmlToPlain(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
}

const VK_API = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';

/** Same row as Telegram: persistent «Баланс» button. */
export function vkBalanceKeyboardJson(): string {
    return JSON.stringify({
        one_time: false,
        buttons: [
            [
                {
                    action: { type: 'text', label: '💰 Баланс', payload: '{}' },
                    color: 'primary',
                },
            ],
        ],
    });
}

export async function vkRawMethod<T>(method: string, params: Record<string, string>): Promise<T | null> {
    const token = process.env.VK_ACCESS_TOKEN;
    if (!token) return null;

    const body = new URLSearchParams({
        access_token: token,
        v: VK_API_VERSION,
        ...params,
    });

    try {
        const res = await fetch(`${VK_API}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        const data = (await res.json()) as { response?: T; error?: { error_msg: string; error_code: number } };
        if (data.error) {
            console.error('VK API error:', method, data.error.error_code, data.error.error_msg);
            return null;
        }
        return data.response ?? null;
    } catch (error) {
        console.error('VK API request failed:', method, error);
        return null;
    }
}

function chunkVkMessage(text: string, maxLen = 4096): string[] {
    if (text.length <= maxLen) return [text];
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
        parts.push(text.slice(i, i + maxLen));
    }
    return parts;
}

/**
 * Send from community bot to peer_id (user id in DM, or chat peer).
 * Optional keyboard: JSON string from vkBalanceKeyboardJson().
 */
export async function sendVkToPeer(peerId: string | number, text: string, keyboard?: string): Promise<boolean> {
    const token = process.env.VK_ACCESS_TOKEN;
    if (!token) return false;

    const chunks = chunkVkMessage(text);
    let ok = true;
    for (let i = 0; i < chunks.length; i++) {
        const body = new URLSearchParams({
            access_token: token,
            v: VK_API_VERSION,
            peer_id: String(peerId),
            message: chunks[i],
            random_id: String(Math.floor(Math.random() * 2 ** 31)),
        });
        if (keyboard !== undefined && i === chunks.length - 1) {
            body.set('keyboard', keyboard);
        }

        try {
            const res = await fetch(`${VK_API}/messages.send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            });
            const data = (await res.json()) as { response?: number; error?: { error_msg: string; error_code: number } };
            if (data.error) {
                console.error('VK API error:', data.error.error_code, data.error.error_msg);
                ok = false;
            }
        } catch (error) {
            console.error('VK send failed:', error);
            ok = false;
        }
    }
    return ok;
}

/**
 * Send a message from a VK community (group) bot.
 * Requires: community token with "Messages" permission, user must have started a dialog with the community.
 * Env: VK_ACCESS_TOKEN, VK_PEER_ID (user id or peer_id, e.g. 123456789).
 */
export async function trySendVkPlain(text: string): Promise<boolean> {
    const peerId = process.env.VK_PEER_ID;
    if (!peerId) {
        return false;
    }
    return sendVkToPeer(peerId, text);
}

export function isVkConfigured(): boolean {
    return Boolean(process.env.VK_ACCESS_TOKEN && process.env.VK_PEER_ID);
}

export function isVkLongPollConfigured(): boolean {
    return Boolean(process.env.VK_ACCESS_TOKEN && process.env.VK_GROUP_ID);
}

/** Всегда пишет в лог, что с VK настроено (без секретов). */
export function logVkStartupSummary(): void {
    const token = Boolean(process.env.VK_ACCESS_TOKEN?.trim());
    const peer = Boolean(process.env.VK_PEER_ID?.trim());
    const group = Boolean(process.env.VK_GROUP_ID?.trim());

    if (!token) {
        console.log(
            'VK: не активен — нет VK_ACCESS_TOKEN (файл .env должен быть в корне проекта или задайте переменные в Docker / systemd)'
        );
        return;
    }
    const parts: string[] = [];
    parts.push(
        peer
            ? 'алерты в VK при сбое Telegram (VK_PEER_ID задан)'
            : 'алерты в VK при сбое Telegram не уйдут без VK_PEER_ID'
    );
    parts.push(
        group
            ? 'Long Poll: кнопка «Баланс» и команды'
            : 'Long Poll выключен — укажите VK_GROUP_ID (id сообщества)'
    );
    console.log('VK:', parts.join('; '));
}
