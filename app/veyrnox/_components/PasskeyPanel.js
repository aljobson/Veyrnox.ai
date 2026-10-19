'use client';
import { useI18n } from '../../../components/I18nProvider';

/**
 * Passkey set-up for the signed-in account (ADR-0032).
 *
 * The sign-in dialog has offered "Sign in with a passkey" since the project
 * setting went on, but nothing let anyone create one. This lists the
 * account's passkeys, adds one and removes one. Removal matters as much as
 * adding: a passkey on a lost device can only be revoked from here.
 */

import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { readAuthSettings } from '../../lib/authProviders.js';
import { passkeysSupported, registerPasskey, listPasskeys, deletePasskey } from '../../lib/passkeys.js';
import { PASSKEY_NAME_MAX, cleanPasskeyName, passkeyDates, usablePasskeys, passkeyErrorCopy } from '../_lib/passkeyList.js';

const never = () => () => {};
const cannot = () => false;

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export function PasskeyPanel() {
  const { t, locale } = useI18n();
  const label = passkey => cleanPasskeyName(passkey?.friendly_name) || t('app.account.passkeys.fallback');
  const dates = passkey => {
    if (locale === 'en') return passkeyDates(passkey);
    const day = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(localeTag(locale,'en-GB'), {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) : null;
    const added=day(passkey?.created_at),used=day(passkey?.last_used_at);
    return [added?t('app.account.passkeys.dateAdded',{date:added}):null,used?t('app.account.passkeys.dateUsed',{date:used}):t('app.account.passkeys.never')].filter(Boolean).join(' · ');
  };
  const [enabled, setEnabled] = useState(null); // null until the setting is read
  const canCreate = useSyncExternalStore(never, passkeysSupported, cannot);
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
        setMessage(t("app.account.passkeys.added"));
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
      setMessage(t("app.account.passkeys.removed"));
      await refresh();
    } catch (err) {
      setError(passkeyErrorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="passkeys-title">
      <h2 id="passkeys-title" className="font-bold mb-2">{t("app.account.passkeys.title")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.passkeys.help")}</p>

      {passkeys && passkeys.length > 0 && (
        <ul className="mb-4 divide-y divide-vx-border rounded-xl border border-vx-border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{label(p)}</div>
                <div className="text-[12px] text-vx-fg-muted">{dates(p)}</div>
              </div>
              <button type="button" disabled={busy} className="text-sm underline disabled:opacity-50" onClick={() => setRemoving(p)}>{t("app.publish.smartlink.remove")}<span className="sr-only"> {label(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {passkeys && passkeys.length === 0 && <p className="mb-4 text-sm text-vx-fg-body">{t("app.account.passkeys.empty")}</p>}

      {canCreate ? (
        <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
          <label className="block text-sm">{t("app.account.passkeys.name")}<input
              value={name} onChange={(e) => setName(e.target.value)} maxLength={PASSKEY_NAME_MAX}
              placeholder={t("app.account.passkeys.example")} autoComplete="off"
              className="mt-1 block w-56 rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" disabled={busy} className={button}>{busy ? t("authGate.working") : t("app.account.passkeys.add")}</button>
        </form>
      ) : (
        <p className="text-sm text-vx-fg-body">{t("app.account.passkeys.unsupported")}</p>
      )}

      {message && <p role="status" className="mt-3 text-sm text-vx-accent">{message}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-vx-danger">
          {error} {passkeys === null && <button type="button" className="underline" onClick={() => { setError(''); refresh(); }}>{t("app.account.mfa.retry")}</button>}
        </p>
      )}

      {removing && (
        <ConfirmDialog
          title={t('app.account.passkeys.confirm', {name:label(removing)})}
          body={t("app.account.passkeys.body")}
          confirmLabel={t("app.account.passkeys.remove")}
          tone="danger"
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
