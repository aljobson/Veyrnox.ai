'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { Modal } from './Modal';
import { gatewayFetch } from '../_lib/gateway';

export function CheckInDialog({ status, onClose, onClaim, onDisabled }) {
  const { t, locale } = useI18n();
  const closeRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const day = status.claimed_today ? Math.min(status.streak, 6) : status.next_day;
  async function claim() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await gatewayFetch('/checkin', { method: 'POST' });
      onClaim(result);
      window.dispatchEvent(new Event('veyrnox:balance-changed'));
    } catch (e) {
      if (e.status === 404 || (e.status === 403 && e.code === 'account_unavailable')) { onDisabled(); return; }
      setError(e.code === 'checkin_busy' ? t('checkin.busy') : t('checkin.error'));
    } finally { setBusy(false); }
  }
  const today = status.rewards[day - 1] ?? status.rewards.at(-1);
  return <Modal onCancel={onClose} initialFocusRef={closeRef} aria-labelledby="checkin-title" className="items-center justify-center p-4">
    <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl">
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t('checkin.close')}
        className="absolute end-4 top-4 grid size-11 place-items-center rounded-full bg-vx-fg/10 text-vx-fg-body hover:bg-vx-fg/20">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div className="flex items-start justify-between gap-4 pe-12">
        <div>
          <h2 id="checkin-title" className="text-2xl font-extrabold leading-tight">{t('checkin.title')}</h2>
          <p className="mt-3 text-base text-vx-fg-body">{t('checkin.copy')}</p>
        </div>
      <svg aria-hidden="true" viewBox="0 0 64 64" className="hidden size-16 shrink-0 text-vx-accent sm:block" fill="currentColor">
        <rect x="8" y="24" width="48" height="12" rx="3" opacity=".9" /><rect x="12" y="36" width="40" height="22" rx="3" opacity=".7" />
        <rect x="28" y="24" width="8" height="34" opacity=".5" />
        <path d="M32 24c-10 0-16-12-8-14 6-1 8 8 8 14zm0 0c10 0 16-12 8-14-6-1-8 8-8 14z" opacity=".9" />
      </svg>
      </div>
      <div data-testid="checkin-today" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-vx-border bg-vx-fg/5 px-4 text-base font-bold text-vx-accent">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
        {t(pluralKey(t, locale, 'checkin.credits', today), { credits: today })}
      </div>
      <ol className="my-6 flex justify-between gap-1">
        {status.rewards.map((credits, i) => {
          const current = day === i + 1, past = i + 1 < day;
          return <li key={i} aria-current={current ? 'step' : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span className={`relative grid size-10 place-items-center rounded-full border-2 text-base sm:size-12 sm:text-lg font-bold ${current ? 'border-vx-accent bg-vx-accent text-vx-accent-ink shadow-[0_0_24px_rgb(var(--vx-accent)/0.45)]' : past ? 'border-dashed border-vx-border text-vx-fg-muted' : 'border-vx-border bg-vx-fg/5 text-vx-fg-muted'}`}>
              {i + 1}
              {past && <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 size-3 rounded-full bg-vx-accent" />}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-vx-fg-muted">{i === 5 ? t('checkin.lastDay') : t('checkin.day', { day: i + 1 })}</span>
            <span className="text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'checkin.credits', credits), { credits })}</span>
            <span className="h-4">{status.claimed_today && current && <><span aria-hidden="true">✓</span><span className="sr-only">{t('checkin.claimed')}</span></>}</span>
          </li>;
        })}
      </ol>
      <p role="status" className="min-h-6 text-center text-sm">{error ? error : status.claimed_today ? t('checkin.claimed') : ''}</p>
      <button type="button" onClick={claim} disabled={busy || status.claimed_today} className="vx-press mt-2 min-h-14 w-full rounded-full bg-vx-accent px-6 text-lg font-bold text-vx-accent-ink shadow-lg disabled:opacity-50">
        {t(busy ? 'checkin.claiming' : status.claimed_today ? 'checkin.claimed' : 'checkin.claim')}
      </button>
      <div className="mt-5 border-t border-vx-border pt-4 text-center">
        <Link href="/app/credits" onClick={onClose} className="inline-flex min-h-11 items-center gap-3 text-base text-vx-fg-muted hover:text-vx-fg">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-vx-accent text-vx-accent-ink">↗</span>
          {t('app.create.addCredits')}<span aria-hidden="true">›</span>
        </Link>
      </div>
    </div>
  </Modal>;
}
