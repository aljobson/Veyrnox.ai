'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { writeStudioDraft } from '../_lib/landingDraft.js';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../_lib/gateway.js';
import { uploadSourceFile } from '../_lib/uploadSourceFile.js';
import {
  MUSIC_SAMPLE_PREVIEW_SECONDS,
  scheduleMusicSamplePreview,
} from '../_lib/music/samplePreview.js';

const PROVIDERS = [
  { id: 'kling', labelKey: 'app.templates.provider.kling', detailKey: 'app.templates.provider.klingDetail' },
  { id: 'seedance', labelKey: 'app.templates.provider.seedance', detailKey: 'app.templates.provider.seedanceDetail' },
  { id: 'vidu', labelKey: 'app.templates.provider.vidu', detailKey: 'app.templates.provider.viduDetail' },
  { id: 'veo', labelKey: 'app.templates.provider.veo', detailKey: 'app.templates.provider.veoDetail' },
  { id: 'suno', labelKey: 'app.templates.provider.suno', detailKey: 'app.templates.provider.sunoDetail' },
];

const CRUN_PROVIDERS = Object.freeze(['kling', 'seedance', 'vidu']);
const EMPTY_TEMPLATES = Object.freeze([]);

const DEFAULT_MUSIC_MIX = Object.freeze({ tempo: 1, drums: 100, bass: 100, melody: 100 });

const includesQuery = (item, query) => !query || [item.name, item.category, item.model, item.tag, ...(item.tags || [])]
  .filter(Boolean).join(' ').toLocaleLowerCase().includes(query);

function Empty({ query, t }) {
  return <p className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">{t('app.templates.empty', { query })}</p>;
}

function ReadyCard({ item, badge, t }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top_left,var(--color-vx-accent),transparent_58%),linear-gradient(145deg,#0d1824,#152d3f)]">
        {item.video ? (
          <video src={item.video} poster={item.poster || undefined} controls playsInline preload="none" aria-label={t('app.templates.previewLabel', { name: item.name })} className="h-full w-full object-cover">
            {t('app.templates.videoFallback')}
          </video>
        ) : item.poster ? <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
        <span className="absolute start-3 top-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">{badge}</span>
      </div>
      <div className="p-4">
        <h3 className="text-base font-black">{item.name}</h3>
        <p className="mt-1 text-xs text-vx-fg-muted">{item.category} · {item.model}{item.durationSeconds ? ` · ${item.durationSeconds}s` : ''}</p>
        <Link href={`/presets/${encodeURIComponent(item.id)}`} className="vx-press mt-4 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">{t('app.templates.openTemplate')}</Link>
      </div>
    </li>
  );
}

