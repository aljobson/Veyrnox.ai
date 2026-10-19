import { ApiError, type ApiClient } from './api';
import { API_BASE } from './api';

// ADR-0164: SmartLinks. One public link page per brand at /s/<address> with up to 20 buttons. The editor route
// answers 404 `smartlinks_not_open` while its flag is off and 402 without the Publish Plan.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const THEMES = ['midnight', 'light', 'sunset'] as const;
export type Theme = (typeof THEMES)[number];
export const MAX_ITEMS = 20;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

export interface LinkItem {
    readonly id: string | null; // null for one not saved yet
    readonly label: string;
    readonly url: string;
    readonly enabled: boolean;
    readonly clicks: number;
}
export interface SmartLink {
    readonly slug: string;
    readonly title: string;
    readonly bio: string;
    readonly avatarUrl: string;
    readonly theme: Theme;
    readonly published: boolean;
    readonly items: LinkItem[];
    readonly views: number;
    readonly clicks: number;
}

export const EMPTY: SmartLink = { slug: '', title: '', bio: '', avatarUrl: '', theme: 'midnight', published: false, items: [], views: 0, clicks: 0 };

// A brand with no SmartLink yet gets the empty one to fill in.
export function parseSmartlink(body: unknown): SmartLink {
    const b = isObject(body) ? body : {};
    const s = isObject(b.smartlink) ? b.smartlink : null;
    if (!s) return EMPTY;
    const items: LinkItem[] = [];
    for (const raw of Array.isArray(b.items) ? b.items : []) {
        if (!isObject(raw)) continue;
        const label = str(raw.label);
        const url = str(raw.url);
        if (label && url) items.push({ id: str(raw.id), label, url, enabled: raw.enabled !== false, clicks: num(raw.clicks) });
    }
    const totals = isObject(b.totals) ? b.totals : {};
    const theme = THEMES.find((t) => t === s.theme) ?? 'midnight';
    return { slug: str(s.slug) ?? '', title: str(s.title) ?? '', bio: typeof s.bio === 'string' ? s.bio : '', avatarUrl: typeof s.avatar_url === 'string' ? s.avatar_url : '', theme, published: s.published === true, items, views: num(totals.views), clicks: num(totals.clicks) };
}

export const fetchSmartlink = async (api: ApiClient) => parseSmartlink(await api.request('/api/v1/social/smartlink'));

// The page address people open. Built from the app's own API base, never from server text.
export const publicUrl = (slug: string): string => `${API_BASE}/s/${slug}`;

export const slugFrom = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]/g, '');

const https = (v: string) => /^https:\/\/[^\s]+$/.test(v.trim()) && v.trim().length <= 1000;

// A key into the catalog for what is wrong, or null.
export function validateSmartlink(l: SmartLink): string | null {
    if (!SLUG_RE.test(l.slug.trim())) return 'smartlink.err.slug';
    if (!l.title.trim() || l.title.trim().length > 80) return 'smartlink.err.title';
    if (l.bio.trim().length > 280) return 'smartlink.err.bio';
    if (l.avatarUrl.trim() && !https(l.avatarUrl)) return 'smartlink.err.avatar';
    if (l.items.length > MAX_ITEMS) return 'smartlink.err.tooMany';
    for (const i of l.items) {
        if (!i.label.trim() || i.label.trim().length > 60) return 'smartlink.err.label';
        if (!https(i.url)) return 'smartlink.err.url';
    }
    return null;
}

export const saveSmartlink = (api: ApiClient, l: SmartLink) =>
    api.request<{ smartlink_id?: string }>('/api/v1/social/smartlink', json('PUT', {
        slug: l.slug.trim().toLowerCase(), title: l.title.trim(), bio: l.bio.trim(), avatarUrl: l.avatarUrl.trim(), theme: l.theme, published: l.published,
        items: l.items.map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label.trim(), url: i.url.trim(), enabled: i.enabled })),
    }));

export function smartlinkErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'smartlink.err.network';
    if (err.status === 402) return 'smartlink.err.plan';
    if (err.status === 403) return 'smartlink.err.role';
    if (err.code === 'smartlinks_not_open') return 'smartlink.err.notOpen';
    if (err.status === 409) return 'smartlink.err.taken';
    if (err.status === 400) return 'smartlink.err.invalid';
    if (err.status === 429) return 'smartlink.err.rate';
    return 'smartlink.err.later';
}
