import { ApiError, type ApiClient } from './api';

// ADR-0121: read-only Publish screens over /api/v1/social/*. Everything here is parsed defensively:
// the server is the source of truth, and provider text (last_error, captions) is data, never markup.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const https = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://') ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface PublishAccount {
    readonly id: string;
    readonly network: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
    readonly status: string;
    readonly connectedAt: string | null;
    readonly tokenExpiresAt: string | null;
}

export function parseAccounts(body: unknown): { accountLimit: number; accounts: PublishAccount[] } {
    const b = isObject(body) ? body : {};
    const accounts: PublishAccount[] = [];
    for (const raw of list(b.accounts)) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const network = str(raw.network);
        if (!id || !network) continue;
        accounts.push({
            id,
            network,
            displayName: str(raw.display_name) ?? network,
            avatarUrl: https(raw.avatar_url),
            status: str(raw.status) ?? 'error',
            connectedAt: str(raw.connected_at),
            tokenExpiresAt: str(raw.token_expires_at),
        });
    }
    const limit = typeof b.accountLimit === 'number' && Number.isInteger(b.accountLimit) && b.accountLimit > 0 ? b.accountLimit : 1;
    return { accountLimit: limit, accounts };
}

export interface PostTarget {
    readonly id: string;
    readonly network: string;
    readonly publishStatus: string;
    readonly url: string | null;
    readonly lastError: string | null;
}

export interface PublishPost {
    readonly id: string;
    readonly status: string;
    readonly scheduledAt: string | null;
    readonly text: string;
    readonly createdAt: string | null;
    readonly targets: PostTarget[];
}

export function parsePosts(body: unknown): PublishPost[] {
    const out: PublishPost[] = [];
    for (const raw of list(isObject(body) ? body.posts : null)) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        if (!id) continue;
        const targets: PostTarget[] = [];
        for (const t of list(raw.targets)) {
            if (!isObject(t)) continue;
            const tid = str(t.id);
            const network = str(t.network);
            if (!tid || !network) continue;
            targets.push({ id: tid, network, publishStatus: str(t.publish_status) ?? 'pending', url: https(t.platform_post_url), lastError: str(t.last_error) });
        }
        out.push({ id, status: str(raw.status) ?? 'unknown', scheduledAt: str(raw.scheduled_at), text: typeof raw.global_text === 'string' ? raw.global_text : '', createdAt: str(raw.created_at), targets });
    }
    return out;
}

export const postStatusLabel = (s: string): string =>
    ({ draft: 'Draft', scheduled: 'Scheduled', published: 'Published', failed: 'Failed', canceled: 'Canceled' })[s] ?? 'Unknown';

export const targetStatusLabel = (s: string): string =>
    ({ pending: 'Waiting', publishing: 'Publishing', submitted: 'Sent to the network', delivered: 'Delivered', published: 'Published', failed: 'Failed' })[s] ?? 'Unknown';

export const accountStatusLabel = (s: string): string =>
    ({ active: 'Connected', expired: 'Needs to be reconnected', revoked: 'Access was removed', error: 'Needs attention' })[s] ?? 'Needs attention';

// Provider text shown as plain text in a bounded box: control characters removed, cut at 300.
export function boundedError(text: string | null): string | null {
    // eslint-disable-next-line no-control-regex
    const clean = (text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!clean) return null;
    return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}

export interface AnalyticsDay {
    readonly date: string;
    readonly metrics: Record<string, number>;
}
export interface AnalyticsPost {
    readonly id: string;
    readonly publishedAt: string | null;
    readonly type: string | null;
    readonly link: string | null;
    readonly caption: string;
    readonly metrics: Record<string, number>;
}
export interface Analytics {
    readonly account: { readonly id: string; readonly network: string; readonly displayName: string; readonly status: string } | null;
    readonly lastOkAt: string | null;
    readonly syncFailing: boolean;
    readonly days: AnalyticsDay[];
    readonly posts: AnalyticsPost[];
}

const numbers = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (isObject(v)) for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
};

export function parseAnalytics(body: unknown): Analytics {
    const b = isObject(body) ? body : {};
    const a = isObject(b.account) ? b.account : null;
    const accountId = a ? str(a.id) : null;
    const sync = isObject(b.sync) ? b.sync : {};
    const days: AnalyticsDay[] = [];
    for (const d of list(b.evolution)) if (isObject(d) && str(d.date)) days.push({ date: d.date as string, metrics: numbers(d.metrics) });
    const posts: AnalyticsPost[] = [];
    for (const p of list(b.posts)) {
        if (!isObject(p) || !str(p.id)) continue;
        posts.push({ id: p.id as string, publishedAt: str(p.published_at), type: str(p.type), link: https(p.permalink), caption: typeof p.caption === 'string' ? p.caption : '', metrics: numbers(p.metrics) });
    }
    return {
        account: a && accountId ? { id: accountId, network: str(a.network) ?? '', displayName: str(a.display_name) ?? str(a.network) ?? '', status: str(a.status) ?? 'error' } : null,
        lastOkAt: str(sync.last_ok_at),
        syncFailing: sync.failing === true,
        days,
        posts,
    };
}

export const fetchAccounts = async (api: ApiClient) => parseAccounts(await api.request('/api/v1/social/accounts'));

export interface PostsCursor {
    readonly createdAt: string;
    readonly id: string;
}

export async function fetchPosts(api: ApiClient, cursor?: PostsCursor): Promise<PublishPost[]> {
    const q = cursor ? `?before_created_at=${encodeURIComponent(cursor.createdAt)}&before_id=${encodeURIComponent(cursor.id)}` : '';
    return parsePosts(await api.request(`/api/v1/social/posts${q}`));
}

export async function fetchAnalytics(api: ApiClient, accountId: string, from: string, to: string): Promise<Analytics> {
    return parseAnalytics(await api.request(`/api/v1/social/analytics?accountId=${encodeURIComponent(accountId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
}

// Adds a page to what is shown, skipping posts already shown. `added` is false when the page brought nothing new,
// which stops paging even if a server ignores the cursor and sends the same page again.
export function mergePage(existing: readonly PublishPost[], next: readonly PublishPost[]): { posts: PublishPost[]; added: boolean } {
    const seen = new Set(existing.map((p) => p.id));
    const fresh = next.filter((p) => !seen.has(p.id) && seen.add(p.id));
    return { posts: [...existing, ...fresh], added: fresh.length > 0 };
}

// There is no GET for one post yet, so the detail screen finds it in the list the server returns.
export const findPost = (posts: readonly PublishPost[], id: string): PublishPost | null => posts.find((p) => p.id === id) ?? null;

export function publishErrorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        if (err.status === 0) return 'No connection. Check your internet and try again.';
        if (err.status === 402) return 'This needs the Publish Plan.';
        if (err.status === 404) return 'That account is no longer available.';
        if (err.status === 429) return 'Too many requests. Try again in a moment.';
    }
    return 'Could not load this. Try again.';
}

// The analytics range the server takes: YYYY-MM-DD, inclusive, the last `days` days ending today (UTC).
export function lastDays(days: number, now: Date = new Date()): { from: string; to: string } {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return { from: day(new Date(now.getTime() - (days - 1) * 86_400_000)), to: day(now) };
}

export const metricLabel = (key: string): string => {
    const words = key.replace(/[_-]+/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : key;
};
