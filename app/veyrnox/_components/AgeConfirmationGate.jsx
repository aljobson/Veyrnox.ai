'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { MINIMUM_AGE, AGE_CONFIRMATION_VERSION } from '../../../lib/minimumAge';
import { getStoredUserId, onSessionChange, signOut } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { Modal } from './Modal';
import { DeleteAccountPanel } from './DeleteAccountPanel';

const account = () => getStoredUserId() || '';
const noAccount = () => '';
const subscribeReady = () => () => {};
const ready = () => true;
const notReady = () => false;
const button = 'min-h-13 rounded-xl border border-vx-border px-4 py-3 text-sm font-bold text-vx-fg focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-50';

export function AgeConfirmationGate({ enabled, deletionEnabled, children }) {
  return enabled ? <Gate deletionEnabled={deletionEnabled}>{children}</Gate> : children;
}

function Gate({ deletionEnabled, children }) {
  const hydrated = useSyncExternalStore(subscribeReady, ready, notReady);
  const id = useSyncExternalStore(onSessionChange, account, noAccount);
  if (!hydrated || !id) return children;
  return <Confirmation key={id} deletionEnabled={deletionEnabled}>{children}</Confirmation>;
}

function Confirmation({ deletionEnabled, children }) {
  const { t } = useI18n();
  const [state, setState] = useState('unknown');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialFocus = useRef(null);
  const live = useRef(true);
  const retryTimer = useRef(null);
  const retries = useRef(0);
  function retryRead() {
    if (!live.current || retries.current >= 3) return;
    const delay = 1000 * (2 ** retries.current++);
    retryTimer.current = setTimeout(check, delay);
  }
  async function check() {
    try {
      const result = await gatewayFetch('/account');
      if (!live.current) return;
      if (result.age_confirmation_required === true) { setState('ask'); return; }
      if (result.age_confirmation_required === false || result.age_confirmed === true) { setState('confirmed'); return; }
    } catch { /* Unknown status is not an affirmative requirement to block. */ }
    if (live.current) { setState('unknown'); retryRead(); }
  }
  useEffect(() => {
    live.current = true;
    check();
    return () => { live.current = false; clearTimeout(retryTimer.current); };
  }, []);
  async function confirm() {
    if (!checked || busy) return;
    setBusy(true); setError('');
    try {
      const result = await gatewayFetch('/account/age-confirmation', {
        method: 'POST', body: JSON.stringify({ confirm: true, version: AGE_CONFIRMATION_VERSION }),
      });
      if (result.age_confirmed !== true) throw new Error('unconfirmed');
      if (live.current) setState('confirmed');
    } catch (err) {
      if (live.current) {
        if (err?.code === 'account_not_found') { setChecked(false); setState('unknown'); retryRead(); }
        else setError(t('app.age.failed'));
      }
    }
    finally { if (live.current) setBusy(false); }
  }
  async function leave() {
    setBusy(true); setError('');
    try { await signOut(); }
    catch { if (live.current) { setError(t('app.age.failed')); setBusy(false); } }
  }
  if (state !== 'ask' && state !== 'declined') return children;
  return <Modal instant onCancel={() => {}} initialFocusRef={initialFocus} aria-labelledby="age-title" className="items-center justify-center p-4">
    <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-6">
      <h1 id="age-title" ref={initialFocus} tabIndex={-1} className="text-xl font-bold">{t('app.age.title')}</h1>
      {state === 'ask' && <>
        <label className="mt-4 flex min-h-12 items-center gap-3 text-vx-fg-body">
          <input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} className="size-6 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" />
          {t('app.age.confirm', { age: MINIMUM_AGE })}
        </label>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className={button} disabled={!checked || busy} onClick={confirm}>{t('app.age.continue')}</button>
          <button className={button} disabled={busy} onClick={() => setState('declined')}>{t('app.age.decline', { age: MINIMUM_AGE })}</button>
        </div>
      </>}
      {state === 'declined' && <div className="mt-4 space-y-4">
        <p>{t('app.age.declined')}</p>
        {deletionEnabled && <DeleteAccountPanel compact actionClassName={button} startLabel={t('app.age.delete')} />}
        <p>{t('app.age.contact')} <a className="inline-flex min-h-12 items-center underline focus-visible:outline-2 focus-visible:outline-vx-accent" href="mailto:privacy@veyrnox.com">{t("app.account.delete.email")}</a></p>
      </div>}
      {state === 'declined' && <button className={`${button} mt-4 w-full`} disabled={busy} onClick={leave}>{t('app.age.signOut')}</button>}
      {busy && <p role="status" className="mt-4">{t('app.age.saving')}</p>}
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}
    </div>
  </Modal>;
}
