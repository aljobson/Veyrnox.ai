import { normalizeReferralCode } from '../../../lib/referrals.js';

// ADR-0071: a friend's link carries ?ref=<code>. The code is kept in this browser's local storage for three days, which is long enough to
// confirm an email and sign in (the server only attributes an account less than 48 hours old), then removed. It is never sent anywhere
// until the account is signed in, and the storage notice and privacy policy say so.
export const REFERRAL_KEY = 'veyrnox_referral';
export const REFERRAL_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Read ?ref from a query string. Returns null when there is none; otherwise the query string without it, so the link can be tidied. */
export function rememberReferral(storage, search, now = Date.now()) {
  const params = new URLSearchParams(search || '');
  if (!params.has('ref')) return null;
  const code = normalizeReferralCode(params.get('ref'));
  params.delete('ref');
  if (code) {
    try { storage.setItem(REFERRAL_KEY, JSON.stringify({ code, at: now })); } catch { /* storage blocked: nothing to carry */ }
  }
  return { code, search: params.toString() };
}

/** The remembered code, or null when there is none, it is malformed, or it has expired (an expired or broken record is removed). */
export function recallReferral(storage, now = Date.now()) {
  let raw;
  try { raw = storage.getItem(REFERRAL_KEY); } catch { return null; }
  if (!raw) return null;
  let record;
  try { record = JSON.parse(raw); } catch { record = null; }
  const code = record && typeof record === 'object' ? normalizeReferralCode(record.code) : null;
  const fresh = code && Number.isFinite(record.at) && now - record.at <= REFERRAL_TTL_MS && record.at <= now + REFERRAL_TTL_MS;
  if (!fresh) { forgetReferral(storage); return null; }
  return code;
}

export function forgetReferral(storage) {
  try { storage.removeItem(REFERRAL_KEY); } catch { /* storage blocked */ }
}

/**
 * Whether an attach failure means "do not try again". An answer from the server about the code or the account is final. A sign-in,
 * rate-limit, server or network problem, or an account the server has not provisioned yet, is worth another try on the next visit.
 */
export function attachIsFinal(err) {
  const status = err && err.status;
  if (status === 404) return true; // the feature is off
  return (status === 400 || status === 409) && err.code !== 'user_not_provisioned';
}
