import { t } from './i18n';
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
    if (count === 0) return t('referrals.nofriendshavejoinedthroughyourlink');
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
    if (!(err instanceof ApiError)) return t('referrals.couldnotusethatcodeTryagain');
    switch (err.code) {
        case 'invalid_code':
            return t('referrals.thatcodedoesnotlookrightIt');
        case 'self_referral':
            return t('referrals.youcannotuseyourowncode');
        case 'not_new':
            return t('referrals.codesonlyworkfornewaccounts');
        case 'already_attached':
            return 'A code is already attached to this account.';
        case 'not_found':
            return t('referrals.referralsarenotavailablerightnow2');
        case 'network':
            return t('referrals.noconnectionCheckitandtryagain');
        default:
            return t('referrals.couldnotusethatcodeTryagain');
    }
}
