'use client';
import { useEffect, useId, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { useSwapDraft } from '../_lib/useSwapDraft.js';
import { swapActions } from '../_lib/templateSwapRuntime.js';
import { swapErrorKey, unsettled } from '../_lib/templateSwapClient.mjs';
import { useOnlineStatus } from '../_lib/useOnlineStatus.js';
import { swapControl } from './SwapAttemptStatus.js';
export function SwapComposer({ offer }) {
  const { t } = useI18n();
  const { attempts, accountId } = useSwapDraft(offer.id);
  const a = attempts.at(-1), online = useOnlineStatus(), field = useId();
  const busy = ['processing', 'uploading', 'submitting'].includes(a?.state);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => { clearTimeout(timer); setSlow(false); };
  }, [busy]);
  const ready = a?.files?.length === 2 && ['ready', 'not_charged', 'refunded', 'refund_pending', 'upload_error'].includes(a.state);
  const error = ['photo_error', 'upload_error'].includes(a?.state) ? t(swapErrorKey(a.errorCode)) : '';
  const canReplace = !busy && !attempts.some(item => unsettled(item));
  return <section aria-label={t('presets.swap.title')} className="mt-8 space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg" data-swap-composer>
    <h2 className="text-xl font-bold">{t('presets.swap.title')}</h2>
    <p>{t('presets.swap.role', { role: offer.role })}</p>
    <p>{t('presets.swap.scene')}</p>
    <p className="text-sm text-vx-fg-muted">{t('presets.swap.rights')}</p>
    <div className="flex flex-wrap gap-4 text-sm"><a className={swapControl} href="/legal/terms">{t('presets.swap.terms')}</a><a className={swapControl} href="/legal/aup">{t('presets.swap.aup')}</a></div>
    <p className="text-sm text-vx-fg-muted">{t('presets.swap.privacy')}</p>
    <fieldset className="space-y-4 rounded-2xl border border-vx-border p-4">
      <legend className="px-2 font-bold">{t('presets.swap.photo')}</legend>
      <p id={`${field}-help`} className="text-sm text-vx-fg-muted">{t('presets.swap.guidance')}</p>
      <label className={`${swapControl} relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-vx-accent`}>
        {t(a?.files ? 'presets.swap.replace' : 'presets.swap.choose')}
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={t('presets.swap.photo')} aria-describedby={`${field}-help ${field}-error`} disabled={!accountId || !canReplace}
          className="absolute inset-0 h-full w-full opacity-0 focus-visible:outline-2 focus-visible:outline-vx-accent"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void swapActions.choose(offer.id, file); }} />
      </label>
      <p id={`${field}-error`} role={error ? 'alert' : undefined} className="text-sm text-vx-danger">{error}</p>
      {a?.urls && <div className="grid grid-cols-2 gap-4">{a.urls.map((src, i) => <figure key={src} className="min-w-0">
        {/* Local object URLs only; nothing leaves the device before Generate. */}
        <img src={src} alt={t(i ? 'presets.swap.crop' : 'presets.swap.frontal')} className="w-full rounded-xl" />
        <figcaption className="mt-2 text-sm">{t(i ? 'presets.swap.crop' : 'presets.swap.frontal')}</figcaption>
      </figure>)}</div>}
      {busy && <p role="status">{t(a.state === 'processing' ? 'presets.swap.processing' : 'presets.swap.sending')}{slow ? ` ${t('presets.swap.slow')}` : ''}</p>}
      {a && !a.body && <button className={swapControl} onClick={() => swapActions.cancel(a.key)}>{t('presets.swap.cancel')}</button>}
      {a?.state === 'photo_error' && a.photo && <button className={swapControl} onClick={() => void swapActions.choose(offer.id, a.photo)}>{t('presets.swap.retry')}</button>}
    </fieldset>
    {!online && <p role="status">{t('presets.swap.offline')}</p>}
    {!accountId && <p role="status">{t('presets.swap.session')} <button className={swapControl} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t('presets.swap.signin')}</button></p>}
    {!offer.name && <p role="status">{t('presets.swap.loading')}</p>}
    <p className="text-vx-money">{t('presets.swap.price', { credits: offer.credits })}</p>
    <button className={`${swapControl} min-h-13 border-vx-accent bg-vx-accent text-vx-accent-ink`} disabled={!accountId || !offer.name || !ready || busy || !online}
      onClick={() => void swapActions.submit(offer.id, offer)}>{t('presets.swap.generate')}</button>
  </section>;
}
