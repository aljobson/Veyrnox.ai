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
    // Whether posting to this network is open for this account, and the media types it takes.
    readonly publishingEnabled: boolean;
    readonly supportedMedia: string[];
    readonly carousel?: { min: number; max: number; types: string[] } | null;
}

export type PublishRole = 'owner' | 'manager' | 'editor' | 'reviewer' | 'analyst' | 'viewer';
export type PublishTier = 'free' | 'publish';
export interface PublishFeatures {
    readonly inbox: boolean;
    readonly inboxWorkflows: boolean;
    readonly smartlinks: boolean;
    readonly contentPresets: boolean;
    readonly queues: boolean;
    readonly approvals: boolean;
    readonly teams: boolean;
    readonly variants: boolean;
    readonly reports: boolean;
    readonly customerApi: boolean;
    readonly customerWebhooks: boolean;
    readonly ads: boolean;
    readonly commerce: boolean;
    readonly rssAutolists: boolean;
}
export interface PublishAccountsState {
    readonly brandId: string | null;
    readonly brandRole: PublishRole;
    readonly accountLimit: number;
    readonly planTier: PublishTier;
    readonly plansEnabled: boolean;
    readonly accounts: PublishAccount[];
    readonly uploadsEnabled: boolean;
    readonly carouselEnabled?: boolean;
    readonly features: PublishFeatures;
}

const ROLES: readonly PublishRole[] = ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'];
const flag = (body: Record<string, unknown>, key: string): boolean => body[key] === true;

export function parseAccounts(body: unknown): PublishAccountsState {
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
            publishingEnabled: raw.publishingEnabled === true,
            carousel: b.carouselEnabled === true && isObject(raw.carousel) && typeof raw.carousel.max === 'number' && raw.carousel.max >= 2 && raw.carousel.max <= 10
                ? { min: 2, max: raw.carousel.max, types: list(raw.carousel.types).filter((type): type is string => type === 'image' || type === 'video') } : null,
            supportedMedia: list(raw.supportedMedia).filter((m): m is string => typeof m === 'string'),
        });
    }
    const limit = typeof b.accountLimit === 'number' && Number.isInteger(b.accountLimit) && b.accountLimit > 0 ? b.accountLimit : 1;
    return {
        brandId: str(b.brand_id),
        brandRole: ROLES.find((role) => role === b.brandRole) ?? 'viewer',
        accountLimit: limit,
        planTier: b.planTier === 'publish' ? 'publish' : 'free',
        plansEnabled: flag(b, 'plansEnabled'),
        accounts,
        uploadsEnabled: flag(b, 'uploadsEnabled'),
        carouselEnabled: flag(b, 'carouselEnabled'),
        features: {
            inbox: flag(b, 'inboxEnabled'),
            inboxWorkflows: flag(b, 'inboxWorkflowsEnabled'),
            smartlinks: flag(b, 'smartlinksEnabled'),
            contentPresets: flag(b, 'contentPresetsEnabled'),
            queues: flag(b, 'queuesEnabled'),
            approvals: flag(b, 'approvalsEnabled'),
            teams: flag(b, 'teamsEnabled'),
            variants: flag(b, 'variantsEnabled'),
            reports: flag(b, 'reportsEnabled'),
            customerApi: flag(b, 'customerApiEnabled'),
            customerWebhooks: flag(b, 'customerWebhooksEnabled'),
            ads: flag(b, 'adsEnabled'),
            commerce: flag(b, 'commerceEnabled'),
            rssAutolists: flag(b, 'rssAutolistsEnabled'),
        },
    };
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
    // The version stamp cancel and restore need; the server does not send it on every row yet.
    readonly updatedAt: string | null;
    readonly targets: PostTarget[];
}

export function parsePost(raw: unknown): PublishPost | null {
    if (!isObject(raw)) return null;
    const id = str(raw.id);
    if (!id) return null;
    const targets: PostTarget[] = [];
    for (const t of list(raw.targets)) {
        if (!isObject(t)) continue;
        const tid = str(t.id);
        const network = str(t.network);
        if (!tid || !network) continue;
        targets.push({ id: tid, network, publishStatus: str(t.publish_status) ?? 'pending', url: https(t.platform_post_url), lastError: str(t.last_error) });
    }
    return { id, status: str(raw.status) ?? 'unknown', scheduledAt: str(raw.scheduled_at), text: typeof raw.global_text === 'string' ? raw.global_text : '', createdAt: str(raw.created_at), updatedAt: str(raw.updated_at), targets };
}

export function parsePosts(body: unknown): PublishPost[] {
    return list(isObject(body) ? body.posts : null)
        .map(parsePost)
        .filter((p): p is PublishPost => p !== null);
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
    // How many days of history the plan allows, when the server says (plans on); null otherwise.
    readonly analyticsDays: number | null;
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
        analyticsDays: typeof b.analyticsDays === 'number' && Number.isInteger(b.analyticsDays) && b.analyticsDays > 0 ? b.analyticsDays : null,
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

// GET /api/v1/social/posts/:id (ADR-0121 follow-up). Its row carries updated_at, which cancel and restore need.
export async function fetchPost(api: ApiClient, id: string): Promise<PublishPost | null> {
    const body = await api.request<{ post?: unknown }>(`/api/v1/social/posts/${encodeURIComponent(id)}`);
    return parsePost(isObject(body) ? body.post : null);
}

// The list is the fallback when the single-post route is not available (an older server).
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
