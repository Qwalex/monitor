import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase } from '../database.js';
import { validateApiKey } from '../bybit.js';

const router = Router();

interface Account {
    id: number;
    name: string;
    api_key: string;
    api_secret: string;
    account_type: string;
    created_at: string;
    is_active: number;
}

router.get('/', (_req: Request, res: Response) => {
    try {
        const db = getDatabase();
        const result = db.exec(`
            SELECT id, name, api_key, api_secret, account_type, created_at, is_active 
            FROM accounts 
            WHERE is_active = 1
        `);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.json([]);
        }
        
        const accounts: Account[] = result[0].values.map((row: any[]) => ({
            id: row[0],
            name: row[1],
            api_key: row[2],
            api_secret: row[3],
            account_type: row[4],
            created_at: row[5],
            is_active: row[6],
        }));
        
        res.json(accounts);
    } catch (error) {
        console.error('Error fetching accounts:', error);
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
});

router.post('/', async (req: Request, res: Response) => {
    try {
        const { name, api_key, api_secret, account_type = 'UNIFIED' } = req.body;
        
        if (!name || !api_key || !api_secret) {
            return res.status(400).json({ error: 'Missing required fields: name, api_key, api_secret' });
        }
        
        const isValid = await validateApiKey(api_key, api_secret, account_type);
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid API key or secret' });
        }
        
        const db = getDatabase();
        db.run(
            'INSERT INTO accounts (name, api_key, api_secret, account_type) VALUES (?, ?, ?, ?)',
            [name, api_key, api_secret, account_type]
        );
        
        saveDatabase();
        
        const result = db.exec('SELECT last_insert_rowid()');
        const id = result[0].values[0][0];
        
        res.status(201).json({ id, name, api_key, api_secret, account_type });
    } catch (error) {
        console.error('Error creating account:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

router.put('/:id', async (req: Request, res: Response) => {
    try {
        const accountId = parseInt(req.params.id as string, 10);
        if (Number.isNaN(accountId)) {
            return res.status(400).json({ error: 'Invalid account id' });
        }

        const { name, api_key, api_secret, account_type = 'UNIFIED' } = req.body;

        if (!name || !api_key || !api_secret) {
            return res.status(400).json({ error: 'Missing required fields: name, api_key, api_secret' });
        }

        const isValid = await validateApiKey(api_key, api_secret, account_type);
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid API key or secret' });
        }

        const db = getDatabase();
        const exists = db.exec('SELECT id FROM accounts WHERE id = ? AND is_active = 1', [accountId]);
        if (!exists.length || !exists[0].values.length) {
            return res.status(404).json({ error: 'Account not found' });
        }

        db.run(
            'UPDATE accounts SET name = ?, api_key = ?, api_secret = ?, account_type = ? WHERE id = ?',
            [name, api_key, api_secret, account_type, accountId]
        );
        saveDatabase();

        res.json({ id: accountId, name, api_key, api_secret, account_type });
    } catch (error) {
        console.error('Error updating account:', error);
        res.status(500).json({ error: 'Failed to update account' });
    }
});

router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        
        db.run('UPDATE accounts SET is_active = 0 WHERE id = ?', [id]);
        saveDatabase();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

router.post('/validate', async (req: Request, res: Response) => {
    try {
        const { api_key, api_secret, account_type = 'UNIFIED' } = req.body;
        
        if (!api_key || !api_secret) {
            return res.status(400).json({ error: 'Missing api_key or api_secret' });
        }
        
        const isValid = await validateApiKey(api_key, api_secret, account_type);
        res.json({ valid: isValid });
    } catch (error) {
        console.error('Error validating API key:', error);
        res.status(500).json({ error: 'Failed to validate API key' });
    }
});

export default router;