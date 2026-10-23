import type { ApiClient } from './api';

// ADR-0122: the signed-in person's credit history. Mirrors GET /api/v1/ledger (stable `kind` categories, never the
// operator's reason) and GET /api/v1/ledger/usage. The server gives no running balance, so none is shown.

export interface LedgerEntry {
    readonly id: string;
    readonly delta: number;
    readonly freeDelta: number;
    readonly kind: string;
    readonly createdAt: string;
}

export interface HistoryCursor {
    readonly before: string;
    readonly beforeId: string;
}

export interface HistoryPage {
    readonly entries: readonly LedgerEntry[];
    readonly next: HistoryCursor | null;
}

export interface Usage {
    readonly day: number;
    readonly week: number;
    readonly month: number;
    // True when the month figure is a floor because more rows exist than the server reads.
    readonly truncated: boolean;
}

// Plain-English wording for lib/ledgerKind.js. An unknown kind reads as an adjustment, never as raw text.
const KIND_LABEL: Record<string, string> = {
    signup_grant: 'Welcome credits',
    checkin_reward: 'Daily check-in reward',
    free_credit_expiry: 'Free credits expired',
    generation_refund: 'Refund for a creation that did not finish',
    generation: 'Creation',
    top_up: 'Credits bought',
    referral_reward: 'Referral reward',
    referral_reward_reversed: 'Referral reward taken back',
    payment_adjustment: 'Payment adjustment',
    adjustment: 'Adjustment',
};

export const kindLabel = (kind: string): string => KIND_LABEL[kind] ?? KIND_LABEL.adjustment;

const MINUS = '−';

// "+10 credits", "−3 credits", "+1 credit".
export function creditsDelta(delta: number): string {
    const n = Math.abs(delta);
    return `${delta < 0 ? MINUS : '+'}${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`;
}

export function creditsCount(n: number): string {
    return `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`;
}

export function entryDate(iso: string): string {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? '' : at.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// The part of an entry that came from free credits, when there is one.
export function freeNote(entry: LedgerEntry): string | null {
    return entry.freeDelta !== 0 ? `${creditsCount(Math.abs(entry.freeDelta))} of this was free credits` : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEntry(raw: unknown): LedgerEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.created_at !== 'string' || !Number.isFinite(r.delta)) return null;
    return {
        id: r.id,
        delta: r.delta as number,
        freeDelta: Number.isFinite(r.free_delta) ? (r.free_delta as number) : 0,
        kind: typeof r.kind === 'string' ? r.kind : 'adjustment',
        createdAt: r.created_at,
    };
}

function parseCursor(raw: unknown): HistoryCursor | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    return typeof r.before === 'string' && typeof r.before_id === 'string' && UUID_RE.test(r.before_id) ? { before: r.before, beforeId: r.before_id } : null;
}

export async function fetchHistoryPage(api: Pick<ApiClient, 'request'>, cursor: HistoryCursor | null = null): Promise<HistoryPage> {
    const query = cursor ? `?before=${encodeURIComponent(cursor.before)}&before_id=${encodeURIComponent(cursor.beforeId)}` : '';
    const body = await api.request<{ entries?: unknown; next?: unknown }>(`/api/v1/ledger${query}`);
    const entries = Array.isArray(body.entries) ? body.entries.map(parseEntry).filter((e): e is LedgerEntry => e !== null) : [];
    return { entries, next: parseCursor(body.next) };
}

const spent = (v: unknown): number => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0);

export async function fetchUsage(api: Pick<ApiClient, 'request'>): Promise<Usage> {
    const body = await api.request<{ spent?: Record<string, unknown>; truncated?: unknown }>('/api/v1/ledger/usage');
    return { day: spent(body.spent?.day), week: spent(body.spent?.week), month: spent(body.spent?.month), truncated: body.truncated === true };
}

export function usageLines(usage: Usage): readonly string[] {
    return [
        `Last 24 hours: ${creditsCount(usage.day)}`,
        `Last 7 days: ${creditsCount(usage.week)}`,
        `Last 30 days: ${usage.truncated ? 'at least ' : ''}${creditsCount(usage.month)}`,
    ];
}

// Entries already shown stay; a later page that repeats an id (a new row shifted the cursor) adds nothing.
export function mergePages(shown: readonly LedgerEntry[], more: readonly LedgerEntry[]): LedgerEntry[] {
    const seen = new Set(shown.map((e) => e.id));
    return [...shown, ...more.filter((e) => !seen.has(e.id))];
}
