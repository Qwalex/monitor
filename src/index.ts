import * as path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { initDatabase, closeDatabase } from './database.js';
import accountsRouter from './routes/accounts.js';
import balancesRouter from './routes/balances.js';
import historyRouter from './routes/history.js';
import servicesRouter from './routes/services.js';
import { initTelegramBot, setWebhook, sendServiceDownAlert, sendServiceUpAlert } from './bot/telegram.js';
import { startScheduler } from './scheduler.js';
import { startServiceMonitoring, stopAllServiceMonitoring } from './services.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../src/ui')));
app.get(BASE_PATH || '/', (_req, res) => {
    res.sendFile(path.join(__dirname, '../src/ui/index.html'));
});

app.use(`${BASE_PATH}/api/accounts`, accountsRouter);
app.use(`${BASE_PATH}/api/balances`, balancesRouter);
app.use(`${BASE_PATH}/api/history`, historyRouter);
app.use(`${BASE_PATH}/api/services`, servicesRouter);

setWebhook(app);

app.get(`${BASE_PATH}/api/health`, (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function main() {
    try {
        console.log('Initializing database...');
        await initDatabase();
        console.log('Database initialized');

        console.log('Initializing Telegram bot...');
        initTelegramBot();

        console.log('Starting scheduler...');
        startScheduler();

        console.log('Starting service monitoring...');
        startServiceMonitoring((service, isUp, downtime) => {
            if (isUp) {
                sendServiceUpAlert(service, downtime);
            } else {
                sendServiceDownAlert(service);
            }
        });

        app.listen(PORT, () => {
            console.log(`\n🚀 Server running at http://localhost:${PORT}${BASE_PATH}\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopAllServiceMonitoring();
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopAllServiceMonitoring();
    closeDatabase();
    process.exit(0);
});

main();