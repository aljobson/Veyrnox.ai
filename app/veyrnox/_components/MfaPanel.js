'use client';

/**
 * Two-factor enrolment for the signed-in account.
 *
 * Exists so ADMIN_REQUIRE_AAL2 can be switched on: /api/v1/admin/metrics
 * refuses anything but an aal2 session once it is, and a gate nobody can
 * satisfy is not a gate. Admin is the highest-value credential here — it
 * reads the ledger — so the panel lives on the admin page.
 *
 * No QR image: Supabase returns its QR as an SVG string, and injecting raw
 * markup is banned outright by the CI grep gate. The otpauth:// URI and the
 * raw secret are shown as text; every authenticator app takes either.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getAal, listFactors, enrollTotp, verifyFactor, unenrollFactor,
} from '../../lib/authClient.js';

const CODE_RE = /^[0-9]{6}$/;

export function MfaPanel({ requireFresh = false, onVerified } = {}) {
  const [factors, setFactors] = useState(null);
  const [pending, setPending] = useState(null); // { factorId, secret, uri }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [aal, setAal] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setFactors(await listFactors());
      setError(null);
      setAal(getAal());
    } catch {
      setFactors(null);
      setError('Could not read your authenticator settings. Try again.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(err?.message || 'That did not work.'); }
    finally { setBusy(false); }
  }

  const verified = (factors || []).filter((f) => f.status === 'verified');

  return (
    <div className="rounded-2xl border border-vx-border p-5">
      <h2 className="text-[15px] font-bold">Two-factor authentication</h2>
      <p className="mt-1 text-[13px] text-vx-fg-body">
        {verified.length > 0
          ? 'Your authenticator is enabled.'
          : factors === null ? 'Authenticator status is unavailable.' : 'Add an authenticator to help protect your account.'}
      </p>

      {error && <p role="alert" className="mt-3 text-[13px] text-vx-danger">{error} <button type="button" onClick={refresh} className="underline">Retry</button></p>}

      {factors !== null && verified.length === 0 && !pending && (
        <button
          type="button" disabled={busy}
          onClick={() => run(async () => setPending(await enrollTotp('Veyrnox.ai')))}
          className="mt-4 rounded-full bg-vx-accent text-vx-accent-ink font-bold px-4 py-2 text-[13px] disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Set up an authenticator app'}
        </button>
      )}

      {pending && (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-vx-fg-body">
            Add this to your authenticator app, then enter the 6-digit code it shows.
          </p>
          <code className="block break-all rounded-lg bg-vx-panel p-3 text-[11px]">{pending.uri}</code>
          <p className="text-[12px] text-vx-fg-body">
            Or type the secret by hand: <code className="break-all">{pending.secret}</code>
          </p>
          <div className="flex gap-2">
            <input
              value={code} onChange={(e) => setCode(e.target.value.trim())}
              inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6}
              aria-label="Six-digit code from your authenticator app"
              className="w-28 rounded-lg bg-vx-panel border border-vx-border px-3 py-2 text-[13px]"
            />
            <button
              type="button" disabled={busy || !CODE_RE.test(code)}
              onClick={() => run(async () => {
                setAal(await verifyFactor(pending.factorId, code));
                setPending(null); setCode('');
                onVerified?.();
                await refresh();
              })}
              className="rounded-full bg-vx-accent text-vx-accent-ink font-bold px-4 py-2 text-[13px] disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {verified.length > 0 && (requireFresh || aal !== 'aal2') && (
        <div className="mt-4 flex gap-2">
          <input
            value={code} onChange={(e) => setCode(e.target.value.trim())}
            inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6}
            aria-label="Six-digit code from your authenticator app"
            className="w-28 rounded-lg bg-vx-panel border border-vx-border px-3 py-2 text-[13px]"
          />
          <button
            type="button" disabled={busy || !CODE_RE.test(code)}
            onClick={() => run(async () => {
              setAal(await verifyFactor(verified[0].id, code));
              setCode('');
              onVerified?.();
            })}
            className="rounded-full bg-vx-accent text-vx-accent-ink font-bold px-4 py-2 text-[13px] disabled:opacity-60"
          >
            {busy ? 'Checking…' : requireFresh ? 'Verify recent access' : 'Unlock this session'}
          </button>
        </div>
      )}

      {verified.length > 0 && !requireFresh && aal === 'aal2' && (
        <button
          type="button" disabled={busy}
          onClick={() => run(async () => { await unenrollFactor(verified[0].id); await refresh(); })}
          className="mt-4 text-[13px] underline text-vx-fg-body disabled:opacity-60"
        >
          Remove this factor
        </button>
      )}
    </div>
  );
}
