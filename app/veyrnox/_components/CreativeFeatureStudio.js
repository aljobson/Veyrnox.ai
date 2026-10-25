'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider';
import { writeStudioDraft } from '../_lib/landingDraft';
import { translatedCreativeFeature } from '../_lib/creativeFeatures';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';

export default function CreativeFeatureStudio({ feature }) {
  const router = useRouter();
  const { t } = useI18n();
  const copy = translatedCreativeFeature(feature, t);
  const [brief, setBrief] = useState('');
  const [error, setError] = useState('');
  const prompt = `${copy.prompt}${brief.trim()}`.trim();

  function launch() {
    if (feature.blocked) return;
    if (!brief.trim() && feature.input !== 'Production note') {
      setError(t('app.features.error.required', { input: copy.input.toLowerCase() }));
      return;
    }
    if (!writeStudioDraft(window.sessionStorage, {
      prompt: prompt || t('app.features.defaultPrompt', { title: copy.title.toLowerCase() }),
      model: feature.model,
      aspect: feature.kind === 'video' ? '9:16' : '1:1',
      durationSeconds: feature.kind === 'video' ? 5 : undefined,
    })) {
      setError(t('app.features.error.handoff'));
      return;
    }
    router.push(`/app/create?model=${encodeURIComponent(feature.model)}&recipe=${encodeURIComponent(feature.slug)}`);
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <header className={`${card} p-6 sm:p-8`}>
          <div className="flex flex-wrap items-center gap-2 font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">
            <span>{copy.group}</span><span aria-hidden="true">·</span><span>{feature.kind}</span>
          </div>
          <h1 className="vx-display mt-4 text-[42px] leading-[0.95] sm:text-[58px]">{copy.title}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-vx-fg-muted">{t('app.features.guide')}</p>
        </header>

        <section className={`${card} p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-4">
            <div><p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.features.brief')}</p><h2 className="mt-1 text-xl font-black">{copy.input}</h2></div>
            <span className="font-vx-mono text-[10px] text-vx-fg-faint">{brief.length}/1000</span>
          </div>
          <textarea disabled={feature.blocked} value={brief} maxLength={1000} rows={7} onChange={(event) => { setBrief(event.target.value); setError(''); }} placeholder={copy.placeholder} aria-label={copy.input} className="mt-4 w-full resize-y rounded-xl border border-vx-field bg-vx-base px-4 py-3 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-55" />
        </section>

        <section className={`${card} p-5 sm:p-6`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.features.sources')}</p>
          <h2 className="mt-1 text-xl font-black">{t('app.features.sourcesTitle')}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {feature.media.length ? feature.media.map((item) => <span key={item} className="rounded-full border border-vx-border bg-vx-base px-3 py-2 text-xs font-bold capitalize">{t('app.features.uploadRequired', { type: item })}</span>) : <span className="rounded-full border border-vx-border bg-vx-base px-3 py-2 text-xs font-bold">{t('app.features.noUpload')}</span>}
          </div>
          <p className="mt-4 text-xs leading-5 text-vx-fg-muted">{t('app.features.uploadSafety')}</p>
        </section>
      </div>

      <aside className="space-y-5 xl:sticky xl:top-24">
        <section className={`${card} p-5`}>
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.features.workflow')}</p>
          <ol className="mt-4 space-y-4">
            {copy.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-5"><span className="font-vx-mono text-xs font-bold text-vx-accent">0{index + 1}</span><span>{step}</span></li>)}
          </ol>
        </section>

        <section className={`${card} p-5`}>
          {feature.blocked ? <><p className="text-sm font-black text-vx-danger">{t('app.features.safeguard')}</p><p className="mt-2 text-xs leading-5 text-vx-fg-muted">{copy.blockedReason}</p><Link href="/app/features/text-to-speech" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-vx-accent px-5 text-sm font-black text-vx-accent">{t('app.features.useTts')}</Link></> : <><p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-fg-muted">{t('app.features.liveModel')}</p><p className="mt-2 text-sm font-black">{feature.model}</p>{error && <p role="alert" className="mt-4 rounded-xl border border-vx-danger/35 bg-vx-danger/[0.06] px-4 py-3 text-xs leading-5 text-vx-danger">{error}</p>}<button type="button" onClick={launch} className="mt-5 min-h-12 w-full rounded-full bg-vx-accent px-5 text-sm font-black text-vx-accent-ink hover:bg-vx-accent-hover">{t('app.features.continue')}</button><p className="mt-3 text-center text-[11px] leading-4 text-vx-fg-faint">{t('app.features.finalReview')}</p></>}
        </section>

        <Link href="/app/features" className="block text-center text-xs font-bold text-vx-accent underline underline-offset-4">{t('app.features.browse')}</Link>
      </aside>
    </div>
  );
}
