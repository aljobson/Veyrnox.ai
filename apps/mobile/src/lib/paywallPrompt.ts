// Mirrors app/veyrnox/_lib/paywallPrompt.mjs. Keep the thresholds and ordering in sync.

export const LOW_CREDIT_THRESHOLD = 10;
export const NEW_ACCOUNT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PaywallReason = 'first' | 'low' | 'depleted';

export interface PaywallInputs {
    readonly credits: number | null;
    readonly createdAt: string | null;
    readonly seenFirst: boolean;
    readonly shownThisSession: boolean;
    readonly shownDepletedBalance?: boolean;
    readonly now?: number;
}

export function paywallReason({
    credits,
    createdAt,
    seenFirst,
    shownThisSession,
    shownDepletedBalance = false,
    now = Date.now(),
}: PaywallInputs): PaywallReason | null {
    if (!Number.isFinite(credits)) return null;
    if ((credits as number) <= 0 && !shownDepletedBalance) return 'depleted';
    if (shownThisSession) return null;
    const created = Date.parse(createdAt ?? '');
    if (!seenFirst && Number.isFinite(created) && now - created < NEW_ACCOUNT_DAYS * DAY_MS) return 'first';
    if ((credits as number) < LOW_CREDIT_THRESHOLD) return 'low';
    return null;
}
