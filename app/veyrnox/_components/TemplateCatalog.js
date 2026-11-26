'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { writeStudioDraft } from '../_lib/landingDraft.js';
import {
  MUSIC_SAMPLE_PREVIEW_SECONDS,
  scheduleMusicSamplePreview,
} from '../_lib/music/samplePreview.js';

const PROVIDERS = [
  { id: 'kling', labelKey: 'app.templates.provider.kling', detailKey: 'app.templates.provider.klingDetail' },
  { id: 'seedance', labelKey: 'app.templates.provider.seedance', detailKey: 'app.templates.provider.seedanceDetail' },
  { id: 'veo', labelKey: 'app.templates.provider.veo', detailKey: 'app.templates.provider.veoDetail' },
  { id: 'suno', labelKey: 'app.templates.provider.suno', detailKey: 'app.templates.provider.sunoDetail' },
];

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

function ProviderCard({ item, provider, t }) {
  const input = item.inputCount ? t(item.inputCount === 1 ? 'app.templates.image.one' : 'app.templates.image.other', { count: item.inputCount }) : item.inputRequirement;
  const price = item.prices?.length ? item.prices.map(entry => `${entry.resolution} · ${entry.providerCredits}`).join(' / ')
    : item.providerCredits !== null && item.providerCredits !== undefined ? `${item.providerCredits}` : null;
  return (
    <li className="flex min-h-64 flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div className="relative aspect-[4/3] overflow-hidden bg-vx-base">
        {item.previewUrl ? (
          <video src={item.previewUrl} poster={item.coverUrl || undefined} controls playsInline preload="none" aria-label={t('app.templates.previewLabel', { name: item.name })} className="h-full w-full object-cover">
            {t('app.templates.videoFallback')}
          </video>
        ) : item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : (
          <div role="img" aria-label={t('app.templates.previewUnavailable', { name: item.name })} className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top_left,var(--color-vx-accent),transparent_55%),linear-gradient(145deg,#0d1824,#152d3f)] px-6 text-center font-vx-mono text-xs font-bold uppercase tracking-[0.12em] text-white/75">{t('app.templates.previewUnavailableShort')}</div>
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
        {price && <p className="mt-3 text-xs text-vx-fg-muted">{t('app.templates.providerCredits', { price })}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {item.previewUrl && <a href={item.previewUrl} target="_blank" rel="noreferrer" className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-accent">{t('app.templates.openPreview')}</a>}
          <span className="inline-flex min-h-11 items-center rounded-full bg-vx-base px-4 text-xs font-bold text-vx-fg-muted">{t('app.templates.catalogPreview')}</span>
        </div>
      </div>
    </li>
  );
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
  const [remote, setRemote] = useState({ kling: null, seedance: null });
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState({});
  const [playingPreview, setPlayingPreview] = useState(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [audioError, setAudioError] = useState('');
  const requested = useRef(new Set());
  const stopPreviewRef = useRef(null);
  const needle = query.trim().toLocaleLowerCase();

  const loadRemote = useCallback(async (kind, page = 1) => {
    setLoading(kind);
    setError(current => ({ ...current, [kind]: '' }));
    try {
      const response = await fetch(`/api/template-catalog?provider=${kind}&page=${page}&page_size=50`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'catalog_unavailable');
      setRemote(current => {
        const previous = page === 1 ? [] : current[kind]?.templates || [];
        const byId = new Map([...previous, ...(body.templates || [])].map(item => [item.id, item]));
        return { ...current, [kind]: { ...body, templates: [...byId.values()] } };
      });
    } catch {
      setError(current => ({ ...current, [kind]: t('app.templates.unavailable') }));
    } finally {
      setLoading(current => current === kind ? null : current);
    }
  }, [t]);

  useEffect(() => {
    if (!['kling', 'seedance'].includes(provider) || remote[provider] || error[provider] || loading === provider || requested.current.has(provider)) return;
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

  const local = provider === 'kling' ? kling : provider === 'seedance' ? seedance : provider === 'veo' ? veo : suno;
  const visibleLocal = useMemo(() => local.filter(item => includesQuery(item, needle)), [local, needle]);
  const visibleRemote = (remote[provider]?.templates || []).filter(item => includesQuery(item, needle));

  const useVeo = item => {
    const written = writeStudioDraft(window.sessionStorage, item);
    if (written) router.push(`/app/create?model=${encodeURIComponent(item.model)}`);
  };

  const info = PROVIDERS.find(item => item.id === provider);
  return (
    <section className="mt-10" data-testid="template-catalog">
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

      {['kling', 'seedance'].includes(provider) && (
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
            : visibleRemote.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleRemote.map(item => <ProviderCard key={item.id} item={item} provider={t(info.labelKey)} t={t} />)}</ul>
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
