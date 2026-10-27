'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../_lib/gateway';
import { generationFileProblem, generationFileType } from '../_lib/editorGenerationUploads.mjs';
import { useCatalog } from '../_lib/useCatalog';
import { pushJobHistory } from '../_lib/jobHistory';
import { motionTemplateQuote, visibleMotionTemplates } from '../_lib/motionTransferTemplates';
import SourceRightsConfirmation from './SourceRightsConfirmation';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';
const label = 'font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent';

/** Server error code -> what the person sees. */
function errorMessage(error, t) {
  const code = error && error.code;
  if (code === 'insufficient_balance') return t('app.motion.error.credits');
  if (code === 'credit_confirmation_mismatch') return t('app.motion.error.price');
  return t('app.motion.error.start');
}

/**
 * Motion templates (ADR-0269): pick a movement, add one photo, start. The
 * server picks the clip and charges the catalog price for its length; the
 * shown price is sent back as confirmed_credits so it can never differ.
 */
export default function MotionTemplateStudio({ modes, readyIds }) {
  const { t } = useI18n();
  const catalog = useCatalog();
  const templates = useMemo(() => visibleMotionTemplates(modes, readyIds), [modes, readyIds]);
  const [selectedId, setSelectedId] = useState(() => (templates.find(x => x.ready) || templates[0])?.id || null);
  const [photo, setPhoto] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  // One attempt = one idempotency key, one uploaded photo and one price. A retry reuses all three, so a
  // lost answer can never start a second job or replay the key with a different body.
  const attempt = useRef(null);
  const inflight = useRef(false);
  const libraryLink = useRef(null);
  const selected = templates.find(x => x.id === selectedId) || null;
  const model = selected && catalog.live ? catalog.models.find(m => m.id === selected.model) : null;
  const quote = selected && model ? motionTemplateQuote(selected, model.credits) : null;

  useEffect(() => () => { if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl); }, [photo]);
  useEffect(() => { if (started) libraryLink.current?.focus(); }, [started]);

  function reset() {
    attempt.current = null;
    setStarted(false);
    setError('');
  }

  function choose(id) {
    if (inflight.current) return;
    setSelectedId(id);
    reset();
  }

  function pickPhoto(input) {
    const file = input.files?.[0] || null;
    // Cleared so choosing the same file again still fires a change.
    input.value = '';
    if (inflight.current) return;
    reset();
    setConsent(false);
    if (!file) { setPhoto(null); return; }
    if (generationFileProblem('image', file)) { setPhoto(null); setError(t('app.motion.error.photo')); return; }
    setPhoto({ file, previewUrl: URL.createObjectURL(file), mimeType: generationFileType(file) });
  }

  async function start() {
    if (inflight.current || !selected?.ready || !quote) return;
    if (!photo) { setError(t('app.motion.error.photo')); return; }
    if (!consent) { setError(t('app.motion.error.consent')); return; }
    inflight.current = true;
    setBusy(true);
    setError('');
    // A new price is a new request: never replay a key with a different confirmed_credits.
    if (!attempt.current || attempt.current.quote !== quote) attempt.current = { key: makeIdempotencyKey(), quote, sourceKey: null };
    const current = attempt.current;
    try {
      if (!current.sourceKey) {
        try {
          const signed = await gatewayFetch('/uploads', { method: 'POST', body: JSON.stringify({ content_type: photo.mimeType, size_bytes: photo.file.size }) });
          const put = await fetch(signed.upload_url, { method: 'PUT', headers: signed.headers || { 'Content-Type': signed.content_type }, body: photo.file });
          if (!put.ok) throw new Error('upload_failed');
          current.sourceKey = signed.key;
        } catch {
          setError(t('app.motion.error.upload'));
          return;
        }
      }
      const submitted = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({
          model_id: selected.model,
          idempotency_key: current.key,
          inputs: { motion_template: selected.drivingClip },
          references: [{ origin: 'upload', key: current.sourceKey, slot: 'image' }],
          consent: true,
          confirmed_credits: current.quote,
        }),
      });
      const title = t(`app.motion.template.${selected.id}.title`);
      pushJobHistory({ job_id: submitted.job_id, model_id: selected.model, credits: current.quote, prompt: title, name: title });
      notifyBalanceChanged();
      setStarted(true);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <header className={`${card} p-6 sm:p-8`}>
          <p className={label}>{t('app.motion.kicker')}</p>
          <h1 className="vx-display mt-4 text-[42px] leading-[0.95] sm:text-[58px]">{t('app.motion.title')}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-vx-fg-muted">{t('app.motion.lead')}</p>
        </header>
        <section className={`${card} p-5 sm:p-6`} aria-labelledby="motion-pick">
          <h2 id="motion-pick" className="text-xl font-black">{t('app.motion.pick')}</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {templates.map((item) => {
              const active = item.id === selectedId;
              return <li key={item.id}>
                <button type="button" data-testid={`motion-template-${item.id}`} aria-pressed={active} disabled={busy} onClick={() => choose(item.id)}
                  className={`flex h-full min-h-11 w-full flex-col overflow-hidden rounded-xl border text-left ${active ? 'border-vx-accent' : 'border-vx-field'} bg-vx-base focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-55`}>
                  <span className="relative block aspect-[9/16] w-full bg-vx-panel">
                    {item.ready && <img loading="lazy" src={item.preview.poster} alt={t('app.motion.previewAlt', { title: t(`app.motion.template.${item.id}.title`) })} className="h-full w-full object-cover" />}
                    {!item.ready && <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs font-bold text-vx-fg-faint">{t('app.motion.notReady')}</span>}
                  </span>
                  <span className="block p-3">
                    <span className="block text-sm font-black">{t(`app.motion.template.${item.id}.title`)}</span>
                    <span className="mt-1 block text-xs leading-5 text-vx-fg-muted">{t(`app.motion.template.${item.id}.blurb`)}</span>
                    <span className="mt-2 block font-vx-mono text-[10px] text-vx-fg-faint">{t(item.model === 'motion-replace' ? 'app.motion.mode.replace' : 'app.motion.mode.move')} · {t('app.motion.seconds', { seconds: item.seconds })}</span>
                  </span>
                </button>
              </li>;
            })}
          </ul>
        </section>
      </div>
      {selected && <aside className={`${card} space-y-4 p-5 sm:p-6 xl:sticky xl:top-24`} aria-labelledby="motion-photo">
        <h2 id="motion-photo" className="text-xl font-black">{t('app.motion.photo.title')}</h2>
        <p className="text-xs leading-5 text-vx-fg-muted">{t(selected.model === 'motion-replace' ? 'app.motion.photo.helpReplace' : 'app.motion.photo.help')}</p>
        {photo && <img src={photo.previewUrl} alt={t('app.motion.photo.alt')} className="max-h-72 w-full rounded-xl bg-black object-contain" />}
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-vx-accent px-5 text-xs font-black text-vx-accent hover:bg-vx-accent/10 focus-within:ring-2 focus-within:ring-vx-accent">
          {t(photo ? 'app.motion.photo.change' : 'app.motion.photo.choose')}
          <input data-testid="motion-photo-input" type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy} onChange={(event) => pickPhoto(event.target)} />
        </label>
        {photo && <SourceRightsConfirmation confirmed={consent} onChange={(value) => { setConsent(value); setError(''); }} />}
        {selected.model === 'motion-replace' && <p className="text-xs font-bold text-vx-fg-muted">{t('app.motion.replaceWait')}</p>}
        <p data-testid="motion-price" className="text-sm font-black">{quote ? t('app.motion.price', { credits: quote }) : t('app.motion.priceUnavailable')}</p>
        {error && <p role="alert" className="text-xs font-bold text-vx-danger">{error}</p>}
        <div role="status" aria-live="polite" className="space-y-3">
          {started && <><p className="text-sm">{t('app.motion.started')}</p><a ref={libraryLink} href="/app/library" className="inline-flex min-h-11 items-center text-sm font-black text-vx-accent underline underline-offset-4">{t('app.motion.library')}</a></>}
        </div>
        {!started && <button type="button" data-testid="motion-start" onClick={start} disabled={!selected.ready || !quote || busy}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-vx-accent px-5 text-sm font-black text-vx-on-accent disabled:cursor-not-allowed disabled:opacity-55">
          {t(busy ? 'app.motion.starting' : 'app.motion.start')}
        </button>}
      </aside>}
    </div>
  );
}
