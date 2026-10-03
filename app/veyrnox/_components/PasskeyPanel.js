'use client';

/**
 * Passkey set-up for the signed-in account (ADR-0032).
 *
 * The sign-in dialog has offered "Sign in with a passkey" since the project
 * setting went on, but nothing let anyone create one. This lists the
 * account's passkeys, adds one and removes one. Removal matters as much as
 * adding: a passkey on a lost device can only be revoked from here.
 */

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { readAuthSettings } from '../../lib/authProviders.js';
import { passkeysSupported, registerPasskey, listPasskeys, deletePasskey } from '../../lib/passkeys.js';
import { PASSKEY_NAME_MAX, cleanPasskeyName, passkeyLabel, passkeyDates, usablePasskeys, passkeyErrorCopy } from '../_lib/passkeyList.js';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export function PasskeyPanel() {
  const [enabled, setEnabled] = useState(null); // null until the setting is read
  const [canCreate, setCanCreate] = useState(false);
  const [passkeys, setPasskeys] = useState(null); // null: not loaded
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setPasskeys(usablePasskeys(await listPasskeys()));
    } catch (err) {
      setPasskeys(null);
      setError(passkeyErrorCopy(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCanCreate(passkeysSupported());
    readAuthSettings(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).then((data) => {
      if (cancelled) return;
      const on = !!data?.passkeys_enabled;
      setEnabled(on);
      if (on) refresh();
    });
    return () => { cancelled = true; };
  }, [refresh]);

  // Switched off in Supabase, or the setting could not be read: say nothing,
  // exactly as the sign-in dialog hides its passkey button.
  if (!enabled) return null;

  async function add(event) {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const created = await registerPasskey(cleanPasskeyName(name) || undefined);
      // null: the browser prompt was dismissed. Not an error (ADR-0032).
      if (created) {
        setName('');
        setMessage('Passkey added. You can sign in with it from now on.');
        await refresh();
      }
    } catch (err) {
      setError(passkeyErrorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey) {
    setRemoving(null);
    setBusy(true); setMessage(''); setError('');
    try {
      await deletePasskey(passkey.id);
      setMessage('Passkey removed.');
      await refresh();
    } catch (err) {
      setError(passkeyErrorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="passkeys-title">
      <h2 id="passkeys-title" className="font-bold mb-2">Passkeys</h2>
      <p className="text-sm text-vx-fg-muted mb-4">
        A passkey signs you in with this device&apos;s fingerprint, face or screen lock instead of a password.
        It works however you first signed up, including with Google or Apple.
      </p>

      {passkeys && passkeys.length > 0 && (
        <ul className="mb-4 divide-y divide-vx-border rounded-xl border border-vx-border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{passkeyLabel(p)}</div>
                <div className="text-[12px] text-vx-fg-muted">{passkeyDates(p)}</div>
              </div>
              <button type="button" disabled={busy} className="text-sm underline disabled:opacity-50" onClick={() => setRemoving(p)}>
                Remove<span className="sr-only"> {passkeyLabel(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {passkeys && passkeys.length === 0 && <p className="mb-4 text-sm text-vx-fg-body">You have no passkeys yet.</p>}

      {canCreate ? (
        <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
          <label className="block text-sm">
            Name (optional)
            <input
              value={name} onChange={(e) => setName(e.target.value)} maxLength={PASSKEY_NAME_MAX}
              placeholder="e.g. MacBook" autoComplete="off"
              className="mt-1 block w-56 rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" disabled={busy} className={button}>{busy ? 'Working…' : 'Add a passkey'}</button>
        </form>
      ) : (
        <p className="text-sm text-vx-fg-body">This browser can&apos;t create passkeys. Open this page in a current browser on the device you want to use.</p>
      )}

      {message && <p role="status" className="mt-3 text-sm text-vx-accent">{message}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-vx-danger">
          {error} {passkeys === null && <button type="button" className="underline" onClick={() => { setError(''); refresh(); }}>Retry</button>}
        </p>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${passkeyLabel(removing)}?`}
          body="You will no longer be able to sign in with it. Your other ways of signing in keep working."
          confirmLabel="Remove passkey"
          tone="danger"
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
