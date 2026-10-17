import { config } from './config';

export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string) {
        super(`api_${code}`);
        this.name = 'ApiError';
    }
}

export interface ApiClientOptions {
    readonly baseUrl: string;
    // Returns a valid access token, refreshing first when it is about to expire
    // or when forceRefresh is set (after a 401).
    readonly getAccessToken: (forceRefresh?: boolean) => Promise<string | null>;
    // Called on a 401 after one forced refresh failed to help.
    readonly onSessionLost: () => void;
}

export interface Balance {
    readonly balance: number;
    readonly free_credits: number;
    readonly free_expires_at: string | null;
}

export interface ApiClient {
    request<T>(path: string, init?: RequestInit): Promise<T>;
    getBalance(): Promise<Balance>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
    async function send(path: string, init: RequestInit, token: string): Promise<Response> {
        try {
            return await fetch(`${options.baseUrl}${path}`, {
                ...init,
                headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
            });
        } catch {
            throw new ApiError(0, 'network');
        }
    }

    async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
        const token = await options.getAccessToken();
        if (!token) {
            options.onSessionLost();
            throw new ApiError(401, 'not_authenticated');
        }
        let res = await send(path, init, token);
        if (res.status === 401) {
            const retryToken = await options.getAccessToken(true);
            if (retryToken && retryToken !== token) res = await send(path, init, retryToken);
            if (res.status === 401) {
                options.onSessionLost();
                throw new ApiError(401, 'not_authenticated');
            }
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown');
        return body as T;
    }

    return {
        request,
        getBalance: () => request<Balance>('/api/v1/balance'),
    };
}

export const API_BASE = config.apiBase;
