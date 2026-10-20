import { ApiError, type ApiClient } from './api';

// ADR-0185: ad campaigns, read-only. Drafts and their status only; spending money on ads is switched off on the web
// too, so nothing here can start or change a campaign. Names and URLs are third-party-editable text: shown as plain,
// bounded text, and a link is shown as its host, never opened from the app.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Campaign {
    readonly id: string;
    readonly name: string;
    readonly network: string;
    readonly mode: string;
    readonly objective: string;
    readonly status: string;
    readonly dailyBudgetCents: number;
    readonly currency: string;
    readonly startsAt: string | null;
    readonly endsAt: string | null;
    readonly destinationHost: string | null;
}

export function hostOf(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' ? u.host.slice(0, 80) : null;
    } catch {
        return null;
    }
}

export function parseCampaigns(body: unknown): Campaign[] {
    const out: Campaign[] = [];
    for (const raw of Array.isArray(isObject(body) ? body.campaigns : null) ? (body as { campaigns: unknown[] }).campaigns : []) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const name = str(raw.name);
        if (!id || !UUID_RE.test(id) || !name) continue;
        out.push({
            id,
            name: name.slice(0, 120),
            network: str(raw.network) ?? '',
            mode: str(raw.mode) ?? 'standalone',
            objective: str(raw.objective) ?? '',
            status: str(raw.status) ?? 'draft',
            dailyBudgetCents: typeof raw.daily_budget_cents === 'number' && raw.daily_budget_cents >= 0 ? Math.floor(raw.daily_budget_cents) : 0,
            currency: typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'USD',
            startsAt: str(raw.starts_at),
            endsAt: str(raw.ends_at),
            destinationHost: hostOf(raw.destination_url),
        });
    }
    return out;
}

export const fetchCampaigns = async (api: ApiClient) => parseCampaigns(await api.request('/api/v1/social/ads'));

// 1250 + USD -> "$12.50". An unknown currency code falls back to plain digits and the code.
export function money(cents: number, currency: string): string {
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
    } catch {
        return `${(cents / 100).toFixed(2)} ${currency}`;
    }
}

export function adsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'ads.err.network';
    if (err.status === 402) return 'ads.err.plan';
    if (err.status === 403) return 'ads.err.role';
    if (err.code === 'campaign_not_editable') return 'ads.err.notEditable';
    if (err.code === 'campaign_limit') return 'ads.err.limit';
    if (err.code === 'post_not_found') return 'ads.err.postGone';
    if (err.status === 404) return 'ads.err.notOpen';
    if (err.status === 429) return 'ads.err.rate';
    if (err.status === 400) return 'ads.err.invalid';
    return 'ads.err.later';
}

// ADR-0228: draft campaigns can be created, edited and deleted from the phone. Same routes, plan gate and error codes
// as the web (`PUT`/`DELETE /api/v1/social/ads`); the server only edits or deletes a draft. A draft is a saved form: no
// ad is bought and nothing is sent to an ad network. Starting, pausing and spending stay on veyrnox.ai.
export const NETWORKS = ['meta', 'google', 'tiktok', 'linkedin', 'twitter'] as const;
export const OBJECTIVES = ['awareness', 'traffic', 'engagement', 'leads', 'sales'] as const;
export const MODES = ['standalone', 'boost'] as const;
const EDIT_ROLES = new Set(['owner', 'manager', 'editor']);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export interface CampaignDetail extends Campaign {
    readonly sourcePostId: string | null;
    readonly locations: string[];
    readonly interests: string[];
    readonly ageMin: number;
    readonly ageMax: number;
    readonly destinationUrl: string | null;
    readonly leadFormUrl: string | null;
}

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 2048 ? v : null);

export function parseCampaignDetails(body: unknown): CampaignDetail[] {
    const raws = isObject(body) && Array.isArray(body.campaigns) ? body.campaigns : [];
    const base = parseCampaigns(body);
    const out: CampaignDetail[] = [];
    for (const c of base) {
        const raw = raws.find((r) => isObject(r) && r.id === c.id);
        const a = isObject(raw) && isObject(raw.audience) ? raw.audience : {};
        const src = isObject(raw) ? str(raw.source_post_id) : null;
        out.push({
            ...c,
            sourcePostId: src && UUID_RE.test(src) ? src : null,
            locations: list(a.locations),
            interests: list(a.interests),
            ageMin: typeof a.ageMin === 'number' ? a.ageMin : 18,
            ageMax: typeof a.ageMax === 'number' ? a.ageMax : 65,
            destinationUrl: isObject(raw) ? https(raw.destination_url) : null,
            leadFormUrl: isObject(raw) ? https(raw.lead_form_url) : null,
        });
    }
    return out;
}

// Only an owner, manager or editor can change a campaign; the server checks too.
export const canEditCampaigns = (body: unknown): boolean => isObject(body) && typeof body.brandRole === 'string' && EDIT_ROLES.has(body.brandRole);

