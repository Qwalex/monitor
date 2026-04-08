import TelegramBot from 'node-telegram-bot-api';
import { getDatabase, saveDatabase } from '../database.js';
import { getAccountBalance, coinRowsFromWallet } from '../bybit.js';
import { htmlToPlain, trySendVkPlain, isVkConfigured } from './vk.js';

let bot: TelegramBot | null = null;
let authorizedChatId: string | null = null;

function mainKeyboardOpts(): {
    reply_markup: { keyboard: { text: string }[][]; resize_keyboard: boolean };
} {
    return {
        reply_markup: {
            keyboard: [[{ text: '💰 Баланс' }]],
            resize_keyboard: true,
        },
    };
}

export function initTelegramBot(): void {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!token) {
        console.log('Telegram bot token not configured');
        return;
    }
    
    authorizedChatId = process.env.TELEGRAM_CHAT_ID || null;
    
    try {
        bot = new TelegramBot(token, { polling: true });
        console.log('Telegram bot initialized');
        
        setupCommands();
    } catch (error) {
        console.error('Error initializing Telegram bot:', error);
    }
}

function setupCommands(): void {
    if (!bot) return;
    
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы. Добавьте этот chat ID в конфигурацию.');
        }
        
        const helpText = `
🤖 <b>Monitor</b>

Команды:
/accounts - Список аккаунтов и балансы
/balance - Текущие балансы
/addaccount - Добавить аккаунт
/deleteaccount - Удалить аккаунт
/history - История за 24ч
/sync - Синхронизировать балансы
        `;
        
        bot?.sendMessage(chatId, helpText, { parse_mode: 'HTML', ...mainKeyboardOpts() });
    });

    bot.on('message', async (msg) => {
        if (!bot || !msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        if (!isAuthorized(chatId.toString())) return;

        if (msg.text.trim() === '💰 Баланс') {
            const balancesText = await getBalancesMessage();
            bot.sendMessage(chatId, balancesText, { parse_mode: 'HTML', ...mainKeyboardOpts() });
        }
    });
    
    bot.onText(/\/accounts/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        const accountsText = await getAccountsMessage();
        bot?.sendMessage(chatId, accountsText, { parse_mode: 'HTML', ...mainKeyboardOpts() });
    });
    
    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        const balancesText = await getBalancesMessage();
        bot?.sendMessage(chatId, balancesText, { parse_mode: 'HTML', ...mainKeyboardOpts() });
    });
    
    bot.onText(/\/history/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        const historyText = await getHistoryMessage();
        bot?.sendMessage(chatId, historyText, { parse_mode: 'HTML', ...mainKeyboardOpts() });
    });
    
    bot.onText(/\/sync/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        bot?.sendMessage(chatId, '🔄 Синхронизация балансов...', mainKeyboardOpts());
        
        await syncAllBalances();
        
        const balancesText = await getBalancesMessage();
        bot?.sendMessage(chatId, balancesText, { parse_mode: 'HTML', ...mainKeyboardOpts() });
    });
    
    bot.onText(/\/addaccount/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        bot?.sendMessage(chatId, 
            'Для добавления аккаунта используйте веб-интерфейс: https://dev.qwalex.ru/monitor',
            { parse_mode: 'HTML' }
        );
    });
    
    bot.onText(/\/deleteaccount/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        bot?.sendMessage(chatId, 
            'Для удаления аккаунта используйте веб-интерфейс: https://dev.qwalex.ru/monitor',
            { parse_mode: 'HTML' }
        );
    });
}

function isAuthorized(chatId: string): boolean {
    if (!authorizedChatId) return true;
    return chatId === authorizedChatId;
}

/** Telegram first; on failure or if Telegram is not configured, VK (if configured). */
async function sendHtmlWithFallback(html: string): Promise<void> {
    if (bot && authorizedChatId) {
        try {
            await bot.sendMessage(authorizedChatId, html, { parse_mode: 'HTML' });
            return;
        } catch (error) {
            console.error('Telegram send failed, trying VK fallback:', error);
        }
    } else if (process.env.TELEGRAM_BOT_TOKEN && (!bot || !authorizedChatId)) {
        console.warn('Telegram bot misconfigured or unavailable (no chat id or bot init failed); trying VK if configured');
    }

    const plain = htmlToPlain(html);
    if (await trySendVkPlain(plain)) {
        return;
    }

    if (!isVkConfigured()) {
        console.warn('No messenger delivered message (Telegram unavailable and VK not configured)');
    }
}

async function getAccountsMessage(): Promise<string> {
    const db = getDatabase();
    const result = db.exec('SELECT id, name, account_type FROM accounts WHERE is_active = 1');
    
    if (result.length === 0 || result[0].values.length === 0) {
        return 'Нет добавленных аккаунтов.';
    }
    
    let text = '<b>📋 Ваши аккаунты:</b>\n\n';
    
    for (const row of result[0].values) {
        const id = row[0] as number;
        const name = row[1] as string;
        const accountType = row[2] as string;
        
        text += `• ${name} (${accountType})\n`;
    }
    
    return text;
}

