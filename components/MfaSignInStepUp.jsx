'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from './I18nProvider.jsx';
import { tOr } from '../lib/i18n/translate.mjs';
import { clearSession, getAal, getStoredUserId, listFactors, onSessionChange, signOut, verifyFactor } from '../app/lib/authClient.js';
import { needsStepUp, pickFactorId, isLockedOut } from '../app/lib/mfaStepUp.js';

import { consumeRecoveryCode } from '../app/lib/mfaRecoveryClient.js';
import { RECOVERY_CODE_RE } from '../lib/mfaRecovery.js';

const CODE_RE = /^[0-9]{6}$/;
const FOCUS_RING = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent';

export default function MfaSignInStepUp() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const isCallback = pathname?.replace(/\/$/, '') === '/auth/callback';
  const [challengeActive, setChallengeActive] = useState(false);
  const [factorId, setFactorId] = useState(null);
  const [recovery, setRecovery] = useState(false);
  const [recoveredUser, setRecoveredUser] = useState(null);
  const [completedRefresh, setCompletedRefresh] = useState(false);
  const completedUser = useRef(null);
  const [code, setCode] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const gen = useRef(0);
  const challengeId = useRef(0);
  const inFlight = useRef(false);
  const cancelling = useRef(false);
  // Synchronous mirror of challengeActive and the account the open prompt belongs to,
  // read inside the one long-lived `evaluate` closure where the state value is stale.
  const activeRef = useRef(false);
  const challengedUser = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const closeRef = useRef(null);
  const cancelRef = useRef(null);
  const locked = isLockedOut(attempts);

  useEffect(() => {
    if (isCallback) return;
    function invalidate() {
      ++challengeId.current;
      return ++gen.current;
    }
    function close() {
      activeRef.current = false;
      setChallengeActive(false);
    }
    async function evaluate() {
      const aal = getAal();
      const uid = getStoredUserId();
      // Completed recovery belongs to this sign-in, including token refreshes.
      if (aal !== null && completedUser.current === uid && uid) return;
      if (completedUser.current !== null) {
        completedUser.current = null;
        setRecoveredUser(null);
        setCompletedRefresh(false);
      }
      if (aal === null) cancelling.current = false;
      // Same active aal1 challenge for the same account: leave it alone. onSessionChange
      // also fires for token refresh (authClient setSession at broadcast:false) and cross-tab
      // metadata writes; tearing down here would wipe the attempt count and error, flicker the
      // modal, and drop an in-flight verify. Only a changed account, sign-out or aal2 reopens.
      if (aal === 'aal1' && activeRef.current && !cancelling.current && challengedUser.current === uid) return;
      const generation = invalidate();
      inFlight.current = false;
      close();
      if (aal !== 'aal1' || cancelling.current) return;
      try {
        const factors = await listFactors();
        if (generation !== gen.current || getAal() !== 'aal1') return;
        if (!needsStepUp('aal1', factors)) return;
        ++challengeId.current;
        challengedUser.current = getStoredUserId();
        setFactorId(pickFactorId(factors));
        setRecovery(false);
        setCode('');
        setAttempts(0);
        setError(null);
        setBusy(false);
        activeRef.current = true;
        setChallengeActive(true);
      } catch {
        // Presentation fails open; server enforcement remains authoritative.
        console.error('[mfa-step-up] Could not load authenticator factors.');
      }
    }
    const unsubscribe = onSessionChange(evaluate);
    void evaluate();
    return () => {
      invalidate();
      activeRef.current = false;
      unsubscribe();
    };
  }, [isCallback]);

  const cancel = useCallback(() => {
    ++gen.current;
    ++challengeId.current;
    cancelling.current = true;
    inFlight.current = false;
    activeRef.current = false;
    setChallengeActive(false);
    setCode('');
    void signOut().catch(() => {
      // signOut clears the session before any throwing call, so this is defensive:
      // never leave the gate suppressed (cancelling=true) on a still-aal1 session with
      // no prompt. Reset and hard-clear so the next session re-evaluates.
      cancelling.current = false;
      console.error('[mfa-step-up] Could not finish signing out.');
      try { clearSession(); } catch { /* local clear only; nothing else to do */ }
    });
  }, []);

  // Focus the prompt on open and restore focus when it closes.
  useEffect(() => {
    if (!challengeActive || isCallback) return undefined;
    const previous = document.activeElement;
    (inputRef.current || closeRef.current)?.focus?.();
    return () => { previous?.focus?.(); };
  }, [challengeActive, isCallback]);

  // After a failed attempt return focus to the field (the submit button was disabled
  // while busy, dropping focus to the dialog body and out of the Tab trap); at lockout
  // the field is disabled, so move focus to the one control left — Use a different account.
  useEffect(() => {
    if (!challengeActive || isCallback || attempts === 0) return;
    if (locked) cancelRef.current?.focus?.();
    else inputRef.current?.focus?.();
  }, [attempts, locked, challengeActive, isCallback]);

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (event.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  // Explicit recovery completion bypasses evaluate's same-account aal1 short circuit.
  async function completeRecovery(cid, uid) {
    const ownsPrompt = () => cid === challengeId.current && activeRef.current &&
      !cancelling.current && challengedUser.current === uid && getStoredUserId() === uid;
    if (!ownsPrompt()) return false;
    let factors, refreshNeeded = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { factors = await listFactors(); break; }
      catch {
        if (!ownsPrompt()) return false;
        if (attempt === 1) refreshNeeded = true;
      }
    }
    if (!ownsPrompt()) return false;
    if (!refreshNeeded && needsStepUp('aal1', factors)) throw { code: 'recovery_stale' };
    // The server already consumed the code and removed its factors. A failed read
    // must not offer another redemption of that code. Server enforcement still holds.
    completedUser.current = uid;
    setCompletedRefresh(refreshNeeded);
    ++gen.current; ++challengeId.current;
    activeRef.current = false; inFlight.current = false;
    setChallengeActive(false); setCode(''); setBusy(false); setRecoveredUser(uid);
    return true;
  }

  async function submit(event) {
    event.preventDefault();
    if (!challengeActive || inFlight.current || locked || !(recovery ? RECOVERY_CODE_RE : CODE_RE).test(code)) return;
    const cid = challengeId.current;
    const uid = challengedUser.current;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let failureCode;
    try {
      // Adoption synchronously notifies the observer before this resolves.
      // Never apply the lookup's gen/aal1 guard to a successful verification.
      if (recovery) {
        const result = await consumeRecoveryCode(code);
        if (result.stale) throw { code: 'recovery_stale' };
        if (result.recovered) { await completeRecovery(cid, uid); return; }
      } else if (await verifyFactor(factorId, code) === 'aal2') return;
    } catch (err) {
      // GoTrue puts the machine code in error_code on some endpoints and in error on
      // others; authClient carries both. Prefer error_code, fall back to a generic message.
      failureCode = err?.errorCode ?? err?.code;
    }
    if (cid !== challengeId.current || uid !== getStoredUserId()) return;
    setError(tOr(t, (recovery ? 'authGate.mfa.recovery.error.' : 'authGate.mfa.error.') + failureCode, t(recovery ? 'authGate.mfa.recovery.failed' : 'authGate.mfa.failed')));
    setCode('');
    setAttempts(n => failureCode === 'recovery_rate_limited' ? 5 : n + 1);
    inFlight.current = false;
    setBusy(false);
  }

  if (isCallback) return null;
  if (!challengeActive) return recoveredUser && recoveredUser === getStoredUserId() ? (
    <div role="status" className="fixed bottom-4 inset-x-4 z-50 rounded-2xl border border-vx-border bg-vx-panel p-4 text-sm text-vx-fg">
      <a href="/app/account" className={`inline-flex min-h-11 items-center text-vx-accent underline ${FOCUS_RING}`}>{t(completedRefresh ? 'authGate.mfa.recovery.completedRefresh' : 'authGate.mfa.recovery.success')}</a>
      <button type="button" className={`min-h-11 px-3 ${FOCUS_RING}`} onClick={() => setRecoveredUser(null)}>{t('authGate.close')}</button>
    </div>
  ) : null;
  return (
    <div role="dialog" aria-modal="true" aria-label={t('authGate.mfa.title')}
      ref={panelRef} onKeyDown={onKeyDown} dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-vx-base/80 p-4">
      <div className="max-h-full w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-vx-fg">{t('authGate.mfa.title')}</h2>
          <button type="button" ref={closeRef} aria-label={t('authGate.close')} onClick={cancel}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-vx-fg-muted hover:text-vx-fg ${FOCUS_RING}`}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-vx-fg-muted">{t(recovery ? 'authGate.mfa.recovery.body' : 'authGate.mfa.body')}</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input ref={inputRef} inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={recovery ? 11 : 6}
            aria-label={t(recovery ? 'authGate.mfa.recovery.codeLabel' : 'authGate.mfa.codeLabel')} value={code} disabled={locked} dir="ltr"
            onChange={event => setCode(event.target.value.trim())}
            className={`min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-base text-vx-fg disabled:opacity-60 ${FOCUS_RING}`} />
          {locked ? <p role="alert" className="text-sm text-vx-danger">{t('authGate.mfa.tooMany')}</p>
            : error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
          <div role="status" aria-live="polite" className="sr-only">{busy ? t('authGate.working') : null}</div>
          <button type="submit" disabled={busy || locked || !(recovery ? RECOVERY_CODE_RE : CODE_RE).test(code)}
            className={`min-h-13 w-full rounded-xl bg-vx-accent px-4 py-3 text-sm font-semibold text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-60 ${FOCUS_RING}`}>
            {busy ? t('authGate.working') : t('authGate.mfa.verify')}
          </button>
        </form>
        <button type="button" ref={cancelRef} onClick={cancel}
          className={`mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-sm text-vx-fg-muted underline hover:text-vx-fg ${FOCUS_RING}`}>
          {t('authGate.mfa.cancel')}
        </button>
        <button type="button" disabled={busy || locked} onClick={() => { setRecovery(value => !value); setCode(''); setError(null); inputRef.current?.focus(); }}
          className={`mt-4 min-h-11 w-full rounded-xl px-3 py-2 text-sm text-vx-accent underline disabled:opacity-60 ${FOCUS_RING}`}>
          {t(recovery ? 'authGate.mfa.recovery.useAuthenticator' : 'authGate.mfa.recovery.useCode')}
        </button>
        <p className="mt-4 break-words text-sm text-vx-fg-muted">{t('authGate.mfa.lostAccess')}</p>
      </div>
    </div>
  );
}
