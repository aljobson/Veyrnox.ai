import { ApiError, type ApiClient } from './api';

// Publish developer tools (the web's /app/publish/developer): customer API keys, webhook endpoints and the request
// log, for the chosen brand (owners and managers only). The server shows a new key or signing secret once, in the
// answer to the create call; this file never stores one, and the screens hold it in memory until the person leaves.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SCOPES = ['accounts:read', 'posts:read', 'posts:write'] as const;
export const EXPIRY_DAYS = [30, 90, 365] as const;
export const EVENTS = ['post.published', 'post.delivered', 'post.failed'] as const;
export const LABEL_MAX = 80;
const QUERY_MAX = 80;

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface ApiKey {
    readonly id: string;
    readonly label: string;
    readonly prefix: string;
    readonly scopes: readonly string[];
    readonly expiresAt: string | null;
    readonly lastUsedAt: string | null;
    readonly revokedAt: string | null;
}

export interface Webhook {
    readonly id: string;
    readonly label: string;
    readonly url: string;
    readonly events: readonly string[];
    readonly active: boolean;
}

export interface Delivery {
    readonly id: string;
    readonly event: string;
    readonly endpoint: string | null;
    readonly outcome: string | null;
    readonly attempts: number | null;
    readonly status: number | null;
    readonly error: string | null;
}

export interface LogEntry {
    readonly id: string;
    readonly method: string;
    readonly route: string;
    readonly status: number | null;
    readonly keyLabel: string | null;
    readonly keyPrefix: string | null;
    readonly errorCode: string | null;
    readonly at: string | null;
}

function each<T>(list: unknown, parse: (r: Record<string, unknown>) => T | null): T[] {
    const out: T[] = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const r = rec(raw);
        const v = r ? parse(r) : null;
        if (v) out.push(v);
    }
    return out;
}

export const parseKeys = (body: unknown): ApiKey[] =>
    each(rec(body)?.keys, (r) => {
        const id = str(r.id);
        if (!id) return null;
        return { id, label: str(r.label) ?? 'Key', prefix: str(r.key_prefix) ?? '', scopes: strs(r.scopes), expiresAt: str(r.expires_at), lastUsedAt: str(r.last_used_at), revokedAt: str(r.revoked_at) };
    });

export function parseWebhooks(body: unknown): { endpoints: Webhook[]; deliveries: Delivery[] } {
    const b = rec(body);
    return {
        endpoints: each(b?.endpoints, (r) => {
            const id = str(r.id);
            return id ? { id, label: str(r.label) ?? 'Webhook', url: str(r.url) ?? '', events: strs(r.events), active: r.active !== false } : null;
        }),
        deliveries: each(b?.deliveries, (r) => {
            const id = str(r.id);
            return id ? { id, event: str(r.event_type) ?? '', endpoint: str(r.endpoint_label), outcome: str(r.outcome), attempts: num(r.attempts), status: num(r.last_status), error: str(r.last_error) } : null;
        }),
    };
}

export const parseLogs = (body: unknown): LogEntry[] =>
    each(rec(body)?.logs, (r) => {
        const id = str(r.id);
        return id ? { id, method: str(r.method) ?? '', route: str(r.route) ?? '', status: num(r.response_status), keyLabel: str(r.api_key_label), keyPrefix: str(r.key_prefix), errorCode: str(r.error_code), at: str(r.requested_at) } : null;
    });

// A key is live until it is revoked or runs out.
export const keyLive = (k: ApiKey, now = Date.now()): boolean => !k.revokedAt && (!k.expiresAt || Date.parse(k.expiresAt) > now);

