import type { ApiClient } from './api';

// The viewer's own Cinema Pass, read-only (ADR-0207), from GET /api/v1/cinema/pass. The phone shows whether a Pass is
// active and until when. It never shows a price, a plan, a buy button or a link to buy: a Pass is bought through the
// store once that product exists (ADR-0143), and until then the app only reports what the account already has.

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type PassStatus = 'active' | 'ended' | 'pending';
export interface Pass {
    readonly status: PassStatus;
    readonly periodEnd: string | null;
    readonly cancelsAtPeriodEnd: boolean;
}

const when = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

// The route answers {pass: null} for an account that never had one. Any status other than active or pending reads as ended.
export function parsePass(body: unknown): Pass | null {
    const p = isObject(body) ? body.pass : null;
    if (!isObject(p)) return null;
    const raw = str(p.status);
    const status: PassStatus = raw === 'active' ? 'active' : raw === 'pending' ? 'pending' : 'ended';
    return { status, periodEnd: when(p.current_period_end), cancelsAtPeriodEnd: p.cancel_at_period_end === true };
}

export const fetchPass = async (api: Pick<ApiClient, 'request'>): Promise<Pass | null> => parsePass(await api.request('/api/v1/cinema/pass'));

// An active Pass whose end date has passed is no longer a Pass the screen should call active.
export const passIsLive = (p: Pass | null, now: number = Date.now()): boolean =>
    !!p && p.status === 'active' && (p.periodEnd === null || Date.parse(p.periodEnd) > now);
