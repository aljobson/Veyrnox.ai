'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { useSwapDraft } from '../_lib/useSwapDraft.js';
import { swapActions } from '../_lib/templateSwapRuntime.js';
import { swapErrorKey, unsettled, swapImageCounts, swapFullBody } from '../_lib/templateSwapClient.mjs';
import { useOnlineStatus } from '../_lib/useOnlineStatus.js';
import { swapControl } from './SwapAttemptStatus.js';
import { TemplatePhotoExample } from './TemplatePhotoExample.js';
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
  const people = offer.people === 2 ? 2 : 1;
  const fullBody = swapFullBody(offer), captions = ['presets.swap.face', 'presets.swap.crop', 'presets.swap.fullBody'];
  const ready = swapImageCounts(offer).includes(a?.files?.length) && ['ready', 'not_charged', 'refunded', 'refund_pending', 'upload_error'].includes(a.state);
  const error = a?.state === 'photo_error' ? t(swapErrorKey(a.errorCode)) : '';
  const canReplace = !busy && !attempts.some(item => unsettled(item));
  const feedback = useRef(null), sending = ['uploading', 'submitting'].includes(a?.state), uploadError = a?.state === 'upload_error';
  // Only this tap moves the page: restored attempts and background updates never scroll.
  const reveal = useRef(false);
  useEffect(() => () => { reveal.current = false; }, [accountId, offer.id]);
  useEffect(() => {
    if (!reveal.current || !a) return;
    const show = node => node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    if (sending || uploadError) { show(feedback.current); if (uploadError) reveal.current = false; return; }
    if (a.body) { show(document.querySelector(`[data-swap-attempt-key="${CSS.escape(a.key)}"]`)); reveal.current = false; }
  }, [a, sending, uploadError]);
  return <section aria-label={t('presets.swap.title')} className="mt-8 space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg" data-swap-composer>
    <h2 className="text-xl font-bold">{t('presets.swap.title')}</h2>
    <p>{people === 2 ? t('presets.swap.roles', { first: offer.roles[0], second: offer.roles[1] }) : t('presets.swap.role', { role: offer.role })}</p>
    <p>{t('presets.swap.scene')}</p>
    <p className="text-sm text-vx-fg-muted">{t('presets.swap.rights')}</p>
    <div className="flex flex-wrap gap-4 text-sm"><a className={swapControl} href="/legal/terms">{t('presets.swap.terms')}</a><a className={swapControl} href="/legal/aup">{t('presets.swap.aup')}</a></div>
    <p className="text-sm text-vx-fg-muted">{t('presets.swap.privacy')}</p>
    {Array.from({ length: people }, (_, person) => {
      const mine = fullBody ? a?.urls : a?.urls?.slice(person * 2, person * 2 + 2), label = people === 2 ? t('presets.swap.personPhoto', { role: offer.roles[person] }) : t('presets.swap.photo');
      const locked = person === 1 && !a?.files, showError = error && (people === 1 || (a?.photoPerson ?? 0) === person);
      return <fieldset key={person} className="space-y-4 rounded-2xl border border-vx-border p-4">
        <legend className="px-2 font-bold">{label}</legend>
        <p id={`${field}-help${person}`} className="text-sm text-vx-fg-muted">{t(people === 2 ? 'presets.swap.twoGuidance' : fullBody ? 'presets.swap.fullBodyGuidance' : 'presets.swap.guidance')}</p>
        <TemplatePhotoExample kind={fullBody ? 'fullBody' : 'face'} limits="swap" />
        <label className={`${swapControl} relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-vx-accent`}>
          {t(mine?.length ? 'presets.swap.replace' : 'presets.swap.choose')}
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={label} aria-describedby={`${field}-help${person} ${field}-error${person}`} disabled={!accountId || !canReplace || locked}
            className="absolute inset-0 h-full w-full opacity-0 focus-visible:outline-2 focus-visible:outline-vx-accent"
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void swapActions.choose(offer.id, file, person, { fullBody }); }} />
        </label>
        <p id={`${field}-error${person}`} role={showError ? 'alert' : undefined} className="text-sm text-vx-danger">{showError ? error : ''}</p>
        {(mine?.length === 2 || mine?.length === 3) && <div className={`grid gap-4 ${mine.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{mine.map((src, i) => <figure key={src} className="min-w-0">
          {/* Local object URLs only; nothing leaves the device before Generate. */}
          <img src={src} alt={t(mine.length === 3 ? captions[i] : i ? 'presets.swap.crop' : 'presets.swap.frontal')} className="w-full rounded-xl" />
          <figcaption className="mt-2 text-sm">{t(mine.length === 3 ? captions[i] : i ? 'presets.swap.crop' : 'presets.swap.frontal')}</figcaption>
        </figure>)}</div>}
        {person === people - 1 && <>
          {a?.state === 'processing' && <p role="status">{t('presets.swap.processing')}{slow ? ` ${t('presets.swap.slow')}` : ''}</p>}
          {a && !a.body && <button className={swapControl} onClick={() => swapActions.cancel(a.key)}>{t('presets.swap.cancel')}</button>}
          {a?.state === 'photo_error' && a.photo && <button className={swapControl} onClick={() => void swapActions.choose(offer.id, a.photo, a.photoPerson ?? 0, { fullBody })}>{t('presets.swap.retry')}</button>}
        </>}
      </fieldset>;
    })}
    {!online && <p role="status">{t('presets.swap.offline')}</p>}
    {!accountId && <p role="status">{t('presets.swap.session')} <button className={swapControl} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t('presets.swap.signin')}</button></p>}
    {!offer.name && <p role="status">{t('presets.swap.loading')}</p>}
    <p className="text-vx-money">{t('presets.swap.price', { credits: offer.credits })}</p>
    <button className={`${swapControl} min-h-13 border-vx-accent bg-vx-accent text-vx-accent-ink`} disabled={!accountId || !offer.name || !ready || busy || !online}
      onClick={() => {
        if (sending) return;
        reveal.current = true;
        void Promise.resolve(swapActions.submit(offer.id, offer)).catch(() => { reveal.current = false; });
      }}>{t('presets.swap.generate')}</button>
    {sending && <p ref={feedback} role="status" data-swap-feedback>{t('presets.swap.sending')}{slow ? ` ${t('presets.swap.slow')}` : ''}</p>}
    {uploadError && <p ref={feedback} role="alert" className="text-sm text-vx-danger" data-swap-feedback>{t(swapErrorKey(a.errorCode))}</p>}
  </section>;
}
