import { Router, Request, Response } from 'express';
import { accountsCollection, nextId } from '../database.js';
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

router.get('/', async (_req: Request, res: Response) => {
    try {
        const docs = await accountsCollection()
            .find({ is_active: 1 })
            .project({
                _id: 1,
                name: 1,
                api_key: 1,
                api_secret: 1,
                account_type: 1,
                created_at: 1,
                is_active: 1,
            })
            .toArray();

        const accounts: Account[] = docs.map((d) => ({
            id: d._id,
            name: d.name,
            api_key: d.api_key,
            api_secret: d.api_secret,
            account_type: d.account_type,
            created_at: d.created_at,
            is_active: d.is_active,
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

        const id = await nextId('accounts');
        const created_at = new Date().toISOString();
        await accountsCollection().insertOne({
            _id: id,
            name,
            api_key,
            api_secret,
            account_type,
            created_at,
            is_active: 1,
        });

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

        const exist = await accountsCollection().findOne({ _id: accountId, is_active: 1 });
        if (!exist) {
            return res.status(404).json({ error: 'Account not found' });
        }

        await accountsCollection().updateOne(
            { _id: accountId },
            { $set: { name, api_key, api_secret, account_type } }
        );

        res.json({ id: accountId, name, api_key, api_secret, account_type });
    } catch (error) {
        console.error('Error updating account:', error);
        res.status(500).json({ error: 'Failed to update account' });
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid account id' });
        }

        await accountsCollection().updateOne({ _id: id }, { $set: { is_active: 0 } });

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