export async function fetchCampaignPage(api: ApiClient): Promise<{ campaigns: CampaignDetail[]; canEdit: boolean }> {
    const body = await api.request('/api/v1/social/ads');
    return { campaigns: parseCampaignDetails(body), canEdit: canEditCampaigns(body) };
}

export interface CampaignForm {
    readonly id: string | null;
    readonly name: string;
    readonly network: string;
    readonly mode: string;
    readonly sourcePostId: string | null;
    readonly objective: string;
    readonly dailyBudget: string;
    readonly currency: string;
    readonly locations: string;
    readonly interests: string;
    readonly ageMin: string;
    readonly ageMax: string;
    readonly destinationUrl: string;
    readonly leadFormUrl: string;
    readonly starts: Date | null;
    readonly ends: Date | null;
}

export const emptyForm = (): CampaignForm => ({
    id: null, name: '', network: 'meta', mode: 'standalone', sourcePostId: null, objective: 'awareness', dailyBudget: '15', currency: 'GBP',
    locations: '', interests: '', ageMin: '18', ageMax: '65', destinationUrl: '', leadFormUrl: '', starts: null, ends: null,
});

export const formFromCampaign = (c: CampaignDetail): CampaignForm => ({
    id: c.id, name: c.name, network: c.network, mode: c.mode, sourcePostId: c.sourcePostId, objective: c.objective,
    dailyBudget: (c.dailyBudgetCents / 100).toFixed(2), currency: c.currency, locations: c.locations.join(', '), interests: c.interests.join(', '),
    ageMin: String(c.ageMin), ageMax: String(c.ageMax), destinationUrl: c.destinationUrl ?? '', leadFormUrl: c.leadFormUrl ?? '',
    starts: c.startsAt ? new Date(c.startsAt) : null, ends: c.endsAt ? new Date(c.endsAt) : null,
});

const split = (text: string): string[] => [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];

export interface CampaignBody {
    readonly id: string | null;
    readonly sourcePostId: string | null;
    readonly network: string;
    readonly mode: string;
    readonly name: string;
    readonly objective: string;
    readonly dailyBudgetCents: number;
    readonly currency: string;
    readonly audience: { locations: string[]; interests: string[]; ageMin: number; ageMax: number };
    readonly destinationUrl: string | null;
    readonly leadFormUrl: string | null;
    readonly startsAt: string | null;
    readonly endsAt: string | null;
}

// Mirrors the server's checks so a bad form is caught before the request. Returns the body or a catalog key.
export function buildCampaignBody(f: CampaignForm): { body: CampaignBody } | { errorKey: string } {
    const name = f.name.trim();
    if (!name || name.length > 120) return { errorKey: 'ads.err.name' };
    if (!(NETWORKS as readonly string[]).includes(f.network) || !(OBJECTIVES as readonly string[]).includes(f.objective) || !(MODES as readonly string[]).includes(f.mode)) return { errorKey: 'ads.err.invalid' };
    if (f.mode === 'boost' && !(f.sourcePostId && UUID_RE.test(f.sourcePostId))) return { errorKey: 'ads.err.post' };
    const budget = f.dailyBudget.trim().replace(',', '.');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(budget)) return { errorKey: 'ads.err.budget' };
    const cents = Math.round(Number(budget) * 100);
    if (cents < 100 || cents > 100000000) return { errorKey: 'ads.err.budget' };
    const currency = f.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { errorKey: 'ads.err.currency' };
    const locations = split(f.locations);
    const interests = split(f.interests);
    if (locations.length > 20 || interests.length > 20 || [...locations, ...interests].some((s) => s.length > 80)) return { errorKey: 'ads.err.audience' };
    const ageMin = Number(f.ageMin);
    const ageMax = Number(f.ageMax);
    if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 13 || ageMax > 100 || ageMax < ageMin) return { errorKey: 'ads.err.age' };
    const dest = f.destinationUrl.trim();
    const lead = f.leadFormUrl.trim();
    if ((dest && !https(dest)) || (lead && !https(lead))) return { errorKey: 'ads.err.url' };
    if (f.ends && (!f.starts || f.ends <= f.starts)) return { errorKey: 'ads.err.dates' };
    return {
        body: {
            id: f.id, sourcePostId: f.mode === 'boost' ? f.sourcePostId : null, network: f.network, mode: f.mode, name, objective: f.objective,
            dailyBudgetCents: cents, currency, audience: { locations, interests, ageMin, ageMax }, destinationUrl: dest || null, leadFormUrl: lead || null,
            startsAt: f.starts ? f.starts.toISOString() : null, endsAt: f.ends ? f.ends.toISOString() : null,
        },
    };
}

export const saveCampaign = (api: ApiClient, body: CampaignBody) =>
    api.request<{ campaign_id?: string; created?: boolean }>('/api/v1/social/ads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const deleteCampaign = (api: ApiClient, id: string) => api.request(`/api/v1/social/ads?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
