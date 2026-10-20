import type { ApiClient } from './api';

// Past credit purchases (GET /api/v1/top-ups), newest first, paged with the same keyset cursor as the credit
// history. Read-only: credits are bought in the store, and nothing here starts a purchase.
export interface TopUp {
    readonly id: string;
    readonly credits: number;
    readonly priceCents: number | null;
    readonly status: string;
    readonly createdAt: string;
}

export interface TopUpCursor {
    readonly before: string;
    readonly beforeId: string;
}

export interface TopUpPage {
    readonly items: readonly TopUp[];
    readonly next: TopUpCursor | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePage(body: unknown): TopUpPage {
    const r = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const items: TopUp[] = [];
    for (const raw of Array.isArray(r.top_ups) ? r.top_ups : []) {
        const t = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        if (!t || typeof t.id !== 'string' || typeof t.created_at !== 'string' || !Number.isFinite(t.credits)) continue;
        items.push({
            id: t.id,
            credits: t.credits as number,
            priceCents: Number.isFinite(t.price_usd_cents) ? (t.price_usd_cents as number) : null,
            status: typeof t.status === 'string' ? t.status : 'unknown',
            createdAt: t.created_at,
        });
    }
    const n = r.next && typeof r.next === 'object' ? (r.next as Record<string, unknown>) : null;
    const next = n && typeof n.before === 'string' && typeof n.before_id === 'string' && UUID_RE.test(n.before_id) ? { before: n.before, beforeId: n.before_id } : null;
    return { items, next };
}

export async function fetchTopUps(api: Pick<ApiClient, 'request'>, cursor: TopUpCursor | null = null): Promise<TopUpPage> {
    const query = cursor ? `?before=${encodeURIComponent(cursor.before)}&before_id=${encodeURIComponent(cursor.beforeId)}` : '';
    return parsePage(await api.request(`/api/v1/top-ups${query}`));
}

export function merge(shown: readonly TopUp[], more: readonly TopUp[]): TopUp[] {
    const seen = new Set(shown.map((t) => t.id));
    return [...shown, ...more.filter((t) => !seen.has(t.id))];
}

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function statusKey(status: string): 'topup.status.pending' | 'topup.status.credited' | 'topup.status.other' {
    if (status === 'pending') return 'topup.status.pending';
    if (status === 'credited') return 'topup.status.credited';
    return 'topup.status.other';
}