export async function getBalancesMessage(): Promise<string> {
    const db = getDatabase();
    const result = db.exec('SELECT id, name, api_key, api_secret, account_type FROM accounts WHERE is_active = 1');
    
    if (result.length === 0 || result[0].values.length === 0) {
        return 'Нет добавленных аккаунтов.';
    }
    
    let text = '<b>💰 Балансы:</b>\n\n';
    let hasBalances = false;
    
    for (const row of result[0].values) {
        const account = {
            id: row[0] as number,
            name: row[1] as string,
            apiKey: row[2] as string,
            apiSecret: row[3] as string,
            accountType: row[4] as string,
        };
        
        const walletBalance = await getAccountBalance(account);

        if (walletBalance) {
            const rows = coinRowsFromWallet(walletBalance);
            if (rows.length > 0) {
                hasBalances = true;
                text += `<b>${account.name}</b>\n`;
                for (const r of rows) {
                    const amt = r.balance >= 1 ? r.balance.toFixed(4) : r.balance.toFixed(8).replace(/\.?0+$/, '');
                    text += `  ${r.coin}: ${amt}\n`;
                }
                text += '\n';
            }
        }
    }
    
    if (!hasBalances) {
        text += 'Нет балансов для отображения.';
    }
    
    return text;
}

async function getHistoryMessage(): Promise<string> {
    const db = getDatabase();
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const result = db.exec(`
        SELECT
            a.name,
            bh.coin,
            bh.balance,
            bh.recorded_at
        FROM balance_history bh
        JOIN accounts a ON bh.account_id = a.id
        WHERE bh.recorded_at >= ?
          AND bh.coin != 'PORTFOLIO_USD'
        ORDER BY a.name, bh.recorded_at DESC
    `, [fromDate]);

    if (result.length === 0 || result[0].values.length === 0) {
        return 'Нет данных за последние 24 часа.';
    }

    // Group by account
    const grouped: Record<string, { coin: string, balance: number, recorded_at: string }[]> = {};

    for (const row of result[0].values) {
        const name = row[0] as string;
        const coin = row[1] as string;
        const balance = row[2] as number;
        const recorded_at = row[3] as string;

        if (!grouped[name]) {
            grouped[name] = [];
        }
        // Limit to 10 records per account
        if (grouped[name].length < 10) {
            grouped[name].push({ coin, balance, recorded_at });
        }
    }

    let text = '<b>📊 История за 24ч:</b>\n\n';

    for (const [accountName, items] of Object.entries(grouped)) {
        text += `<b>${accountName}</b>\n`;
        for (const item of items) {
            const recorded = new Date(item.recorded_at);
            const time = recorded.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const date = recorded.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
            text += `  ${date} ${time} - ${item.coin} ${item.balance.toFixed(4)}\n`;
        }
        text += '\n';
    }

    return text;
}

async function syncAllBalances(): Promise<void> {
    const db = getDatabase();
    const result = db.exec('SELECT id, name, api_key, api_secret, account_type FROM accounts WHERE is_active = 1');
    
    if (result.length === 0 || result[0].values.length === 0) {
        return;
    }
    
    const now = new Date().toISOString();
    
    for (const row of result[0].values) {
        const account = {
            id: row[0] as number,
            name: row[1] as string,
            apiKey: row[2] as string,
            apiSecret: row[3] as string,
            accountType: row[4] as string,
        };
        
        const walletBalance = await getAccountBalance(account);

        if (walletBalance) {
            const rows = coinRowsFromWallet(walletBalance);
            const te = parseFloat(String(walletBalance.totalEquity ?? '0'));
            if (Number.isFinite(te) && te > 0) {
                db.run(
                    'INSERT INTO balance_history (account_id, coin, balance, recorded_at) VALUES (?, ?, ?, ?)',
                    [account.id, 'PORTFOLIO_USD', te, now]
                );
            }
            for (const r of rows) {
                if (r.balance > 0) {
                    db.run(
                        'INSERT INTO balance_history (account_id, coin, balance, recorded_at) VALUES (?, ?, ?, ?)',
                        [account.id, r.coin, r.balance, now]
                    );
                }
            }
        }
    }
    
    saveDatabase();
}

export async function sendBalanceReport(): Promise<void> {
    const balancesText = await getBalancesMessage();
    await sendHtmlWithFallback(balancesText);
}

export function setWebhook(app: any, basePath = ''): void {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) return;

    const prefix = (basePath || '').replace(/\/$/, '');
    const webhookPath = prefix ? `${prefix}/api/telegram/webhook` : '/api/telegram/webhook';

    app.post(webhookPath, async (req: any, res: any) => {
        if (!bot) {
            return res.status(500).json({ error: 'Bot not initialized' });
        }

        try {
            await bot.processUpdate(req.body);
            res.json({ ok: true });
        } catch (error) {
            console.error('Error processing webhook update:', error);
            res.status(500).json({ error: 'Failed to process update' });
        }
    });
}

export function sendServiceDownAlert(service: any): void {
    const message = `🔴 <b>Сервис недоступен!</b>

Название: ${service.name}
URL: ${service.url}
Время: ${new Date().toLocaleString('ru-RU')}`;

    void sendHtmlWithFallback(message);
}

export function sendServiceUpAlert(service: any, downtimeSeconds?: number): void {
    const downtimeStr = downtimeSeconds
        ? downtimeSeconds >= 3600
            ? `${Math.floor(downtimeSeconds / 3600)}ч ${Math.floor((downtimeSeconds % 3600) / 60)}м`
            : downtimeSeconds >= 60
                ? `${Math.floor(downtimeSeconds / 60)}м ${downtimeSeconds % 60}с`
                : `${downtimeSeconds}с`
        : 'неизвестно';

    const message = `🟢 <b>Сервис снова доступен!</b>

Название: ${service.name}
URL: ${service.url}
Был недоступен: ${downtimeStr}
Время: ${new Date().toLocaleString('ru-RU')}`;

    void sendHtmlWithFallback(message);
}