/**
 * Server-side two-factor enforcement (audit 2026-10-27, H2).
 *
 * Supabase issues an aal1 token after a password or OAuth sign-in and an aal2 token
 * only after a second factor. Without this check an aal1 token could call every
 * /api/v1 route even for an account that turned on two-factor sign-in, so a stolen
 * password was enough. When REQUIRE_AAL2_WHEN_ENROLLED is 'true', middleware.js
 * answers 403 `mfa_required` to an aal1 token whose account has a verified factor.
 *
 * Off by default: ADR-0311 records the remaining read-recovery, mobile recovery
 * and usable-code backfill prerequisites before enforcement can be enabled.
 *
 * Factor challenge and verify go straight to Supabase Auth, not /api/v1, so an
 * enrolled person can always step up. The aal1 exceptions remove this phone's push token during sign-out and redeem
 * a recovery code bound to the lost authenticator.
 *
 * The answer is cached for 60s per isolate: just after someone turns two-factor on,
 * their other aal1 sessions keep working for up to a minute; just after they turn it
 * off, aal1 calls are refused for up to a minute.
 */
import { rpc } from '../packages/db/supabase-client.js';

const CACHE_MS = 60_000;
const CACHE_MAX = 5_000;
const LOOKUP_TIMEOUT_MS = 3_000;
const AAL1_ALLOWED = new Set(['DELETE /api/v1/devices', 'POST /api/v1/mfa/recovery']);

/** @type {Map<string, {enrolled: boolean, until: number}>} */
const cache = new Map();

export function aal2RequiredWhenEnrolled(env = process.env) {
    return env.REQUIRE_AAL2_WHEN_ENROLLED === 'true';
}

export function allowedAtAal1(method, pathname) {
    return AAL1_ALLOWED.has(`${String(method).toUpperCase()} ${pathname.replace(/\/+$/, '')}`);
}

/**
 * Does the account have a verified authenticator? Cached briefly per isolate, so a
 * signed-in person costs one lookup a minute rather than one per request. Throws when
 * the answer is unavailable: the caller must refuse, not guess.
 */
export async function accountMfaEnrolled(authId, cfg, { now = Date.now(), call = rpc } = {}) {
    const hit = cache.get(authId);
    if (hit && hit.until > now) return hit.enrolled;
    const result = await call('account_mfa_enrolled', { p_auth_id: authId }, { ...cfg, timeoutMs: LOOKUP_TIMEOUT_MS });
    if (typeof result !== 'boolean') throw new Error('account_mfa_enrolled returned a non-boolean');
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(authId, { enrolled: result, until: now + CACHE_MS });
    return result;
}

export function _resetMfaEnrolmentCache() {
    cache.clear();
}
