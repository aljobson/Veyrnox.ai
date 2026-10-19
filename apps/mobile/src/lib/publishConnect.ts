import { ApiError, type ApiClient } from './api';
import { createPkce, type Pkce } from './auth/pkce';

// Connect a social account from the phone (ADR-0140), over the server's mobile return target (ADR-0136). The flow:
// make a PKCE pair, ask the server for the provider's authorize link (sending client "mobile" so the provider
// redirects to our own https bridge), open it in an in-app authentication session that watches for the app's fixed
// return address, read the code and state, then finish with the verifier. The verifier never leaves the phone until the
// last call and is never part of any URL. The returned state must equal the one in the authorize link, and the link
// itself must be https (plain http only for localhost, and only in a development build).

export const RETURN_URL = 'ai.veyrnox.app://social/callback';

export interface ConnectNetwork {
    readonly key: 'youtube' | 'linkedin' | 'twitter' | 'tiktok';
    readonly label: string;
}
// The networks released on the Worker today (PUBLISH_RELEASED_NETWORKS); the server still refuses any that are not.
export const CONNECT_NETWORKS: readonly ConnectNetwork[] = [
    { key: 'youtube', label: 'YouTube' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'twitter', label: 'X (Twitter)' },
    { key: 'tiktok', label: 'TikTok' },
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function allowedAuthorizeUrl(value: unknown, dev: boolean): string | null {
    if (typeof value !== 'string' || !value) return null;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol === 'https:') return value;
    if (dev && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return value;
    return null;
}

const SAFE_ERRORS = new Set(['access_denied']);
const CODE_MAX = 2048;

export type Returned = { kind: 'code'; code: string; state: string } | { kind: 'error'; error: string } | { kind: 'invalid' };

function query(url: string): URLSearchParams | null {
    const i = url.indexOf('?');
    return i < 0 ? null : new URLSearchParams(url.slice(i + 1));
}

// What the bridge handed back. A different network or state, or any other address, is not ours.
export function parseReturn(url: string, network: string, authorizeUrl: string): Returned {
    if (typeof url !== 'string' || !url.startsWith(`${RETURN_URL}?`)) return { kind: 'invalid' };
    const q = query(url);
    if (!q || q.get('network') !== network) return { kind: 'invalid' };
    const error = q.get('error');
    if (error) return { kind: 'error', error: SAFE_ERRORS.has(error) ? error : 'invalid_request' };
    const code = q.get('code');
    const state = q.get('state');
    const expected = query(authorizeUrl)?.get('state');
    if (!code || code.length > CODE_MAX || !/^[\x20-\x7e]+$/.test(code) || !state || !expected || state !== expected) return { kind: 'invalid' };
    return { kind: 'code', code, state };
}

export interface ConnectedAccount {
    readonly id: string;
    readonly network: string;
    readonly displayName: string;
}

export type ConnectOutcome =
    | { kind: 'connected'; account: ConnectedAccount }
    | { kind: 'cancelled' }
    | { kind: 'error'; key: string };

export type AuthSession = (url: string, returnUrl: string) => Promise<{ type: string; url?: string }>;

export interface ConnectDeps {
    readonly open: AuthSession;
    readonly pkce?: () => Promise<Pkce>;
    readonly dev?: boolean;
}

const path = (network: string, step: 'connect' | 'callback') => `/api/v1/social/accounts/${encodeURIComponent(network)}/${step}`;
const post = <T>(api: ApiClient, p: string, body: Record<string, unknown>) =>
    api.request<T>(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function runConnect(api: ApiClient, network: string, deps: ConnectDeps): Promise<ConnectOutcome> {
    const pkce = await (deps.pkce ?? createPkce)();
    let authorizeUrl: string | null;
    try {
        const res = await post<{ authorizeUrl?: unknown }>(api, path(network, 'connect'), { codeChallenge: pkce.challenge, client: 'mobile' });
        authorizeUrl = allowedAuthorizeUrl(res?.authorizeUrl, deps.dev === true);
    } catch (err) {
        return { kind: 'error', key: connectErrorKey(err) };
    }
    if (!authorizeUrl) return { kind: 'error', key: 'connect.err.link' };

    let session: { type: string; url?: string };
    try {
        session = await deps.open(authorizeUrl, RETURN_URL);
    } catch {
        return { kind: 'error', key: 'common.error' };
    }
    if (session.type !== 'success' || !session.url) return { kind: 'cancelled' };

    const returned = parseReturn(session.url, network, authorizeUrl);
    if (returned.kind === 'invalid') return { kind: 'error', key: 'connect.err.return' };
    if (returned.kind === 'error') return returned.error === 'access_denied' ? { kind: 'cancelled' } : { kind: 'error', key: 'connect.err.provider' };

    try {
        const res = await post<{ ok?: unknown; account?: Record<string, unknown> }>(api, path(network, 'callback'), {
            code: returned.code,
            state: returned.state,
            codeVerifier: pkce.verifier,
            client: 'mobile',
        });
        const a = res?.account;
        const id = a && typeof a.id === 'string' ? a.id : null;
        if (res?.ok !== true || !id) return { kind: 'error', key: 'common.error' };
        return {
            kind: 'connected',
            account: { id, network: typeof a?.network === 'string' ? a.network : network, displayName: typeof a?.display_name === 'string' ? a.display_name : '' },
        };
    } catch (err) {
        return { kind: 'error', key: connectErrorKey(err) };
    }
}

// Catalog keys for what the person should know. Two typed refusals carry their word in `code`, not `error`.
export function connectErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'connect.err.network';
    if (err.status === 429) return 'connect.err.rate';
    const word = typeof err.body.code === 'string' ? err.body.code : err.code;
    if (word === 'ACCOUNT_LIMIT') return 'connect.err.limit';
    if (word === 'NO_YOUTUBE_CHANNEL') return 'connect.err.noChannel';
    if (word === 'network_unavailable') return 'connect.err.unavailable';
    if (word === 'invalid_state') return 'connect.err.state';
    if (word === 'connect_failed') return 'connect.err.failed';
    if (err.status === 503) return 'connect.err.later';
    return 'common.error';
}
