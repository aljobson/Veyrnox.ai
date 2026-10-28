import { tokenUser, isAccountChanged } from './auth/tokenUser';
import { fetchWithTimeout, RequestTimeout } from './fetchWithTimeout';
export { REQUEST_TIMEOUT_MS } from './fetchWithTimeout';
import { markOffline, markOnline } from './networkState';
import { config } from './config';
import { isBalance, isRecord } from './responseShapes';

export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown> = {}) {
        super(`api_${code}`);
        this.name = 'ApiError';
    }

    // ADR-0160: the server's one answer for "the database is not answering". Retryable; never a reason to sign out.
    get isServiceUnavailable(): boolean {
        return this.status === 503 && this.code === 'service_unavailable';
    }

    // Seconds the server asked us to wait (Retry-After), when it said.
    get retryAfterSeconds(): number | undefined {
        const value = this.body.retryAfterSeconds;
        return typeof value === 'number' && value > 0 ? value : undefined;
    }
}

export const isServiceUnavailable = (err: unknown): boolean => err instanceof ApiError && err.isServiceUnavailable;

export interface ClientTask {
    readonly gen: number;
    readonly user: string | null;
    current(): boolean;
}

export interface CallOptions { readonly owner?: string; readonly task?: ClientTask }

export interface ApiClientOptions {
    readonly beginSessionTask?: () => ClientTask;
    readonly baseUrl: string;
    // Returns a valid access token, refreshing first when it is about to expire
    // or when forceRefresh is set (after a 401).
    readonly getAccessToken: (forceRefresh?: boolean, expected?: number) => Promise<string | null>;
    // Called on a 401 after one forced refresh failed to help.
    readonly onSessionLost: (generation?: number) => void;
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
    request<T>(path: string, init?: RequestInit, options?: CallOptions): Promise<T>;
    // Authenticated request whose response body the caller reads (server-sent events).
    stream(path: string, init?: RequestInit, options?: CallOptions): Promise<Response>;
    getBalance(): Promise<Balance>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
    async function send(path: string, init: RequestInit, token: string, doFetch: typeof fetch): Promise<Response> {
        try {
            const response = await fetchWithTimeout(doFetch, `${options.baseUrl}${path}`, {
                ...init,
                headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
            });
            markOnline();
            return response;
        } catch (error) {
            if (!(error instanceof RequestTimeout) && init.signal?.aborted) throw error;
            markOffline();
            throw new ApiError(0, 'network', error instanceof RequestTimeout ? { timedOut: true } : {});
        }
    }

    // Sends with the current token; after a 401 refreshes once and retries.
    async function authed(path: string, init: RequestInit, doFetch: typeof fetch, task?: ClientTask, owner?: string): Promise<Response> {
        const check = () => { if (task && !task.current()) throw new ApiError(401, 'account_changed'); };
        const tokenFor = async (force: boolean) => {
            check();
            try {
                return await (task ? options.getAccessToken(force, task.gen) : options.getAccessToken(force));
            } catch (err) {
                if (isAccountChanged(err)) throw new ApiError(401, 'account_changed');
                throw err;
            }
        };
        const lost = () => task ? options.onSessionLost(task.gen) : options.onSessionLost();
        const token = await tokenFor(false);
        check();
        if (!token) {
            lost();
            throw new ApiError(401, 'not_authenticated');
        }
        if ((task?.user != null && tokenUser(token) !== task.user) || (owner !== undefined && tokenUser(token) !== owner)) {
            throw new ApiError(401, 'account_changed');
        }
        const user = task?.user ?? tokenUser(token);
        let res = await send(path, init, token, doFetch);
        if (res.status === 401) {
            check();
            const retryToken = await tokenFor(true);
            check();
            if (task && retryToken && tokenUser(retryToken) !== user) throw new ApiError(401, 'account_changed');
            if (retryToken && retryToken !== token) res = await send(path, init, retryToken, doFetch);
            if (res.status === 401) {
                check();
                lost();
                throw new ApiError(401, 'not_authenticated');
            }
        }
        return res;
    }

    async function request<T>(path: string, init: RequestInit = {}, call: CallOptions = {}): Promise<T> {
        const task = call.task ?? options.beginSessionTask?.();
        await options.beforeSend?.(path, init.method ?? 'GET');
        const res = await authed(path, init, fetch, task, call.owner);
        let body: unknown;
        try { body = await res.json(); }
        catch { if (res.ok) throw new ApiError(res.status, 'bad_response'); }
        if (!res.ok) {
            const errorBody = isRecord(body) ? body : {};
            const wait = Number(res.headers.get('retry-after'));
            throw new ApiError(res.status, typeof errorBody.error === 'string' ? errorBody.error : 'unknown',
                wait > 0 ? { ...errorBody, retryAfterSeconds: wait } : errorBody);
        }
        return body as T;
    }

    async function stream(path: string, init: RequestInit = {}, call: CallOptions = {}): Promise<Response> {
        const task = call.task ?? options.beginSessionTask?.();
        await options.beforeSend?.(path, init.method ?? 'GET');
        return authed(path, init, options.streamFetch ?? fetch, task, call.owner);
    }

    return {
        request,
        stream,
        getBalance: async () => {
            const value = await request<unknown>('/api/v1/balance');
            if (!isBalance(value)) throw new ApiError(200, 'bad_response');
            return value;
        },
    };
}

export const API_BASE = config.apiBase;
