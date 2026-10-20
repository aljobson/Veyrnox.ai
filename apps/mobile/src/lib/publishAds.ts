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
    if (err.status === 404) return 'ads.err.notOpen';
    if (err.status === 429) return 'ads.err.rate';
    return 'ads.err.later';
}