// The server's own rules for a destination (lib/social/customerWebhook.js): https, no login, port or fragment, a real
// public name (no localhost, .local, .internal, bare numbers or addresses).
export function validWebhookUrl(value: string): boolean {
    if (value.length > 2048) return false;
    let u: URL;
    try {
        u = new URL(value);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    return !(!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes('.'));
}

export type CreateKeyInput = { label: string; scopes: readonly string[]; days: number };
export type CreateWebhookInput = { label: string; url: string; events: readonly string[] };

export function keyProblem(i: CreateKeyInput): 'label' | 'scopes' | 'days' | null {
    const label = i.label.trim();
    if (!label || label.length > LABEL_MAX) return 'label';
    if (i.scopes.length < 1 || new Set(i.scopes).size !== i.scopes.length || i.scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) return 'scopes';
    return (EXPIRY_DAYS as readonly number[]).includes(i.days) ? null : 'days';
}

export function webhookProblem(i: CreateWebhookInput): 'label' | 'url' | 'events' | null {
    const label = i.label.trim();
    if (!label || label.length > LABEL_MAX) return 'label';
    if (!validWebhookUrl(i.url.trim())) return 'url';
    return i.events.length >= 1 && new Set(i.events).size === i.events.length && i.events.every((e) => (EVENTS as readonly string[]).includes(e)) ? null : 'events';
}

const enc = encodeURIComponent;
const json = { 'Content-Type': 'application/json' };
type Api = Pick<ApiClient, 'request'>;

export const fetchKeys = async (api: Api) => parseKeys(await api.request('/api/v1/social/developer/keys'));
export const fetchWebhooks = async (api: Api) => parseWebhooks(await api.request('/api/v1/social/developer/webhooks'));

export interface LogFilters {
    readonly status?: 'success' | 'error' | 'pending';
    readonly route?: '/api/publish/v1/accounts' | '/api/publish/v1/posts';
    readonly q?: string;
}

export async function fetchLogs(api: Api, f: LogFilters = {}): Promise<LogEntry[]> {
    const p = new URLSearchParams();
    if (f.status) p.set('status', f.status);
    if (f.route) p.set('route', f.route);
    const q = (f.q ?? '').trim().slice(0, QUERY_MAX);
    if (q) p.set('q', q);
    p.set('limit', '100');
    return parseLogs(await api.request(`/api/v1/social/developer/logs?${p.toString()}`));
}

// The secret comes back once, here. Callers keep it in memory only and never log it.
export async function createKey(api: Api, i: CreateKeyInput): Promise<{ id: string; secret: string }> {
    if (keyProblem(i)) throw new ApiError(400, 'invalid_body');
    const out = rec(await api.request('/api/v1/social/developer/keys', { method: 'POST', headers: json, body: JSON.stringify({ label: i.label.trim(), scopes: i.scopes, expiresInDays: i.days }) }));
    const secret = str(out?.api_key);
    if (!secret) throw new ApiError(502, 'no_secret');
    return { id: str(out?.key_id) ?? '', secret };
}

export async function createWebhook(api: Api, i: CreateWebhookInput): Promise<{ id: string; secret: string }> {
    if (webhookProblem(i)) throw new ApiError(400, 'invalid_body');
    const out = rec(await api.request('/api/v1/social/developer/webhooks', { method: 'POST', headers: json, body: JSON.stringify({ label: i.label.trim(), url: i.url.trim(), events: i.events }) }));
    const secret = str(out?.signing_secret);
    if (!secret) throw new ApiError(502, 'no_secret');
    return { id: str(out?.endpoint_id) ?? '', secret };
}

export async function revokeKey(api: Api, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw new ApiError(400, 'invalid_id');
    await api.request(`/api/v1/social/developer/keys?id=${enc(id)}`, { method: 'DELETE' });
}

export async function revokeWebhook(api: Api, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw new ApiError(400, 'invalid_id');
    await api.request(`/api/v1/social/developer/webhooks?id=${enc(id)}`, { method: 'DELETE' });
}

export type DevErrorKey = 'dev.err.off' | 'dev.err.plan' | 'dev.err.role' | 'dev.err.limit' | 'dev.err.rate' | 'dev.err.network' | 'dev.err.invalid' | 'dev.err.failed';

export function devErrorKey(err: unknown): DevErrorKey {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'dev.err.network';
        if (err.status === 404 && (err.code === 'customer_api_not_open' || err.code === 'customer_webhooks_not_open')) return 'dev.err.off';
        if (err.status === 402 || err.code === 'plan_required') return 'dev.err.plan';
        if (err.status === 403) return 'dev.err.role';
        if (err.status === 409) return 'dev.err.limit';
        if (err.status === 429) return 'dev.err.rate';
        if (err.status === 400) return 'dev.err.invalid';
    }
    return 'dev.err.failed';
}
