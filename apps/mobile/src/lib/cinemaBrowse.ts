import { API_BASE, ApiError, type ApiClient } from './api';
import { parseTitle, type CinemaTitle, type Episode } from './cinema';

// Cinema browse (ADR-0164): the Series and Vote lists, the 12 category chips, the entitlement read and the share link.
// The server is the authority on every rule. A closed switch is an answer, not a failure: the screen says so.

export const CATEGORIES = [
    { slug: 'romance', label: 'Romance' }, { slug: 'drama', label: 'Drama' }, { slug: 'thriller', label: 'Thriller' },
    { slug: 'comedy', label: 'Comedy' }, { slug: 'horror', label: 'Horror' }, { slug: 'sci-fi', label: 'Sci-Fi' },
    { slug: 'fantasy', label: 'Fantasy' }, { slug: 'action', label: 'Action' }, { slug: 'mystery', label: 'Mystery' },
    { slug: 'documentary', label: 'Documentary' }, { slug: 'animation', label: 'Animation' }, { slug: 'kids', label: 'Kids' },
] as const;
export const categoryKey = (slug: string): string => `cinemaBrowse.cat.${slug}`;

export type BrowseMode = 'series' | 'voting';
export interface Competition {
    readonly id: string;
    readonly name: string;
    readonly endsAt: string;
    readonly qualifiedVotes: number;
}
export interface DiscoveryTitle extends CinemaTitle {
    readonly competitions: readonly Competition[];
}
export interface DiscoveryCursor {
    readonly at: string;
    readonly id: string;
}
export interface DiscoveryPage {
    readonly titles: readonly DiscoveryTitle[];
    readonly next: DiscoveryCursor | null;
}
// 'closed' is the server's "this switch is off" (viewing_not_open, voting_not_open); anything else that fails is 'error'.
export type DiscoveryResult = { readonly kind: 'ok'; readonly page: DiscoveryPage } | { readonly kind: 'closed' } | { readonly kind: 'error' };

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseDiscoveryPage(body: unknown): DiscoveryPage | null {
    if (!isObject(body) || !Array.isArray(body.titles)) return null;
    const titles: DiscoveryTitle[] = [];
    for (const raw of body.titles) {
        const title = parseTitle(raw);
        if (!title || !isObject(raw)) continue;
        const competitions: Competition[] = [];
        if (Array.isArray(raw.competitions)) {
            for (const c of raw.competitions) {
                if (!isObject(c) || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
                competitions.push({ id: c.id, name: c.name, endsAt: typeof c.ends_at === 'string' ? c.ends_at : '', qualifiedVotes: typeof c.qualified_votes === 'number' ? c.qualified_votes : 0 });
            }
        }
        titles.push({ ...title, competitions });
    }
    const n = body.next;
    const next = isObject(n) && typeof n.at === 'string' && typeof n.id === 'string' ? { at: n.at, id: n.id } : null;
    return { titles, next };
}

export function discoveryUrl(mode: BrowseMode, category: string | null, cursor: DiscoveryCursor | null, base: string = API_BASE): string {
    const q = [`mode=${mode}`];
    if (category) q.push(`category=${encodeURIComponent(category)}`);
    if (cursor) q.push(`before=${encodeURIComponent(cursor.at)}`, `before_id=${encodeURIComponent(cursor.id)}`);
    return `${base}/api/cinema/discovery?${q.join('&')}`;
}

const CLOSED = ['viewing_not_open', 'voting_not_open'];

// Anonymous read, no-store on the server. A 503 with a "not open" code is the closed state.
export async function fetchDiscovery(mode: BrowseMode, category: string | null, cursor: DiscoveryCursor | null, doFetch: typeof fetch = fetch, base: string = API_BASE): Promise<DiscoveryResult> {
    let res: Response;
    try {
        res = await doFetch(discoveryUrl(mode, category, cursor, base));
    } catch {
        return { kind: 'error' };
    }
    let body: unknown = null;
    try {
        body = await res.json();
    } catch {
        // Not JSON: treated as an error below.
    }
    if (res.status === 503 && isObject(body) && typeof body.error === 'string' && CLOSED.includes(body.error)) return { kind: 'closed' };
    if (!res.ok) return { kind: 'error' };
    const page = parseDiscoveryPage(body);
    return page ? { kind: 'ok', page } : { kind: 'error' };
}

// ---- Entitlement (GET /api/v1/cinema/entitlement?content_id=) ----

export type LockReason = 'free_ceiling' | 'not_open' | 'locked' | 'paid' | 'gone' | 'busy' | 'network';
export type Entitlement =
    | { readonly kind: 'open' }
    | { readonly kind: 'locked'; readonly reason: LockReason; readonly credits: number | null };

// Why a title cannot be watched, as the i18n key for the sentence shown. Paid unlocks are not offered in the app
// (an open store-policy check), so a locked title is explained and never priced.
export const lockMessageKey = (reason: LockReason): string => `cinemaBrowse.lock.${reason}`;

export function parseEntitlement(body: unknown): Entitlement {
    if (!isObject(body)) return { kind: 'locked', reason: 'busy', credits: null };
    if (body.access === 'free' || body.access === 'unlocked' || body.access === 'pass') return { kind: 'open' };
    const credits = typeof body.credits === 'number' ? body.credits : null;
    // A locked title that has a credit price is a paid one: say so, and never show the price (ADR-0207).
    const reason = body.reason === 'free_ceiling' ? 'free_ceiling' : credits !== null && credits > 0 ? 'paid' : 'locked';
    return { kind: 'locked', reason, credits };
}

export async function fetchEntitlement(api: Pick<ApiClient, 'request'>, contentId: string): Promise<Entitlement> {
    try {
        return parseEntitlement(await api.request<unknown>(`/api/v1/cinema/entitlement?content_id=${encodeURIComponent(contentId)}`));
    } catch (err) {
        if (!(err instanceof ApiError)) return { kind: 'locked', reason: 'busy', credits: null };
        if (err.code === 'unlocks_not_open') return { kind: 'locked', reason: 'not_open', credits: null };
        if (err.code === 'content_not_found') return { kind: 'locked', reason: 'gone', credits: null };
        if (err.code === 'network' || err.status === 0) return { kind: 'locked', reason: 'network', credits: null };
        if (err.code === 'locked') return { kind: 'locked', reason: err.body.reason === 'free_ceiling' ? 'free_ceiling' : 'locked', credits: null };
        return { kind: 'locked', reason: 'busy', credits: null };
    }
}

const inOrder = (episodes: readonly Episode[]): Episode[] => [...episodes].sort((a, b) => a.season - b.season || a.position - b.position);
export const firstEpisode = (episodes: readonly Episode[]): Episode | null => inOrder(episodes)[0] ?? null;
// The first episode a viewer can watch now, in season and episode order; null when none is.
export const firstWatchable = (episodes: readonly Episode[]): Episode | null => inOrder(episodes).find((e) => e.watchable) ?? null;

// ---- Share ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WEB_ORIGIN = 'https://veyrnox.ai';
export const isTitleId = (id: string) => UUID_RE.test(id);
// The public page for a title (the same address lib/cinema/publicUrl.js builds). Nothing about the viewer is in it.
export const titleShareUrl = (id: string): string | null => (UUID_RE.test(id) ? `${WEB_ORIGIN}/social-cinema/title/${id.toLowerCase()}` : null);
