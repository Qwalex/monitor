import TelegramBot from 'node-telegram-bot-api';
import { getDatabase, saveDatabase } from '../database.js';
import { getAccountBalance, validateApiKey } from '../bybit.js';

let bot: TelegramBot | null = null;
let authorizedChatId: string | null = null;

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
🤖 <b>Bybit Balance Monitor</b>

Команды:
/accounts - Список аккаунтов и балансы
/balance - Текущие балансы
/addaccount - Добавить аккаунт
/deleteaccount - Удалить аккаунт
/history - История за 24ч
/sync - Синхронизировать балансы
        `;
        
        bot?.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
    });
    
    bot.onText(/\/accounts/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        const accountsText = await getAccountsMessage();
        bot?.sendMessage(chatId, accountsText, { parse_mode: 'HTML' });
    });
    
    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        const balancesText = await getBalancesMessage();
        bot?.sendMessage(chatId, balancesText, { parse_mode: 'HTML' });
    });
    
    bot.onText(/\/history/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        const historyText = await getHistoryMessage();
        bot?.sendMessage(chatId, historyText, { parse_mode: 'HTML' });
    });
    
    bot.onText(/\/sync/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAuthorized(chatId.toString())) {
            return bot?.sendMessage(chatId, 'Вы не авторизованы.');
        }
        
        bot?.sendMessage(chatId, '🔄 Синхронизация балансов...');
        
        await syncAllBalances();
        
        const balancesText = await getBalancesMessage();
        bot?.sendMessage(chatId, balancesText, { parse_mode: 'HTML' });
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

async function getBalancesMessage(): Promise<string> {
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
        
        if (walletBalance && walletBalance.coin) {
            const balances = walletBalance.coin.filter(c => parseFloat(c.walletBalance || '0') > 0);
            
            if (balances.length > 0) {
                hasBalances = true;
                text += `<b>${account.name}</b>\n`;
                
                for (const coin of balances) {
                    const balance = parseFloat(coin.walletBalance || '0');
                    text += `  ${coin.coin}: ${balance.toFixed(4)}\n`;
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
        ORDER BY bh.recorded_at DESC
        LIMIT 20
    `, [fromDate]);
    
    if (result.length === 0 || result[0].values.length === 0) {
        return 'Нет данных за последние 24 часа.';
    }
    
    let text = '<b>📊 История за 24ч:</b>\n\n';
    
    for (const row of result[0].values) {
        const name = row[0] as string;
        const coin = row[1] as string;
        const balance = row[2] as number;
        const recorded = new Date(row[3] as string);
        
        const time = recorded.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const date = recorded.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
        
        text += `${date} ${time} | ${name}: ${coin} ${balance.toFixed(4)}\n`;
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
        
        if (walletBalance && walletBalance.coin) {
            for (const coin of walletBalance.coin) {
                const balance = parseFloat(coin.walletBalance || '0');
                if (balance > 0) {
                    db.run(
                        'INSERT INTO balance_history (account_id, coin, balance, recorded_at) VALUES (?, ?, ?, ?)',
                        [account.id, coin.coin, balance, now]
                    );
                }
            }
        }
    }
    
    saveDatabase();
}

export async function sendBalanceReport(): Promise<void> {
    if (!bot || !authorizedChatId) return;
    
    const balancesText = await getBalancesMessage();
    
    try {
        await bot.sendMessage(authorizedChatId, balancesText, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error sending balance report:', error);
    }
}

export function setWebhook(app: any): void {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) return;

    app.post('/api/telegram/webhook', async (req: any, res: any) => {
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
    if (!bot || !authorizedChatId) return;

    const message = `🔴 <b>Сервис недоступен!</b>

Название: ${service.name}
URL: ${service.url}
Время: ${new Date().toLocaleString('ru-RU')}`;

    try {
        bot.sendMessage(authorizedChatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error sending service down alert:', error);
    }
}

export function sendServiceUpAlert(service: any, downtimeSeconds?: number): void {
    if (!bot || !authorizedChatId) return;

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

    try {
        bot.sendMessage(authorizedChatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error sending service up alert:', error);
    }
}