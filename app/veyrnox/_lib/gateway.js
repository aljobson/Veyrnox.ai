'use client';

// Thin fetch wrapper for /api/v1/* — adds Bearer, dispatches
// veyrnox:auth-required on 401, propagates 429 retry-after, throws a
// typed GatewayError otherwise so callers can branch on .code.

import { getFreshAccessToken, getSession, clearSession } from '../../lib/authClient';

// A Frozen account (Chargeback, #97): generating and buying are refused.
export const ACCOUNT_PAUSED_COPY =
  'Your account is paused while we review a payment dispute, so generating and buying are unavailable. '
  + 'Your library and downloads still work. Contact support@veyrnox.com to resolve it.';

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
 * On 5xx or shape error → throws with .code = 'gateway_error'.
 *
 * @param {string} path       leading slash, e.g. '/balance', '/jobs/123'
 * @param {RequestInit} [init]
 */
export async function gatewayFetch(path, init = {}) {
  const token = await getFreshAccessToken();
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
  if (init.body && typeof init.body === 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers });

  assertCurrentAccount();
  if (res.status === 401) {
    // The gateway rejected our token: drop it so a revoked session cannot linger.
    if (getSession()?.access_token === token) {
      clearSession();
      dispatchAuthRequired();
    }
    throw new GatewayError('unauthenticated', { status: 401, code: 'unauthenticated' });
  }
  if (res.status === 429) {
    const retryAfter = Math.max(1, Number(res.headers.get('retry-after')) || 60);
    throw new GatewayError('rate_limited', { status: 429, code: 'rate_limited', retryAfter });
  }

  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  assertCurrentAccount();
  if (!res.ok) {
    throw new GatewayError(body?.error || `HTTP ${res.status}`, {
      status: res.status,
      code: body?.error || 'gateway_error',
      body,
    });
  }
  return body;
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
