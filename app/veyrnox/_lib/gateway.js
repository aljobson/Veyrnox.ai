'use client';

// Thin fetch wrapper for /api/v1/* — adds Bearer, dispatches
// veyrnox:auth-required on 401, propagates 429 retry-after, throws a
// typed GatewayError otherwise so callers can branch on .code.

import { getFreshAccessToken, getSession, clearSession } from '../../lib/authClient.js';
import { waitForStepUp } from '../../lib/mfaStepUpWait.js';
import { getSelectedSocialBrand, setSelectedSocialBrand, assertSocialBrandSnapshot } from '../../lib/socialBrandSelection.js';
import { captureOperationalError } from '../../lib/analyticsClient.js';
import { normaliseGatewayPath } from '../../lib/analyticsPrivacy.js';
import { apiErrorDetails } from '../../lib/apiErrorDetails.js';

// A Frozen account (Chargeback, #97): generating and buying are refused.
export const ACCOUNT_PAUSED_COPY =
  'Your account is paused while we review a payment dispute, so generating and buying are unavailable. '
  + 'Your library and downloads still work. Contact support@veyrnox.com to resolve it.';
// A standing content strike (ADR-0083): generating waits out the hold; buying and the Library do not.
export const ACCOUNT_ON_HOLD_COPY =
  'Generating is paused on your account for a few days after a content removal. '
  + 'Your library, downloads and credits are unaffected. You can appeal from Account & security.';

