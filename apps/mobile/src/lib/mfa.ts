import { AuthError } from './auth/supabaseAuth';
import type { Factor, Profile } from './auth/accountCalls';

// Rules for two-factor sign-in (parity P7 slice 2, ADR-0150). Pure, so every state is tested.
const CODE_RE = /^[0-9]{6}$/;
export const validCode = (value: string): boolean => CODE_RE.test(value);

export const verifiedFactors = (factors: readonly Factor[]): Factor[] => factors.filter((f) => f.status === 'verified');

// The assurance level in the access token: 'aal1' (password or social sign-in) or 'aal2' (a factor was satisfied).
export function aalFromToken(accessToken: string | null): 'aal1' | 'aal2' | null {
    const part = accessToken?.split('.')[1];
    if (!part) return null;
    try {
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
        const aal = (JSON.parse(json) as { aal?: unknown }).aal;
        return aal === 'aal1' || aal === 'aal2' ? aal : null;
    } catch {
        return null;
    }
}

export type MfaState = 'none' | 'locked' | 'unlocked';

// none: no verified factor. locked: a factor exists but this session is only aal1. unlocked: aal2.
export function mfaState(profile: Pick<Profile, 'factors'>, aal: 'aal1' | 'aal2' | null): MfaState {
    if (verifiedFactors(profile.factors).length === 0) return 'none';
    return aal === 'aal2' ? 'unlocked' : 'locked';
}

// Sign-in must stop at the code step only when a verified factor exists and the session has not satisfied it. An
// unknown level counts as not satisfied: a person with a factor is asked, never waved through on a guess.
export const needsChallenge = (profile: Pick<Profile, 'factors'>, aal: 'aal1' | 'aal2' | null): boolean =>
    verifiedFactors(profile.factors).length > 0 && aal !== 'aal2';

// Every enrolment attempt gets its own label: Supabase wants friendly names unique and keeps an interrupted
// attempt as an unverified factor, which only an aal2 session may delete.
export const enrolmentName = (suffix: string): string => `Veyrnox.ai ${suffix}`;

export type MfaErrorKey = 'acct.mfa.err.code' | 'acct.mfa.err.rate' | 'acct.err.network' | 'acct.mfa.err.failed';

export function mfaErrorKey(err: unknown): MfaErrorKey {
    if (err instanceof AuthError) {
        if (err.status === 0) return 'acct.err.network';
        if (err.status === 429 || err.code === 'over_request_rate_limit') return 'acct.mfa.err.rate';
        if (err.code === 'mfa_verification_failed' || err.code === 'mfa_challenge_expired' || err.status === 422 || err.status === 400) return 'acct.mfa.err.code';
    }
    return 'acct.mfa.err.failed';
}

// Opens the authenticator app with the secret filled in. Only an otpauth address for a TOTP factor is passed on.
export const isTotpUri = (uri: string): boolean => /^otpauth:\/\/totp\//i.test(uri);
