import { ApiError, type ApiClient } from './api';

// In-app account deletion (ADR-0111 on the server, ADR-0110 here). Two calls:
// POST /api/v1/account/deletion says what would be lost and what stops it and
// hands back a single-use token; DELETE /api/v1/account with that token erases.

// Build-time switch, like store billing. The server answers 404 while its own
// ACCOUNT_DELETION_ENABLED is off, which the screen reads as "not available yet".
export const ACCOUNT_DELETION_ENABLED = process.env.EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED === 'true';

// What the server can list as stopping a deletion, with the words the person sees.
const BLOCKER_COPY: Record<string, string> = {
    account_frozen: 'Your account is frozen. Contact support to resolve it first.',
    account_on_hold: 'Your account is on hold. Contact support to resolve it first.',
    active_subscription: 'You have an active plan. Cancel it first (plans bought in the App Store or Google Play are cancelled in that store).',
    generation_in_progress: 'A creation is still running. Wait for it to finish.',
    top_up_in_progress: 'A credit purchase is still being processed. Try again in about two hours.',
    cinema_content_present: 'You have Cinema content. Remove it first, or contact support.',
    projects_present: 'You have saved projects. Delete them on the website first.',
    publish_team_present: 'You are part of a Publish team. Leave or remove the team on the website first.',
};
const UNKNOWN_BLOCKER = 'Something on your account stops deletion. Contact support.';

export const blockerText = (code: string): string => BLOCKER_COPY[code] ?? UNKNOWN_BLOCKER;

export interface Forfeit {
    readonly credits: number;
    readonly freeCredits: number;
}

export type Prepared =
    | { readonly kind: 'ready'; readonly forfeit: Forfeit; readonly token: string }
    | { readonly kind: 'blocked'; readonly forfeit: Forfeit; readonly blockers: string[] }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
    | { readonly kind: 'failed' };

export type Erased =
    | { readonly kind: 'deleted' }
    | { readonly kind: 'blocked'; readonly blockers: string[] }
    // The token expired or is unknown: start again from the first call.
    | { readonly kind: 'expired' }
    // Data is erased but removing the sign-in failed: send the same token again.
    | { readonly kind: 'retry' }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'failed' };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const codes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : []);

function forfeitOf(body: Record<string, unknown>): Forfeit {
    const f = (body.forfeit ?? {}) as Record<string, unknown>;
    return { credits: num(f.credits), freeCredits: num(f.free_credits) };
}

export async function prepareDeletion(api: Pick<ApiClient, 'request'>): Promise<Prepared> {
    try {
        const body = await api.request<Record<string, unknown>>('/api/v1/account/deletion', { method: 'POST' });
        const forfeit = forfeitOf(body);
        if (body.eligible === true && typeof body.confirmation_token === 'string' && body.confirmation_token) {
            return { kind: 'ready', forfeit, token: body.confirmation_token };
        }
        return { kind: 'blocked', forfeit, blockers: codes(body.blockers) };
    } catch (err) {
        if (err instanceof ApiError) {
            if (err.status === 404) return { kind: 'unavailable' };
            if (err.status === 429) return { kind: 'rate_limited', retryAfterSeconds: num(err.body.retry_after_seconds) || 3600 };
        }
        return { kind: 'failed' };
    }
}

export async function confirmDeletion(api: Pick<ApiClient, 'request'>, token: string): Promise<Erased> {
    try {
        await api.request('/api/v1/account', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmation_token: token }),
        });
        return { kind: 'deleted' };
    } catch (err) {
        if (err instanceof ApiError) {
            if (err.status === 409 && err.code === 'deletion_blocked') return { kind: 'blocked', blockers: codes(err.body.blockers) };
            if (err.status === 400 && (err.code === 'confirmation_expired' || err.code === 'confirmation_invalid')) return { kind: 'expired' };
            if (err.status === 502 && err.code === 'deletion_incomplete') return { kind: 'retry' };
            if (err.status === 404) return { kind: 'unavailable' };
        }
        return { kind: 'failed' };
    }
}
