import { ApiError, type ApiClient } from './api';

// ADR-0071: a friend you send who buys their first Credit Pack earns you Credits. Mirrors
// lib/referrals.js; the alphabet leaves out I, L, O, 0 and 1 so a code is hard to misread.
const CODE_RE = /^[2-9A-HJKMNP-Z]{10}$/;

export function normalizeReferralCode(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 32) return null;
    const code = value.trim().toUpperCase();
    return CODE_RE.test(code) ? code : null;
}

export const referralLink = (code: string): string => `https://veyrnox.ai/?ref=${code}`;

export function friendsLine(count: number): string {
    if (count === 0) return 'No friends have joined through your link yet.';
    return count === 1 ? '1 friend has joined through your link.' : `${count} friends have joined through your link.`;
}

export type ReferralInfo = { readonly enabled: false } | { readonly enabled: true; readonly code: string; readonly referred: number };

// Off means the server flag is off or the answer is unusable: show nothing rather than a broken screen.
export async function fetchReferrals(api: ApiClient): Promise<ReferralInfo> {
    const r = await api.request<{ enabled?: boolean; code?: unknown; referred?: unknown }>('/api/v1/referrals');
    const code = normalizeReferralCode(r.code);
    if (r.enabled !== true || !code) return { enabled: false };
    return { enabled: true, code, referred: Number.isInteger(r.referred) ? (r.referred as number) : 0 };
}

export async function attachReferral(api: ApiClient, raw: string): Promise<void> {
    const code = normalizeReferralCode(raw);
    if (!code) throw new ApiError(400, 'invalid_code');
    await api.request('/api/v1/referrals/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    });
}

export function attachMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return 'Could not use that code. Try again.';
    switch (err.code) {
        case 'invalid_code':
            return 'That code does not look right. It has 10 letters and numbers.';
        case 'self_referral':
            return 'You cannot use your own code.';
        case 'not_new':
            return 'Codes only work for new accounts.';
        case 'already_attached':
            return 'A code is already attached to this account.';
        case 'not_found':
            return 'Referrals are not available right now.';
        case 'network':
            return 'No connection. Check it and try again.';
        default:
            return 'Could not use that code. Try again.';
    }
}
