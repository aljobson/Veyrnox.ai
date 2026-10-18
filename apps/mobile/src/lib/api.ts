import { config } from './config';

export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown> = {}) {
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
    // Used for streamed responses; React Native's own fetch cannot stream a body.
    readonly streamFetch?: typeof fetch;
    // Runs before a call leaves the phone; throws to stop it (the AI-sharing consent, ADR-0128).
    readonly beforeSend?: (path: string, method: string) => Promise<void>;
}

export interface Balance {
    readonly balance: number;
    readonly free_credits: number;
    readonly free_expires_at: string | null;
}

export interface ApiClient {
    request<T>(path: string, init?: RequestInit): Promise<T>;
    // Authenticated request whose response body the caller reads (server-sent events).
    stream(path: string, init?: RequestInit): Promise<Response>;
    getBalance(): Promise<Balance>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
    async function send(path: string, init: RequestInit, token: string, doFetch: typeof fetch): Promise<Response> {
        try {
            return await doFetch(`${options.baseUrl}${path}`, {
                ...init,
                headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
            });
        } catch {
            throw new ApiError(0, 'network');
        }
    }

    // Sends with the current token; after a 401 refreshes once and retries.
    async function authed(path: string, init: RequestInit, doFetch: typeof fetch): Promise<Response> {
        const token = await options.getAccessToken();
        if (!token) {
            options.onSessionLost();
            throw new ApiError(401, 'not_authenticated');
        }
        let res = await send(path, init, token, doFetch);
        if (res.status === 401) {
            const retryToken = await options.getAccessToken(true);
            if (retryToken && retryToken !== token) res = await send(path, init, retryToken, doFetch);
            if (res.status === 401) {
                options.onSessionLost();
                throw new ApiError(401, 'not_authenticated');
            }
        }
        return res;
    }

    async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
        await options.beforeSend?.(path, init.method ?? 'GET');
        const res = await authed(path, init, fetch);
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown', body);
        return body as T;
    }

    async function stream(path: string, init: RequestInit = {}): Promise<Response> {
        await options.beforeSend?.(path, init.method ?? 'GET');
        return authed(path, init, options.streamFetch ?? fetch);
    }

    return {
        request,
        stream,
        getBalance: () => request<Balance>('/api/v1/balance'),
    };
}

export const API_BASE = config.apiBase;
