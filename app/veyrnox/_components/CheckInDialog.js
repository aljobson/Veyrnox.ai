'use client';
import { useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { Modal } from './Modal';
import { gatewayFetch } from '../_lib/gateway';

export function CheckInDialog({ status, onClose, onClaim, onDisabled }) {
  const { t, locale } = useI18n();
  const closeRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [earned, setEarned] = useState(null);
  const day = status.claimed_today ? Math.min(status.streak, 6) : status.next_day;
  async function claim() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await gatewayFetch('/checkin', { method: 'POST' });
      setEarned(result.credits);
      onClaim(result);
      window.dispatchEvent(new Event('veyrnox:balance-changed'));
    } catch (e) {
      if (e.status === 404 || (e.status === 403 && e.code === 'account_unavailable')) { onDisabled(); return; }
      setError(e.code === 'checkin_busy' ? t('checkin.busy') : t('checkin.error'));
    } finally { setBusy(false); }
  }
  return <Modal onCancel={onClose} initialFocusRef={closeRef} aria-labelledby="checkin-title" className="items-center justify-center p-4">
    <div className="w-full max-w-md rounded-2xl border border-vx-border bg-vx-panel p-6">
      <h2 id="checkin-title" className="text-xl font-bold">{t('checkin.title')}</h2>
      <p className="mt-3 text-sm text-vx-fg-body">{t('checkin.copy')}</p>
      <div className="my-5 grid grid-cols-3 gap-3">
        {status.rewards.map((credits, i) => <div key={i} aria-current={day === i + 1 ? 'step' : undefined}
          className={`rounded-xl border p-3 text-center ${day === i + 1 ? 'border-vx-accent bg-vx-accent/10' : 'border-vx-border'} ${i + 1 < day ? 'opacity-50' : ''}`}>
          <div className="text-xs">{i === 5 ? t('checkin.lastDay') : t('checkin.day', { day: i + 1 })}</div>
          <div className="mt-2 font-bold">{t(pluralKey(t, locale, 'checkin.credits', credits), { credits })}</div>
          <div className="h-5">
            {status.claimed_today && day === i + 1 && <><span aria-hidden="true">✓</span><span className="sr-only">{t('checkin.claimed')}</span></>}
          </div>
        </div>)}
      </div>
      <p role="status" className="min-h-12 text-sm">{error ? error : earned > 0 ? t(pluralKey(t, locale, 'checkin.earned', earned), { credits: earned }) : status.claimed_today ? t('checkin.claimed') : ''}</p>
      <div className="flex justify-end gap-3">
        <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-full border border-vx-border px-4">{t('checkin.close')}</button>
        <button type="button" onClick={claim} disabled={busy || status.claimed_today} className="min-h-11 rounded-full bg-vx-accent px-4 font-bold text-vx-accent-ink disabled:opacity-50">
          {t(busy ? 'checkin.claiming' : status.claimed_today ? 'checkin.claimed' : 'checkin.claim')}
        </button>
      </div>
    </div>
  </Modal>;
}
