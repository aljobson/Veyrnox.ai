'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider';
import { writeStudioDraft } from '../_lib/landingDraft';
import { creativeFeatureExample, creativeFeatureExampleAssetPath, translatedCreativeFeature } from '../_lib/creativeFeatures';
import { gatewayFetch } from '../_lib/gateway';
import { generationFileProblem, generationFileType } from '../_lib/editorGenerationUploads.mjs';
import { readCreativeScriptFile } from '../_lib/creativeScriptUpload.mjs';
import { SourcePickers } from './SourcePickers';
import SourceRightsConfirmation from './SourceRightsConfirmation';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';

export default function CreativeFeatureStudio({ feature }) {
  const router = useRouter();
  const { t } = useI18n();
  const copy = translatedCreativeFeature(feature, t);
  const example = creativeFeatureExample(feature.slug);
  const exampleAsset = creativeFeatureExampleAssetPath(feature.slug);
  const [brief, setBrief] = useState('');
  const [sources, setSources] = useState({});
  const [scriptSource, setScriptSource] = useState(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');
  const objectUrls = useRef(new Set());
  const prompt = `${copy.prompt}${brief.trim()}`.trim();
  const media = useMemo(() => Object.fromEntries(feature.media.map((slot) => [slot, { required: true }])), [feature.media]);
  const hasUpload = feature.media.length > 0 || feature.scriptUpload;

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  function pickSource(slot, file) {
    if (file) {
      const problem = generationFileProblem(slot, file);
      if (problem) {
        setError(t('app.features.error.file'));
        return;
      }
    }
    setSources((previous) => {
      const prior = previous[slot];
      if (prior?.previewUrl) {
        URL.revokeObjectURL(prior.previewUrl);
        objectUrls.current.delete(prior.previewUrl);
      }
      const next = { ...previous };
      if (file) {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.add(previewUrl);
        next[slot] = { file, previewUrl, label: file.name, mimeType: generationFileType(file) };
      } else delete next[slot];
      return next;
    });
    setConsent(false);
    setError('');
  }

  async function pickScript(file) {
    if (!file) {
      setScriptSource(null);
      setBrief('');
      setConsent(false);
      setError('');
      return;
    }
    const result = await readCreativeScriptFile(file);
    if (result.problem) {
      setScriptSource(null);
      setConsent(false);
      setError(t(`app.features.error.script.${result.problem}`));
      return;
    }
    setScriptSource({ name: file.name, size: file.size });
    setBrief(result.text);
    setConsent(false);
    setError('');
  }

  async function uploadSource(slot, source, index) {
    setUploadProgress(t('app.features.uploading', { current: index + 1, total: feature.media.length }));
    const signed = await gatewayFetch('/uploads', {
      method: 'POST',
      body: JSON.stringify({ content_type: source.mimeType, size_bytes: source.file.size }),
    });
    const response = await fetch(signed.upload_url, {
      method: 'PUT',
      headers: signed.headers || { 'Content-Type': signed.content_type },
      body: source.file,
    });
    if (!response.ok) throw new Error('upload_failed');
    return [slot, { sourceKey: signed.key, label: source.label, mimeType: source.mimeType }];
  }

  async function launch() {
    if (feature.blocked) return;
    if (!brief.trim() && feature.input !== 'Production note') {
      setError(t('app.features.error.required', { input: copy.input.toLowerCase() }));
      return;
    }
    if (feature.scriptUpload && !scriptSource) {
      setError(t('app.features.error.script.required'));
      return;
    }
    if (feature.media.some((slot) => !sources[slot]?.file)) {
      setError(t('app.features.error.sources'));
      return;
    }
    if (hasUpload && !consent) {
      setError(t('app.features.error.consent'));
      return;
    }
    setUploading(true);
    setError('');
    let uploadedSources = {};
    try {
      const uploaded = [];
      for (let index = 0; index < feature.media.length; index += 1) {
        const slot = feature.media[index];
        uploaded.push(await uploadSource(slot, sources[slot], index));
      }
      uploadedSources = Object.fromEntries(uploaded);
    } catch {
      setError(t('app.features.error.upload'));
      setUploading(false);
      setUploadProgress('');
      return;
    }
    if (!writeStudioDraft(window.sessionStorage, {
      prompt: prompt || t('app.features.defaultPrompt', { title: copy.title.toLowerCase() }),
      model: feature.model,
      aspect: feature.kind === 'video' ? '9:16' : '1:1',
      durationSeconds: feature.kind === 'video' ? 5 : undefined,
      sources: uploadedSources,
      consent: hasUpload ? true : undefined,
    })) {
      setError(t('app.features.error.handoff'));
      setUploading(false);
      setUploadProgress('');
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

        {example && <section className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <div><p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.features.example')}</p><h2 className="mt-1 text-xl font-black">{t('app.features.exampleTitle')}</h2></div>
            <a href={example.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-vx-accent underline underline-offset-4">{t('app.features.exampleSource')}</a>
          </div>
          {example.kind === 'video'
            ? <video controls playsInline preload="metadata" referrerPolicy="no-referrer" src={exampleAsset} className="aspect-video w-full bg-black object-contain" aria-label={t('app.features.exampleAria', { title: copy.title })} />
            : <img loading="lazy" referrerPolicy="no-referrer" src={exampleAsset} alt={t('app.features.exampleAria', { title: copy.title })} className="max-h-[520px] w-full bg-black object-contain" />}
          <p className="px-5 py-3 text-[11px] leading-4 text-vx-fg-faint sm:px-6">{t('app.features.exampleNote')}</p>
        </section>}

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
          {feature.media.length > 0 && <SourcePickers media={media} sources={sources} onPick={pickSource} onDraw={null} onLibrary={null} />}
          {feature.scriptUpload && <div className="mt-4 rounded-xl border border-vx-field bg-vx-base p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black">{t('app.features.scriptUpload')}</p>
                <p className="mt-1 text-xs leading-5 text-vx-fg-muted">{t('app.features.scriptUploadHelp')}</p>
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-vx-accent px-5 text-xs font-black text-vx-accent hover:bg-vx-accent/10">
                {scriptSource ? t('app.features.scriptReplace') : t('app.features.scriptChoose')}
                <input data-testid="source-upload-script" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="sr-only" onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  event.currentTarget.value = '';
                  void pickScript(file);
                }} />
              </label>
            </div>
            {scriptSource && <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-vx-border px-3 py-2">
              <span className="min-w-0 truncate text-xs font-bold">{scriptSource.name}</span>
              <button type="button" onClick={() => { void pickScript(null); }} className="shrink-0 text-xs font-bold text-vx-danger underline underline-offset-4">{t('app.features.scriptRemove')}</button>
            </div>}
          </div>}
          {hasUpload && <SourceRightsConfirmation confirmed={consent} onChange={(value) => { setConsent(value); setError(''); }} />}
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
          {feature.blocked ? <><p className="text-sm font-black text-vx-danger">{t('app.features.safeguard')}</p><p className="mt-2 text-xs leading-5 text-vx-fg-muted">{copy.blockedReason}</p><Link href="/app/features/text-to-speech" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-vx-accent px-5 text-sm font-black text-vx-accent">{t('app.features.useTts')}</Link></> : <><p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-fg-muted">{t('app.features.liveModel')}</p><p className="mt-2 text-sm font-black">{feature.model}</p>{error && <p role="alert" className="mt-4 rounded-xl border border-vx-danger/35 bg-vx-danger/[0.06] px-4 py-3 text-xs leading-5 text-vx-danger">{error}</p>}{uploadProgress && <p role="status" className="mt-4 text-xs font-bold text-vx-accent">{uploadProgress}</p>}<button type="button" disabled={uploading} onClick={launch} className="mt-5 min-h-12 w-full rounded-full bg-vx-accent px-5 text-sm font-black text-vx-accent-ink hover:bg-vx-accent-hover disabled:cursor-wait disabled:opacity-60">{uploading ? t('app.features.uploadingAction') : t('app.features.continue')}</button><p className="mt-3 text-center text-[11px] leading-4 text-vx-fg-faint">{t('app.features.finalReview')}</p></>}
        </section>

        <Link href="/app/features" className="block text-center text-xs font-bold text-vx-accent underline underline-offset-4">{t('app.features.browse')}</Link>
      </aside>
    </div>
  );
}
