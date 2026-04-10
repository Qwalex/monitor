import './load-env.js';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import cors from 'cors';

import { initDatabase, closeDatabase } from './database.js';
import accountsRouter from './routes/accounts.js';
import balancesRouter from './routes/balances.js';
import historyRouter from './routes/history.js';
import servicesRouter from './routes/services.js';
import settingsRouter from './routes/settings.js';
import { initTelegramBot, setWebhook, sendServiceDownAlert, sendServiceUpAlert } from './bot/telegram.js';
import { logVkStartupSummary } from './bot/vk.js';
import { startVkLongPoll } from './bot/vk-incoming.js';
import { startScheduler } from './scheduler.js';
import { startServiceMonitoring, stopAllServiceMonitoring } from './services.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
/** Without this, `app.get("/monitor")` also matches `/monitor/` and runs redirect before the index handler — infinite redirect behind nginx. */
app.set('strict routing', true);

/** Public URL prefix (no trailing slash), e.g. "" or "/monitor". Must match reverse proxy path. */
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

const UI_DIR = path.join(__dirname, '../src/ui');
const INDEX_HTML_PATH = path.join(UI_DIR, 'index.html');

let indexHtmlTemplate: string | null = null;

function getIndexHtml(): string {
    if (indexHtmlTemplate === null) {
        indexHtmlTemplate = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    }
    return indexHtmlTemplate.replace(/__BASE_PATH__/g, BASE_PATH);
}

function sendIndexHtml(res: express.Response): void {
    res.type('html').send(getIndexHtml());
}

const API_ROOT = BASE_PATH ? `${BASE_PATH}/api` : '/api';

app.use(cors());

// Request logging middleware
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use(express.json());

if (BASE_PATH) {
    app.get(BASE_PATH, (_req, res) => res.redirect(302, `${BASE_PATH}/`));
    app.get(`${BASE_PATH}/`, (_req, res) => sendIndexHtml(res));
    app.get(`${BASE_PATH}/index.html`, (_req, res) => sendIndexHtml(res));
} else {
    app.get('/', (_req, res) => sendIndexHtml(res));
    app.get('/index.html', (_req, res) => sendIndexHtml(res));
}

app.use(BASE_PATH || '/', express.static(UI_DIR, { index: false }));

app.use(`${API_ROOT}/accounts`, accountsRouter);
app.use(`${API_ROOT}/balances`, balancesRouter);
app.use(`${API_ROOT}/history`, historyRouter);
app.use(`${API_ROOT}/services`, servicesRouter);
app.use(`${API_ROOT}/settings`, settingsRouter);

setWebhook(app, BASE_PATH);

app.get(`${API_ROOT}/health`, (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware (4 args required for error handler)
app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[ERROR]', err);
});

async function main() {
    try {
        console.log('Initializing database...');
        await initDatabase();
        console.log('Database initialized');

        console.log('Initializing Telegram bot...');
        initTelegramBot();
        logVkStartupSummary();
        startVkLongPoll();

        console.log('Starting scheduler...');
        startScheduler();

        console.log('Starting service monitoring...');
        await startServiceMonitoring((service, isUp, downtime) => {
            if (isUp) {
                sendServiceUpAlert(service, downtime);
            } else {
                sendServiceDownAlert(service);
            }
        });

        app.listen(PORT, '0.0.0.0', () => {
            const ui = BASE_PATH ? `${BASE_PATH}/` : '/';
            console.log(`\n🚀 Server running at http://localhost:${PORT}${ui}\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

async function shutdown(): Promise<void> {
    stopAllServiceMonitoring();
    await closeDatabase();
    process.exit(0);
}

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    void shutdown();
});

process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    void shutdown();
});

main();