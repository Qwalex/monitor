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

/**
 * Send a message from a VK community (group) bot.
 * Requires: community token with "Messages" permission, user must have started a dialog with the community.
 * Env: VK_ACCESS_TOKEN, VK_PEER_ID (user id or peer_id, e.g. 123456789).
 */
export async function trySendVkPlain(text: string): Promise<boolean> {
    const token = process.env.VK_ACCESS_TOKEN;
    const peerId = process.env.VK_PEER_ID;
    if (!token || !peerId) {
        return false;
    }

    const body = new URLSearchParams({
        access_token: token,
        v: '5.199',
        peer_id: peerId,
        message: text.slice(0, 4096),
        random_id: String(Math.floor(Math.random() * 2 ** 31)),
    });

    try {
        const res = await fetch(`${VK_API}/messages.send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        const data = (await res.json()) as { response?: number; error?: { error_msg: string; error_code: number } };
        if (data.error) {
            console.error('VK API error:', data.error.error_code, data.error.error_msg);
            return false;
        }
        return true;
    } catch (error) {
        console.error('VK send failed:', error);
        return false;
    }
}

export function isVkConfigured(): boolean {
    return Boolean(process.env.VK_ACCESS_TOKEN && process.env.VK_PEER_ID);
}
