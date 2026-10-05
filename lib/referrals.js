// ADR-0071: referral attribution. The code alphabet has no I, L, O, 0 or 1; the database enforces the same pattern.
export const REFERRAL_CODE_RE = /^[2-9A-HJKMNP-Z]{10}$/;

/** A code as typed or carried in a link: trimmed and upper-cased, then it must match the pattern exactly. */
export function normalizeReferralCode(value) {
    if (typeof value !== 'string' || value.length > 32) return null;
    const code = value.trim().toUpperCase();
    return REFERRAL_CODE_RE.test(code) ? code : null;
}

export const referralsEnabled = (env) => !!env && env.REFERRALS_ENABLED === 'true';
