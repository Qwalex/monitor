import { RestClientV5 } from 'bybit-api';

export interface BybitAccount {
    id: number;
    name: string;
    apiKey: string;
    apiSecret: string;
    accountType: string;
}

export interface Balance {
    coin: string;
    walletBalance: string;
}

export interface WalletBalance {
    accountType: string;
    coin: Balance[];
}

export async function getAccountBalance(account: BybitAccount): Promise<WalletBalance | null> {
    try {
        const client = new RestClientV5({
            key: account.apiKey,
            secret: account.apiSecret,
        });

        const response = await client.getWalletBalance({
            accountType: account.accountType as 'UNIFIED' | 'CONTRACT' | 'SPOT',
        });

        if (response.retCode === 0 && response.result.list && response.result.list.length > 0) {
            return response.result.list[0] as WalletBalance;
        }

        return null;
    } catch (error) {
        console.error(`Error fetching balance for account ${account.name}:`, error);
        return null;
    }
}

export async function validateApiKey(apiKey: string, apiSecret: string, accountType: string = 'UNIFIED'): Promise<boolean> {
    try {
        const client = new RestClientV5({
            key: apiKey,
            secret: apiSecret,
        });

        const response = await client.getWalletBalance({
            accountType: accountType as 'UNIFIED' | 'CONTRACT' | 'SPOT',
        });

        return response.retCode === 0;
    } catch {
        return false;
    }
}