export class GatewayError extends Error {
  constructor(message, { status, code, retryAfter, body } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

/**
 * Send a request to /api/v1/<path>. Returns the parsed JSON body.
 *
 * On 401 → dispatches window.CustomEvent('veyrnox:auth-required') so the
 *          root-mounted AuthGate can prompt sign-in, then throws.
 * On 429 → throws with .retryAfter set to the header's seconds.
 * On 503 service_unavailable (Supabase outage, ADR-0160) → throws with .retryAfter; the session is kept.
 * On 5xx or shape error → throws with .code = 'gateway_error'.
 *
 * @param {string} path       leading slash, e.g. '/balance', '/jobs/123'
 * @param {RequestInit & {preserveUploadErrors?: boolean}} [init]
 */
export async function gatewayFetch(path, init = {}, brandRetried = false, brandSnapshot, mfaRetried = false) {
  const { preserveUploadErrors, ...requestInit } = init;
  const assertCurrentBrand = () => { if (brandSnapshot !== undefined) assertSocialBrandSnapshot(brandSnapshot); };
  assertCurrentBrand();
  const token = await getFreshAccessToken();
  assertCurrentBrand();
  if (!token) {
    dispatchAuthRequired();
    throw new GatewayError('not authenticated', { status: 401, code: 'no_token' });
  }
  if (getSession()?.access_token !== token) {
    throw new GatewayError('session changed', { status: 409, code: 'account_changed' });
  }
  const account = getSession()?.user?.id;
  const assertCurrentAccount = () => {
    if (!getSession() || getSession()?.user?.id !== account) {
      throw new GatewayError('account changed', { status: 409, code: 'account_changed' });
    }
  };
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  const selectedBrand = brandSnapshot === undefined ? getSelectedSocialBrand() : brandSnapshot.brandId;
  if (selectedBrand) headers['x-publish-brand-id'] = selectedBrand;
  if (init.body && typeof init.body === 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`/api/v1${path}`, { ...requestInit, headers });
  } catch {
    captureOperationalError('gateway_network_error', {
      route: normaliseGatewayPath(path),
      method: String(init.method || 'GET').toUpperCase(),
    });
    throw new GatewayError('network unavailable', { code: 'network_error' });
  }

  assertCurrentAccount();
  assertCurrentBrand();
  if (res.status === 401) {
    // The gateway rejected our token: drop it so a revoked session cannot linger.
    if (getSession()?.access_token === token) {
      clearSession();
      dispatchAuthRequired();
    }
    throw new GatewayError('unauthenticated', { status: 401, code: 'unauthenticated' });
  }
  // Only the server-render upload flow opts into reservation refusal codes.
  if (preserveUploadErrors === true && path === '/uploads' && !res.ok) {
    let body = null; try { body = await res.json(); } catch { /* typed fallback */ }
    assertCurrentAccount();
    assertCurrentBrand();
    throw new GatewayError('upload refused', { status: res.status, code: typeof body?.error === 'string' && body.error ? body.error : 'upload_failed', body,
      ...(res.status === 429 ? { retryAfter: Math.max(1, Number(res.headers.get('retry-after')) || 60) } : {}) });
  }
  if (res.status === 429) {
    const retryAfter = Math.max(1, Number(res.headers.get('retry-after')) || 60);
    let limitReached = false;
    try {
      const reader = res.clone().body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let text = '';
        try {
          while (text.length <= 4096) {
            const { value, done } = await reader.read();
            text += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (done) {
              limitReached = text.length <= 4096 && JSON.parse(text)?.error?.code === 'LIMIT_REACHED';
              break;
            }
          }
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    } catch { /* Preserve the existing throttle response for unreadable bodies. */ }
    assertCurrentAccount();
    assertCurrentBrand();
    if (limitReached) throw new GatewayError('limit_reached', { status: 429, code: 'limit_reached', retryAfter });
    throw new GatewayError('rate_limited', { status: 429, code: 'rate_limited', retryAfter });
  }

  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  assertCurrentAccount();
  assertCurrentBrand();
  if (res.status === 503 && body?.error === 'service_unavailable') {
    // ADR-0160: the database is not answering. Not a bug and not a lost session: keep the sign-in and let the caller retry.
    const retryAfter = Math.max(1, Number(res.headers.get('retry-after')) || 10);
    throw new GatewayError('service_unavailable', { status: 503, code: 'service_unavailable', retryAfter, body });
  }
  if (!res.ok) {
    // Enrolled-2FA enforcement (ADR-0308, MFA-02): a read fired at aal1 behind the sign-in
    // step-up modal is refused with 403 mfa_required. Hold the request until the person
    // satisfies TOTP (session reaches aal2), then retry it ONCE. GET only — a read is safe to
    // replay, a mutation is not (it throws mfa_required as today and the caller retries after
    // step-up). The mfaRetried guard bounds this to a single wait+retry: a second mfa_required
    // falls through to the typed throw below, so there is no loop. Abandon/sign-out/timeout
    // rejects waitForStepUp, and we throw mfa_required exactly as before.
    if (res.status === 403 && body?.error === 'mfa_required' && !mfaRetried
        && String(init.method || 'GET').toUpperCase() === 'GET') {
      try {
        // Pass the caller's AbortSignal so an aborted read (e.g. editor cleanup) stops waiting
        // and releases the step-up listener/timer at once instead of parking until aal2/timeout.
        await waitForStepUp({ signal: init.signal });
      } catch {
        const failure = apiErrorDetails(body, 403);
        throw new GatewayError(failure.message, { status: 403, code: failure.code, body });
      }
      assertCurrentAccount();
      assertCurrentBrand();
      // Await and re-check: the retry's getFreshAccessToken() could hydrate a different account,
      // whose own guards would pass — re-assert the original account/brand before returning its
      // body to this caller (the brand-recovery branch below does the same).
      const recovered = await gatewayFetch(path, init, brandRetried, brandSnapshot, true);
      assertCurrentAccount();
      assertCurrentBrand();
      return recovered;
    }
    // A removed team membership must not strand read pages on a stale brand.
    // Retry only reads, once, under the current/default authorized brand.
    if (brandSnapshot === undefined && !brandRetried && path.startsWith('/social/') && selectedBrand && res.status === 404 && body?.error === 'brand_not_found'
        && String(init.method || 'GET').toUpperCase() === 'GET') {
      if (getSelectedSocialBrand() === selectedBrand) setSelectedSocialBrand('');
      const recovered = await gatewayFetch(path, init, true, undefined, mfaRetried);
      assertCurrentAccount();
      return recovered;
    }
    // A `*_not_open` reply is a feature switched off on purpose, not a server failure.
    const featureClosed = typeof body?.error === 'string' && body.error.endsWith('_not_open');
    if (res.status >= 500 && !featureClosed) {
      captureOperationalError('gateway_server_error', {
        route: normaliseGatewayPath(path),
        method: String(init.method || 'GET').toUpperCase(),
        status: res.status,
      });
    }
    const failure = apiErrorDetails(body, res.status);
    throw new GatewayError(failure.message, {
      status: res.status,
      code: failure.code,
      body,
    });
  }
  return body;
}

/** Authenticated binary download with the same account/brand guards as gatewayFetch. */
export async function gatewayDownload(path) {
  const token = await getFreshAccessToken();
  if (!token) { dispatchAuthRequired(); throw new GatewayError('not authenticated', { status: 401, code: 'no_token' }); }
  const account = getSession()?.user?.id;
  const headers = { Authorization: `Bearer ${token}` };
  const selectedBrand = getSelectedSocialBrand();
  if (selectedBrand) headers['x-publish-brand-id'] = selectedBrand;
  const res = await fetch(`/api/v1${path}`, { headers });
  if (!getSession() || getSession()?.user?.id !== account) throw new GatewayError('account changed', { status: 409, code: 'account_changed' });
  if (res.status === 401) { clearSession(); dispatchAuthRequired(); throw new GatewayError('unauthenticated', { status: 401, code: 'unauthenticated' }); }
  if (!res.ok) {
    let body = null; try { body = await res.json(); } catch { /* binary failures are not expected */ }
    const failure = apiErrorDetails(body, res.status);
    throw new GatewayError(failure.message, { status: res.status, code: failure.code, body });
  }
  return { blob: await res.blob(), filename: contentDispositionFilename(res.headers.get('content-disposition')) || 'veyrnox-report' };
}

function contentDispositionFilename(value) {
  const match = typeof value === 'string' ? /filename="([A-Za-z0-9._-]{1,100})"/.exec(value) : null;
  return match?.[1] || null;
}

function dispatchAuthRequired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
  }
}

/** Fire after a spend/refund so listeners (AppNav pill) refetch. */
export function notifyBalanceChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('veyrnox:balance-changed'));
  }
}

/**
 * Generate an idempotency key that survives page reloads on the same client.
 *
 * crypto.randomUUID, not Math.random: the key is the uniqueness guarantee on
 * a money path. jobs.idempotency_key is UNIQUE on (user_id, key), so a
 * collision does not double-spend — it silently returns the earlier job
 * instead of running the new one. Math.random gave ~40 bits from a generator
 * with no collision guarantee; this gives 122 bits from the CSPRNG.
 */
export function makeIdempotencyKey() {
  return `vx-${crypto.randomUUID()}`;
}
