import { getBalancesMessage } from './telegram.js';
import { htmlToPlain, sendVkToPeer, vkBalanceKeyboardJson, vkRawMethod } from './vk.js';

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function isVkUserAuthorized(fromId: number): boolean {
    const allowed = process.env.VK_PEER_ID;
    if (!allowed) return true;
    return String(fromId) === String(allowed).trim();
}

function normalizeCommand(text: string): string {
    return text.trim().toLowerCase().replace(/^\/+/, '');
}

function isBalanceRequest(text: string): boolean {
    if (text.trim().toLowerCase() === '💰 баланс') return true;
    const cmd = normalizeCommand(text);
    return cmd === 'balance' || cmd === 'баланс' || cmd === 'bal';
}

function helpTextVk(): string {
    return [
        '🤖 Monitor (VK)',
        '',
        'Команды: баланс, /balance',
        'Или нажмите кнопку «💰 Баланс» ниже.',
    ].join('\n');
}

/** Ignore outgoing and duplicates (VK may repeat updates). */
const recentMessageIds = new Set<number>();
const RECENT_CAP = 2000;

function rememberMessageId(id: number): boolean {
    if (recentMessageIds.has(id)) return false;
    recentMessageIds.add(id);
    if (recentMessageIds.size > RECENT_CAP) {
        const first = recentMessageIds.values().next().value;
        if (first !== undefined) recentMessageIds.delete(first);
    }
    return true;
}

interface LongPollServer {
    key: string;
    server: string;
    ts: string;
}

/** VK иногда отдаёт server уже с https:// — нельзя делать https://https://... */
function longPollCheckUrl(server: string, key: string, ts: string): string {
    const trimmed = server.trim();
    const base = /^https?:\/\//i.test(trimmed)
        ? trimmed.replace(/\/$/, '')
        : `https://${trimmed.replace(/^\/+/, '')}`;
    const joiner = base.includes('?') ? '&' : '?';
    return `${base}${joiner}act=a_check&key=${encodeURIComponent(key)}&ts=${encodeURIComponent(ts)}&wait=25`;
}

interface VkMessage {
    id: number;
    date: number;
    peer_id: number;
    from_id: number;
    text?: string;
    out?: number;
}

interface MessageNewUpdate {
    type: 'message_new';
    object: { message: VkMessage };
}

function isMessageNew(u: { type: string }): u is MessageNewUpdate {
    return u.type === 'message_new';
}

async function handleIncomingMessage(msg: VkMessage): Promise<void> {
    if (msg.out === 1) return;
    if (!rememberMessageId(msg.id)) return;

    const fromId = msg.from_id;
    if (!fromId || fromId < 1) return;

    if (!isVkUserAuthorized(fromId)) {
        await sendVkToPeer(msg.peer_id, 'Вы не авторизованы. Укажите ваш VK id в VK_PEER_ID в настройках сервера.');
        return;
    }

    const text = (msg.text || '').trim();
    if (!text) return;

    const lower = text.toLowerCase();
    if (lower === 'начать' || lower === 'start' || lower === '/start') {
        await sendVkToPeer(msg.peer_id, helpTextVk(), vkBalanceKeyboardJson());
        return;
    }

    if (isBalanceRequest(text)) {
        const html = await getBalancesMessage();
        const plain = htmlToPlain(html);
        await sendVkToPeer(msg.peer_id, plain, vkBalanceKeyboardJson());
        return;
    }
}

async function longPollSession(): Promise<void> {
    const groupId = process.env.VK_GROUP_ID;
    if (!groupId) return;

    let serverInfo = await vkRawMethod<LongPollServer>('groups.getLongPollServer', {
        group_id: groupId,
    });
    if (!serverInfo) {
        throw new Error('groups.getLongPollServer failed');
    }

    let { key, server, ts } = serverInfo;

    for (;;) {
        const url = longPollCheckUrl(server, key, ts);
        const res = await fetch(url);
        const data = (await res.json()) as {
            ts?: string;
            updates?: unknown[];
            failed?: number;
        };

        if (data.failed === 2 || data.failed === 3) {
            serverInfo = await vkRawMethod<LongPollServer>('groups.getLongPollServer', {
                group_id: groupId,
            });
            if (!serverInfo) {
                await sleep(3000);
                continue;
            }
            key = serverInfo.key;
            server = serverInfo.server;
            ts = serverInfo.ts;
            continue;
        }

        if (data.failed === 1) {
            if (data.ts) ts = data.ts;
            continue;
        }

        if (data.ts) {
            ts = data.ts;
        }

        const updates = data.updates || [];
        for (const raw of updates) {
            const u = raw as { type: string; object?: { message?: VkMessage } };
            if (!isMessageNew(u)) continue;
            const m = u.object?.message;
            if (m) {
                try {
                    await handleIncomingMessage(m);
                } catch (e) {
                    console.error('VK handler error:', e);
                }
            }
        }
    }
}

/**
 * Incoming messages + keyboard (Long Poll). Needs VK_ACCESS_TOKEN and VK_GROUP_ID (id сообщества, число).
 * VK_PEER_ID: если задан — отвечают только этому пользователю (как TELEGRAM_CHAT_ID).
 */
export function startVkLongPoll(): void {
    if (!process.env.VK_ACCESS_TOKEN || !process.env.VK_GROUP_ID) {
        return;
    }
    console.log('VK Long Poll started (кнопка «Баланс» и команды баланс / balance)');
    void (async function vkPollLoop() {
        for (;;) {
            try {
                await longPollSession();
            } catch (e) {
                console.error('VK Long Poll session error, retry in 5s:', e);
                await sleep(5000);
            }
        }
    })();
}
