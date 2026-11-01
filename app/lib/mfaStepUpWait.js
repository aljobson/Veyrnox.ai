'use client';

// Wait for the sign-in two-factor step-up to complete (ADR-0308, MFA-02 read-recovery).
//
// When REQUIRE_AAL2_WHEN_ENROLLED is on, an enrolled account's /api/v1 reads fire at aal1
// behind the blocking step-up modal and get 403 mfa_required. gateway.js awaits this helper
// so the read holds until the user satisfies TOTP (session reaches aal2) and then retries,
// instead of surfacing a stale/empty page. The step-up UI (components/MfaSignInStepUp.jsx)
// drives aal1 -> aal2; this only observes it. Plain reads of the auth client — no
// @supabase/supabase-js on the SSR graph.
//
// Resolves when the session reaches aal2. Rejects when the person abandons the step-up
// (signs out) or does not finish within timeoutMs, so a request never hangs forever — the
// caller then fails exactly as it did before this existed. Dependencies are injected so the
// helper is unit-testable without a browser; they default to the auth client.

import { getAal as defaultGetAal, getStoredUserId as defaultGetStoredUserId, onSessionChange as defaultOnSessionChange } from './authClient.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export class StepUpWaitError extends Error {
  constructor(code) {
    super(code);
    this.name = 'StepUpWaitError';
    this.code = code;
  }
}

/**
 * Abandonment is keyed on the STORED user id, not on getSession(): a cross-tab metadata write
 * clears the in-memory access token and notifies listeners before re-hydrating it
 * (authClient onStorage), so getSession() is transiently null for the SAME account. The stored
 * id survives that window, so we only reject on a real sign-out (no stored id) or an account
 * swap (a different stored id) — never on transient token absence while still aal1.
 *
 * @param {{ getAal?: () => string|null, getStoredUserId?: () => string|null, onSessionChange?: (cb: Function) => () => void, timeoutMs?: number }} [deps]
 * @returns {Promise<void>}
 */
export function waitForStepUp({
  getAal = defaultGetAal,
  getStoredUserId = defaultGetStoredUserId,
  onSessionChange = defaultOnSessionChange,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    if (getAal() === 'aal2') { resolve(); return; }
    const account = getStoredUserId();
    // Already signed out: there is no step-up to wait for.
    if (!account) { reject(new StepUpWaitError('mfa_abandoned')); return; }

    let settled = false;
    let unsubscribe = () => {};
    let timer = null;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      try { unsubscribe(); } catch { /* listener already gone */ }
      if (timer !== null) clearTimeout(timer);
    };
    const onChange = () => {
      if (settled) return;
      if (getAal() === 'aal2') { cleanup(); resolve(); return; }
      const now = getStoredUserId();
      // Real sign-out, or a different account took over this tab.
      if (!now || now !== account) { cleanup(); reject(new StepUpWaitError('mfa_abandoned')); }
      // Same account, still aal1 (a token refresh or cross-tab hydration): keep waiting.
    };

    unsubscribe = onSessionChange(onChange);

    // Re-check after subscribing: aal2 may have arrived between the first read and here.
    if (getAal() === 'aal2') { cleanup(); resolve(); return; }
    const still = getStoredUserId();
    if (!still || still !== account) { cleanup(); reject(new StepUpWaitError('mfa_abandoned')); return; }

    timer = setTimeout(() => { cleanup(); reject(new StepUpWaitError('mfa_timeout')); }, timeoutMs);
  });
}
