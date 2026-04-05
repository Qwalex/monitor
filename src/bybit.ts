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
    equity: string;
}

export interface WalletBalance {
    accountType: string;
    totalEquity: string;
    coin: Balance[];
}

function safeBybitErrorSummary(error: unknown): string {
    const e = error as {
        code?: number;
        message?: string;
        retCode?: number;
        retMsg?: string;
        response?: { data?: { retCode?: number; retMsg?: string } };
    };
    const code = e.code ?? e.retCode ?? e.response?.data?.retCode;
    const msg = e.message ?? e.retMsg ?? e.response?.data?.retMsg ?? String(error);
    return `code=${code ?? 'n/a'} message=${msg}`;
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
        console.error(
            `Error fetching balance for account ${account.name}: ${safeBybitErrorSummary(error)}`
        );
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