function ProviderCard({ item, providerId, provider, t }) {
  const [previewing, setPreviewing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const input = item.maxInputCount === 0 ? t('app.templates.image.none')
    : item.minInputCount !== item.maxInputCount ? t('app.templates.image.range', { min: item.minInputCount, max: item.maxInputCount })
      : item.inputCount ? t(item.inputCount === 1 ? 'app.templates.image.one' : 'app.templates.image.other', { count: item.inputCount }) : item.inputRequirement;
  const price = item.prices?.length ? item.prices.map(entry => `${entry.resolution} · ${entry.credits}`).join(' / ')
    : Number.isInteger(item.credits) ? `${item.credits}` : null;
  const hasVideo = item.previewKind === 'video' && item.previewUrl;
  const stillPreview = item.coverUrl || (item.previewKind === 'image' ? item.previewUrl : null);
  return (
    <li className="flex min-h-64 flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div className="relative aspect-[4/3] overflow-hidden bg-vx-base">
        {previewing && hasVideo && !previewFailed ? (
          <video src={item.previewUrl} poster={item.coverUrl || undefined} controls autoPlay playsInline preload="metadata" referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)} aria-label={t('app.templates.previewLabel', { name: item.name })} className="h-full w-full object-cover">
            {t('app.templates.videoFallback')}
          </video>
        ) : stillPreview ? <img src={stillPreview} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : (
          <div role="img" aria-label={t('app.templates.previewUnavailable', { name: item.name })} className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top_left,var(--color-vx-accent),transparent_55%),linear-gradient(145deg,#0d1824,#152d3f)] px-6 text-center font-vx-mono text-xs font-bold uppercase tracking-[0.12em] text-white/75">{t('app.templates.previewUnavailableShort')}</div>
        )}
        {hasVideo && (!previewing || previewFailed) && (
          <button type="button" onClick={() => { setPreviewFailed(false); setPreviewing(true); }} className="vx-press absolute inset-x-4 bottom-4 mx-auto inline-flex min-h-11 w-fit items-center rounded-full border border-white/25 bg-black/70 px-4 text-sm font-extrabold text-white backdrop-blur-sm">
            <span aria-hidden="true" className="me-2">▶</span>{t(previewFailed ? 'app.templates.retryPreview' : 'app.templates.playPreview')}
          </button>
        )}
        <span className="absolute start-3 top-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">{t('app.templates.effect', { provider })}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-black">{item.name}</h3>
          {item.tag && <span className="text-[10px] font-bold text-vx-fg-muted">{item.tag}</span>}
        </div>
        <p className="mt-1 text-xs text-vx-fg-muted">{item.category}</p>
        {input && <p className="mt-4 text-sm leading-6 text-vx-fg-body">{t('app.templates.input', { input })}</p>}
        {item.requirements?.length > 0 && <p className="mt-3 line-clamp-3 text-xs leading-5 text-vx-fg-muted">{item.requirements.slice(0, 3).map(part => `${part.label}: ${part.value}`).join(' · ')}</p>}
        {price && <p className="mt-3 text-sm font-bold text-vx-money">{t('app.templates.customerCredits', { price })}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {item.previewUrl && <a href={item.previewUrl} target="_blank" rel="noreferrer" className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-accent">{t('app.templates.openPreview')}</a>}
          <CatalogTemplateRun item={item} provider={providerId} t={t} />
        </div>
      </div>
    </li>
  );
}

function CatalogTemplateRun({ item, provider, t }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [resolution, setResolution] = useState(item.prices?.[0]?.resolution || '');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const key = useRef(null);
  const choice = item.prices?.find(entry => entry.resolution === resolution);
  const credits = choice?.credits ?? item.credits;
  const min = Number.isInteger(item.minInputCount) && item.minInputCount >= 0 ? item.minInputCount : item.inputCount || 1;
  const max = Number.isInteger(item.maxInputCount) && item.maxInputCount >= min ? item.maxInputCount : item.inputCount || 1;
  const guidance = [item.inputRequirement, ...(item.requirements || [])
    .filter(part => /recommended image types|image count|attention/i.test(part.label))
    .map(part => `${part.label}: ${part.value}`)].filter(Boolean).slice(0, 3);
  const ready = Number.isInteger(credits) && files.length >= min && files.length <= max && (files.length === 0 || consent) && !sending;
  const close = () => { if (!sending) { setOpen(false); setFiles([]); setConsent(false); setError(''); setSubmitted(null); key.current = null; } };
  async function submit() {
    if (!ready) return;
    setSending(true); setError('');
    try {
      const source_keys = [];
      for (const file of files) source_keys.push({ slot: 'image', key: await uploadSourceFile(file) });
      key.current ||= makeIdempotencyKey();
      const result = await gatewayFetch('/generations', { method: 'POST', body: JSON.stringify({
        model_id: 'catalog-template', idempotency_key: key.current, inputs: {}, source_keys, consent: files.length > 0,
        confirmed_credits: credits, catalog_template: { provider, catalog_id: item.catalogId, ...(resolution ? { resolution } : {}) },
      }) });
      setSubmitted(result.job_id); notifyBalanceChanged();
    } catch (cause) {
      setError(cause?.code === 'credit_confirmation_mismatch' ? t('app.templates.priceChanged') : t('app.templates.runFailed'));
    } finally { setSending(false); }
  }
  return <>
    <button type="button" onClick={() => setOpen(true)} className="vx-press inline-flex min-h-11 items-center rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink">{t('app.templates.useTemplate')}</button>
    {open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={`run-${item.catalogId}`} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h3 id={`run-${item.catalogId}`} className="text-xl font-black">{item.name}</h3><p className="mt-1 text-sm font-bold text-vx-money">{t('app.templates.price', { count: credits })}</p></div><button type="button" disabled={sending} onClick={close} aria-label={t('app.templates.close')} className="min-h-11 min-w-11 text-xl">×</button></div>
        {submitted ? <div role="status" className="mt-6 rounded-xl bg-vx-base p-4"><p className="font-bold">{t('app.templates.submitted')}</p><Link href="/app/library" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">{t('app.templates.viewLibrary')}</Link></div> : <>
          {item.prices?.length > 0 && <fieldset className="mt-6"><legend className="text-sm font-bold">{t('app.templates.resolution')}</legend><div className="mt-2 flex flex-wrap gap-2">{item.prices.map(entry => <button key={entry.resolution} type="button" aria-pressed={resolution === entry.resolution} onClick={() => { setResolution(entry.resolution); key.current = null; }} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink">{entry.resolution} · {entry.credits}</button>)}</div></fieldset>}
          {max > 0 ? <><div className="mt-6 rounded-xl bg-vx-base p-4 text-sm leading-6"><p className="font-bold">{t('app.templates.imageOrderHelp')}</p>{guidance.map((line, index) => <p key={`${index}:${line}`} className="mt-1 text-vx-fg-muted">{line}</p>)}</div><label className="mt-6 block text-sm font-bold">{t('app.templates.chooseImages', { min, max })}<input type="file" multiple={max > 1} accept="image/jpeg,image/png,image/webp" onChange={event => { setFiles(Array.from(event.target.files || []).slice(0, max)); key.current = null; }} className="mt-2 block min-h-11 w-full rounded-xl border border-vx-field bg-vx-base p-3 text-sm" /></label>
          <p className="mt-2 text-xs text-vx-fg-muted">{t('app.templates.imagesSelected', { count: files.length, max })}</p>
          <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 h-5 w-5" /><span>{t('app.templates.rightsConsent')}</span></label></> : <p className="mt-6 text-sm text-vx-fg-body">{t('app.templates.noImagesRequired')}</p>}
          {error && <p role="alert" className="mt-4 text-sm text-vx-danger">{error}</p>}
          <button type="button" disabled={!ready} onClick={submit} className="vx-press mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:opacity-50">{sending ? t('app.templates.submitting') : t('app.templates.generateFor', { count: credits })}</button>
        </>}
      </section>
    </div>}
  </>;
}

function VeoCard({ item, onUse, t }) {
  return (
    <li className="flex min-h-72 flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div role="img" aria-label={t('app.templates.conceptPreviewLabel', { name: item.name })} className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-cyan-200/60 via-violet-700/35 to-slate-950 p-5 text-white">
        <span aria-hidden="true" className="absolute -end-12 -top-10 h-40 w-40 rounded-full border border-white/20 bg-white/10 blur-sm" />
        <span aria-hidden="true" className="absolute -bottom-16 start-8 h-40 w-64 rotate-[-12deg] rounded-[50%] border border-white/15 bg-black/20" />
        <span className="relative rounded-full border border-white/25 bg-black/25 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] backdrop-blur-sm">{t('app.templates.conceptPreview')}</span>
        <div className="absolute inset-x-5 bottom-5">
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">{item.aspect} · {item.category}</p>
          <p className="mt-1 text-xl font-black leading-tight">{item.name}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <span className="w-fit rounded-full bg-vx-hue-iris/10 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-hue-iris">{t('app.templates.veoRecipe')}</span>
        <h3 className="mt-4 text-lg font-black">{item.name}</h3>
        <p className="mt-1 text-xs text-vx-fg-muted">{t('app.templates.veoMeta', { category: item.category })}</p>
        <p className="mt-4 line-clamp-5 text-sm leading-6 text-vx-fg-body">{item.prompt}</p>
        <button type="button" onClick={() => onUse(item)} className="vx-press mt-auto inline-flex min-h-11 w-fit items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">{t('app.templates.useVeo')}</button>
      </div>
    </li>
  );
}

function SunoCard({ item, playing, progress, onToggle, t }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <img src={item.artwork} alt="" loading="lazy" className="aspect-[4/3] w-full bg-vx-base object-cover" />
      <div className="p-4">
        <span className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-accent">{t('app.templates.sunoStart')}</span>
        <h3 className="mt-2 text-base font-black">{item.name}</h3>
        <p className="mt-1 text-xs text-vx-fg-muted">{t('app.templates.sunoMeta', { category: item.category, bpm: item.bpm, key: item.musicalKey })}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-vx-base" role="progressbar" aria-label={t('app.templates.audioProgress', { name: item.name })} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
          <span className="block h-full rounded-full bg-vx-accent transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
        <button type="button" aria-pressed={playing} aria-label={t(playing ? 'app.templates.pauseAudio' : 'app.templates.playAudio', { name: item.name })} onClick={onToggle} className="vx-press mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-vx-border px-4 text-sm font-extrabold hover:border-vx-accent">
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          <span>{playing ? t('app.templates.pausePreview') : t('app.templates.listenPreview', { seconds: MUSIC_SAMPLE_PREVIEW_SECONDS })}</span>
        </button>
        <Link href={`/app/music/create?sample=${encodeURIComponent(item.id)}`} className="vx-press mt-4 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">{t('app.templates.useSuno')}</Link>
      </div>
    </li>
  );
}

export function TemplateCatalog({ kling, seedance, veo, suno }) {
  const router = useRouter();
  const { t } = useI18n();
  const [provider, setProvider] = useState('kling');
  const [query, setQuery] = useState('');
  const [crunPreviewCount, setCrunPreviewCount] = useState(null);
  const [remote, setRemote] = useState({ kling: null, seedance: null, vidu: null });
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState({});
  const [playingPreview, setPlayingPreview] = useState(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [audioError, setAudioError] = useState('');
  const requested = useRef(new Set());
  const stopPreviewRef = useRef(null);
  const needle = query.trim().toLocaleLowerCase();

  useEffect(() => {
    let live = true;
    fetch('/api/template-catalog?summary=1')
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (live && Number.isInteger(body?.total) && body.total >= 0) setCrunPreviewCount(body.total);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const loadRemote = useCallback(async (kind, page = 1) => {
    setLoading(kind);
    setError(current => ({ ...current, [kind]: '' }));
    try {
      const response = await fetch(`/api/template-catalog?provider=${kind}&page=${page}&page_size=50`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'catalog_unavailable');
      setRemote(current => {
        const previous = page === 1 ? [] : current[kind]?.templates || [];
        const byId = new Map([...previous, ...(body.templates || [])].map(item => [item.catalogId || item.id, item]));
        return { ...current, [kind]: { ...body, templates: [...byId.values()] } };
      });
    } catch {
      setError(current => ({ ...current, [kind]: t('app.templates.unavailable') }));
    } finally {
      setLoading(current => current === kind ? null : current);
    }
  }, [t]);

  useEffect(() => {
    if (!CRUN_PROVIDERS.includes(provider) || remote[provider] || error[provider] || loading === provider || requested.current.has(provider)) return;
    requested.current.add(provider);
    queueMicrotask(() => { void loadRemote(provider, 1); });
  }, [provider, remote, error, loading, loadRemote]);

  const stopSunoPreview = useCallback(() => {
    stopPreviewRef.current?.();
    stopPreviewRef.current = null;
    setPlayingPreview(null);
    setPreviewProgress(0);
  }, []);

  useEffect(() => () => stopPreviewRef.current?.(), []);

  const toggleSunoPreview = useCallback((item) => {
    if (playingPreview === item.id) {
      stopSunoPreview();
      return;
    }
    stopSunoPreview();
    setAudioError('');
    try {
      setPlayingPreview(item.id);
      stopPreviewRef.current = scheduleMusicSamplePreview(item, DEFAULT_MUSIC_MIX, setPreviewProgress, () => {
        stopPreviewRef.current = null;
        setPlayingPreview(null);
        setPreviewProgress(0);
      });
    } catch {
      setPlayingPreview(null);
      setAudioError(t('app.templates.audioUnavailable'));
    }
  }, [playingPreview, stopSunoPreview, t]);

  const local = provider === 'kling' ? kling : provider === 'seedance' ? seedance : provider === 'veo' ? veo : provider === 'suno' ? suno : EMPTY_TEMPLATES;
  const visibleLocal = useMemo(() => local.filter(item => includesQuery(item, needle)), [local, needle]);
  const visibleRemote = (remote[provider]?.templates || []).filter(item => includesQuery(item, needle));

  const useVeo = item => {
    const written = writeStudioDraft(window.sessionStorage, item);
    if (written) router.push(`/app/create?model=${encodeURIComponent(item.model)}`);
  };

  const info = PROVIDERS.find(item => item.id === provider);
  return (
    <section className="mt-10" data-testid="template-catalog">
      {crunPreviewCount !== null && (
        <p className="mb-5 font-vx-mono text-xs font-bold uppercase tracking-[0.12em] text-vx-fg-muted" data-testid="crun-template-count">
          {t('app.templates.crunSummary', { count: crunPreviewCount.toLocaleString() })}
        </p>
      )}
      <nav aria-label={t('app.templates.providerLabel')} className="flex flex-wrap gap-2" role="tablist">
        {PROVIDERS.map(item => (
          <button key={item.id} type="button" role="tab" aria-selected={provider === item.id} onClick={() => { stopSunoPreview(); setProvider(item.id); setQuery(''); }}
            className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 text-sm font-bold text-vx-fg-body hover:border-vx-accent aria-selected:border-vx-accent aria-selected:bg-vx-accent aria-selected:text-vx-accent-ink">
            {t(item.labelKey)}
          </button>
        ))}
      </nav>
      <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="vx-display text-[30px] sm:text-[38px]">{t('app.templates.heading', { provider: t(info.labelKey) })}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-vx-fg-muted">{t(info.detailKey)}</p>
        </div>
        <label className="block w-full max-w-sm">
          <span className="sr-only">{t('app.templates.searchLabel', { provider: t(info.labelKey) })}</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('app.templates.searchPlaceholder', { provider: t(info.labelKey) })}
            className="min-h-11 w-full rounded-xl border border-vx-field bg-vx-panel px-4 text-sm outline-none focus:border-vx-accent focus:ring-2 focus:ring-vx-accent/30" />
        </label>
      </div>

      {CRUN_PROVIDERS.includes(provider) && (
        <>
          <div className="mb-4 mt-8 flex items-end justify-between gap-3">
            <div><h3 className="text-xl font-black">{t('app.templates.readyCount', { count: visibleLocal.length })}</h3><p className="mt-1 text-xs text-vx-fg-muted">{t('app.templates.readyHelp')}</p></div>
          </div>
          {visibleLocal.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleLocal.map(item => <ReadyCard key={item.id} item={item} badge={t('app.templates.ready')} t={t} />)}</ul>
            : needle ? <Empty query={query} t={t} />
              : <p className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">{t('app.templates.noLocal')}</p>}
          <div className="mb-4 mt-12">
            <h3 className="text-xl font-black">{remote[provider] ? t('app.templates.liveIndexCount', { count: remote[provider].total }) : t('app.templates.liveIndex')}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-vx-fg-muted">{t('app.templates.liveHelp')}</p>
          </div>
          {error[provider] && <div role="status" className="mb-4 rounded-xl border border-vx-money/40 bg-vx-money/5 px-4 py-3 text-sm text-vx-fg-body">{error[provider]} <button type="button" className="ms-2 min-h-11 font-bold text-vx-accent underline" onClick={() => loadRemote(provider, 1)}>{t('app.templates.retry')}</button></div>}
          {!remote[provider] && loading === provider ? <p role="status" className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">{t('app.templates.loadingIndex', { provider: t(info.labelKey) })}</p>
            : visibleRemote.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleRemote.map(item => <ProviderCard key={item.catalogId || item.id} item={item} providerId={provider} provider={t(info.labelKey)} t={t} />)}</ul>
              : remote[provider] && <Empty query={query} t={t} />}
          {remote[provider] && remote[provider].templates.length < remote[provider].total && (
            <button type="button" disabled={loading === provider} onClick={() => loadRemote(provider, remote[provider].page + 1)} className="vx-press mt-6 min-h-11 rounded-full border border-vx-border px-6 text-sm font-bold hover:border-vx-accent disabled:opacity-50">
              {loading === provider ? t('app.templates.loading') : t('app.templates.loadMore', { loaded: remote[provider].templates.length, total: remote[provider].total })}
            </button>
          )}
        </>
      )}

      {provider === 'veo' && (visibleLocal.length ? <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleLocal.map(item => <VeoCard key={item.id} item={item} onUse={useVeo} t={t} />)}</ul> : <div className="mt-8"><Empty query={query} t={t} /></div>)}
      {provider === 'suno' && audioError ? <p role="alert" className="mt-6 rounded-xl border border-vx-danger/40 bg-vx-danger/5 px-4 py-3 text-sm text-vx-danger">{audioError}</p> : null}
      {provider === 'suno' && (visibleLocal.length ? <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleLocal.map(item => <SunoCard key={item.id} item={item} playing={playingPreview === item.id} progress={playingPreview === item.id ? previewProgress : 0} onToggle={() => toggleSunoPreview(item)} t={t} />)}</ul> : <div className="mt-8"><Empty query={query} t={t} /></div>)}
    </section>
  );
}
