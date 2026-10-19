'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { LibraryAccessState } from '../../_components/LibraryAccessState';
import { LibraryClip } from '../../_components/LibraryClip';
import { Chip } from '../../_components/Chip';
import { gatewayFetch, GatewayError, notifyBalanceChanged } from '../../_lib/gateway';
import { readJobHistory, pushJobHistory } from '../../_lib/jobHistory';
import { useAssetUrl } from '../../_lib/useAssetUrl';
import { ScheduleGeneration } from '../../_components/ScheduleGeneration';
import { AssetFooter } from '../../_components/AssetFooter';
import { AssetLoadStatus } from '../../_components/AssetLoadStatus';
import { EditSheet } from '../../_components/EditSheet';
import { useCatalog } from '../../_lib/useCatalog';
import { mergeHydrated, shouldPoll } from '../../_lib/jobWindow';
import { STATE_TABS, KIND_TABS, VIEWS, VIEW_KEY, filterRows, readView } from '../../_lib/libraryFilter';
import { readFavourites, toggleFavourite } from '../../_lib/favourites';
import { formatWhen } from '../../_lib/formatWhen';
import { FilmLibraryMasters } from '../../_components/film/FilmLibraryMasters';
import { DeviceLibrary } from '../../_components/DeviceLibrary';
import { EditorLibraryRenders } from '../../_components/editor/EditorLibraryRenders';
import { getSession, getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { useOlderLibraryJobs } from '../../_lib/useOlderLibraryJobs';

// Account list is authoritative; local history supplies cached display names.
const STATE_UI = {
  queued:    { chip: 'accent', glyph: '●' },
  running:   { chip: 'accent', glyph: '●' },
  succeeded: { chip: 'accent', glyph: '✓' },
  // FAILED is not REFUNDED: the refund is a second call, and /jobs/:id says
  // whether it has landed. Claiming it either way was the old bug.
  failed:    { chip: 'danger', glyph: '✕' },
  failed_pending: { chip: 'danger', glyph: '✕' },
  // We could not read this job's state: it 404s (not ours, or aged out of the
  // window) or the server was unreachable. Deliberately neutral — claiming
  // either DONE or FAILED · REFUNDED would assert something about the ledger
  // that we have not checked.
  unknown:   { chip: 'neutral', glyph: '?' },
};

const POLL_MS = 3000;
// ~1 minute of consecutive failure before we stop and say so.
const POLL_GIVE_UP_AFTER = 20;
// History holds up to 50 jobs and each one costs two authenticated gateway
// calls to hydrate (/jobs/:id then /jobs/:id/asset). Hydrating the whole ring
// buffer on mount was up to 100 requests in one burst. Hydrate a page at a
// time instead; rows outside the window still render from localStorage.
const PAGE = 12;
// Clip Editor stays hidden until launch unless this browser opts in
// (CLAUDE.md "Delivery": new user paths behind localStorage.veyrnox_*).
const EDITOR_FLAG = 'veyrnox_editor';
// Browser-only values read once: off / 'grid' on the server and first paint.
const never = () => () => {};
const editorFlag = () => { try { return window.localStorage.getItem(EDITOR_FLAG) === '1'; } catch { return false; } };
const savedView = () => readView(window.localStorage);
const off = () => false;
const on = () => true;
const gridView = () => 'grid';
const isVideo = (r) => !!r.asset_url && !!r.mime_type?.startsWith('video/');
const isAudio = (r) => !!r.asset_url && !!r.mime_type?.startsWith('audio/');

export default function Library() {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : value.toLocaleString(localeTag(locale));
  const { models } = useCatalog();
  const [tab, setTab] = useState('all');
  const [kind, setKind] = useState('all');
  // Starred job ids, per account in this browser (_lib/favourites.js).
  const [favourites, setFavourites] = useState([]);
  const [favOnly, setFavOnly] = useState(false);
  useEffect(() => { setFavourites(readFavourites(window.localStorage, getSession()?.user?.id)); }, []);
  const star = (id) => setFavourites(toggleFavourite(window.localStorage, getSession()?.user?.id, id));
  // Grid on the server and first paint; the saved layout is applied after mount.
  const stored = useSyncExternalStore(never, savedView, gridView);
  const [chosen, setChosen] = useState(null);
  const view = chosen ?? stored;
  const chooseView = (v) => { setChosen(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ } };
  const [balance, setBalance] = useState(null);
  // Hydrate cached history after mount to match the server.
  const [rows, setRows] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const pollRef = useRef(null);
  const [unreachable, setUnreachable] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [listLive, setListLive] = useState(null);
  const editorOn = useSyncExternalStore(never, editorFlag, off);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(false);

  const actor=useSyncExternalStore(onSessionChange,getStoredUserId,()=>null);
  const sessionLoaded = useSyncExternalStore(never, on, off);

    const loadBalance = useCallback(async () => {
    if(!getStoredUserId())return;
    try {
      const b = await gatewayFetch('/balance');
      setBalance(b.balance);
    } catch { setBalance(null); }
  }, []);
  useEffect(() => {
    loadBalance();
    const onBalance = () => loadBalance();
    window.addEventListener('veyrnox:balance-changed', onBalance);
    return () => window.removeEventListener('veyrnox:balance-changed', onBalance);
  }, [loadBalance,actor]);

  // Cached names paint first; the authoritative account list follows.
  useEffect(() => {
    setRows(actor?readJobHistory().map(hydrateFromHistory):[]);
    setHistoryLoaded(true);
  }, [actor]);

  // Read the account list on each identity change, including a cleared cache.
  useEffect(() => {
    if(!actor){setListLive(null);setNextCursor(null);return;}
    setNextCursor(null); setVisible(PAGE); setListLive(null);
    let cancelled = false;
    (async () => {
      try {
        const page = await gatewayFetch(`/jobs?limit=${PAGE * 2}`);
        if (cancelled || !Array.isArray(page.jobs)) return;
        const labels = new Map(readJobHistory().map((h) => [h.job_id, h]));
        setRows((prev) => {
          const local = new Map(prev.map((r) => [r.job_id, r]));
          const server = page.jobs.map((j) => {
            const h = labels.get(j.job_id) || local.get(j.job_id) || {};
            return { ...hydrateFromHistory({ ...h, job_id: j.job_id, model_id: j.model_id, credits: j.credits }),
              name: h.name || j.label, prompt: h.prompt || j.label,
              submitted_at: h.submitted_at || Date.parse(j.created_at) || undefined,
              state: j.state, refunded: j.refunded, error_code: j.error_code, has_asset: j.has_asset, held: j.held, ...(j.held ? { asset_url: undefined } : {}), asset_expires_at: j.asset_expires_at };
          });
          // A job submitted seconds ago may not be in this page yet; keep it.
          const seen = new Set(server.map((r) => r.job_id));
          return [...prev.filter((r) => !seen.has(r.job_id) && r.state === 'queued'), ...server];
        });
        setNextCursor(page.next || null);
        setListLive(true);
      } catch {
        // Offline, or an older Worker without the endpoint: the cache stands,
        // and the banner below says the list may be incomplete.
        if (!cancelled) setListLive(false);
      }
    })();
    return () => { cancelled = true; };
  }, [actor]);

  // fetch: hydrate the visible window's real state; then poll the in-flight ones.
  // Growing the window re-hydrates a bounded page.
  useEffect(() => {
    if(!actor)return;
    let cancelled = false;
    (async () => {
      const window_ = rowsRef.current.slice(0, visible);
      const results = await Promise.all(window_.map(async (h) => {
        try {
          const j = await gatewayFetch(`/jobs/${h.job_id}`);
          const merged = { ...h, ...j };
          if (j.state === 'succeeded') {
            try {
              const a = await gatewayFetch(`/jobs/${h.job_id}/asset`);
              return { ...merged, asset_url: a.url, mime_type: a.mime_type, has_asset: true, held: false, asset_expires_at: a.asset_expires_at };
            } catch (e) { return e.code === 'held' ? { ...merged, held: true, has_asset: false, asset_url: undefined } : merged; }
          }
          return merged;
        } catch (e) {
          if (e instanceof GatewayError && e.status === 404) {
            // 404 is also what the route returns for a job that is not ours,
            // or one aged out of the window. Rendering it as `failed` made
            // the card show a +credits refund delta that never happened.
            return { ...hydrateFromHistory(h), state: 'unknown' };
          }
          // Offline or a 5xx: say so rather than leaving every card reading
          // QUEUED with a shimmer for a job that finished an hour ago.
          return { ...hydrateFromHistory(h), state: 'unknown' };
        }
      }));
      if (!cancelled) {
        setRows((prev) => mergeHydrated(prev, results));
      }
    })();
    return () => { cancelled = true; };
  }, [visible, listLive,actor]);

  // poll any in-flight rows
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if(!actor)return;
    const hasInFlight = rows.some((r, i) => shouldPoll(r, i, visible));
    if (!hasInFlight) return;
    // Give up rather than hammer a server that is not answering. Every tick
    // costs one authenticated RPC per in-flight row plus an asset call for any
    // that just finished, so an unattended tab against a 5xx was the single
    // heaviest client in the system.
    let failures = 0;
    pollRef.current = setInterval(async () => {
      let tickFailed = false;
      const updates = await Promise.all(rows.map(async (r, i) => {
        if (!shouldPoll(r, i, visible)) return r;
        try {
          const j = await gatewayFetch(`/jobs/${r.job_id}`);
          if (j.state === 'succeeded') {
            try {
              const a = await gatewayFetch(`/jobs/${r.job_id}/asset`);
              notifyBalanceChanged();
              return { ...r, ...j, asset_url: a.url, mime_type: a.mime_type, has_asset: true, held: false, asset_expires_at: a.asset_expires_at };
            } catch (e) { notifyBalanceChanged(); return { ...r, ...j, ...(e.code === 'held' ? { held: true, has_asset: false, asset_url: undefined } : {}) }; }
          }
          if (j.state === 'failed') { notifyBalanceChanged(); return { ...r, ...j }; }
          // Same state as last tick: return the identical object so `rows` keeps
          // its reference, the grid does not re-render, and this effect does not
          // tear down and rebuild the interval every 3s.
          if (j.state === r.state) return r;
          return { ...r, ...j };
        } catch { tickFailed = true; return r; }
      }));
      // One tick where every in-flight row failed counts as one failure; a
      // tick with any success resets. 20 consecutive at 3s is ~1 minute.
      if (tickFailed) {
        failures += 1;
        if (failures >= POLL_GIVE_UP_AFTER) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setUnreachable(true);
          return;
        }
      } else {
        failures = 0;
        setUnreachable(false);
      }
      if (updates.some((u, i) => u !== rows[i])) setRows(updates);
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [rows, visible,actor]);

  const { loadOlder, loadingOlder, olderError } = useOlderLibraryJobs({ actor, nextCursor, setNextCursor, setRows, setVisible, hydrateFromHistory, pageSize: PAGE });

  const shown = rows.slice(0, visible);
  const list = filterRows(shown, { state: tab, kind, favourites: favOnly ? favourites : null }, models);
  const hasMore = rows.length > visible;
  const canSelect = (r) => editorOn && r.state === 'succeeded' && (isVideo(r) || isAudio(r));
  const toggle = (id) => setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const picked = selected.map((id) => rows.find((r) => r.job_id === id)).filter(Boolean);
  const pickedClips = picked.filter(isVideo);
  // Audio the user ticked comes first in the picker, then the rest of the Library's.
  const audios = [...picked.filter(isAudio), ...rows.filter((r) => r.state === 'succeeded' && isAudio(r) && !selected.includes(r.job_id))];
  const editCredits = models.find((m) => m.id === 'clip-edit')?.credits ?? null;

  function onEditSubmitted(job) {
    const entry = { job_id: job.job_id, model_id: 'clip-edit', credits: job.credits, name: job.name, submitted_at: Date.now() };
    pushJobHistory(entry);
    setRows((prev) => [hydrateFromHistory(entry), ...prev]);
    if (job.balance_after != null) setBalance(job.balance_after);
    notifyBalanceChanged();
    setSelected([]);
    setEditing(false);
  }

  if (!sessionLoaded) return <LibraryAccessState loading />;
  if (!actor) return <LibraryAccessState />;

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="library" readAccount={!!actor} />
      <Main>
      {listLive === false && (
        <div className="max-w-[1500px] mx-auto px-4 sm:px-8 pt-4">
          <div role="status" className="rounded-lg border border-vx-border bg-vx-panel px-4 py-3 text-sm text-vx-fg-body flex items-start gap-2">
            <span aria-hidden="true">△</span>
            <span>{t("app.library.cached")}</span>
          </div>
        </div>
      )}

      {unreachable && (
        <div className="max-w-[1500px] mx-auto px-4 sm:px-8 pt-4">
          <div role="status" className="rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
            <span aria-hidden="true">△</span>
            <span>{t("app.library.unreachable")}</span>
          </div>
        </div>
      )}

      <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-4">
        <h1 data-testid="library-title" className="vx-display text-[40px] sm:text-[56px]">{t("app.library.title")}</h1>
        <p className="text-vx-fg-body mt-3">
          {t("app.library.refundHelp")}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          {STATE_TABS.map((state) => (
            <button
              key={state}
              data-testid={`library-state-${state}`}
              onClick={() => setTab(state)}
              aria-pressed={tab === state}
              type="button"
              className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold capitalize border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base"
            >
              {t(`app.library.tab.${state}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" data-testid="library-types" aria-label={t("app.library.typeFilter")}>
            {KIND_TABS.map((k) => (
              <button data-testid={`library-kind-${k}`} key={k} onClick={() => setKind(k)} aria-pressed={kind === k} type="button"
                className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base">
                {t(`app.library.kind.${k}`)}
              </button>
            ))}
            <button data-testid="library-favourites" onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly} type="button"
              className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base">
              {t("app.library.favourites")}</button>
          </div>
          <div className="flex gap-2" role="group" data-testid="library-layout" aria-label={t("app.library.layout")}>
            {VIEWS.map((v) => (
              <button data-testid={`library-view-${v}`} key={v} onClick={() => chooseView(v)} aria-pressed={view === v} type="button"
                className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold capitalize border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base">
                {t(`app.library.view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <DeviceLibrary visible={['all','succeeded'].includes(tab) && !favOnly} kind={kind} />
      <EditorLibraryRenders visible={['all','succeeded'].includes(tab) && ['all','video'].includes(kind) && !favOnly}/>
      <FilmLibraryMasters visible={['all','succeeded'].includes(tab) && ['all','video'].includes(kind) && !favOnly}/>

      <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pb-16">
        {!historyLoaded ? null : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-12 text-center">
            <div data-testid="library-empty" className="text-lg font-black">{t("app.library.empty")}</div>
            <div className="text-[15px] text-vx-fg-body mt-1">
              {t("app.library.emptyHelp")}</div>
            <Link href="/app/create" className="vx-press inline-block mt-5 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold hover:bg-vx-accent-hover">
              {t("app.library.openStudio")}</Link>
          </div>
        ) : (
          <div className={view === 'list' ? 'grid grid-cols-1 gap-3 max-w-[760px]' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'}>
            {list.map((r) => (
              <JobCard key={r.job_id} row={r} models={models} starred={favourites.includes(r.job_id)} onStar={() => star(r.job_id)}
                selectable={canSelect(r)} selected={selected.includes(r.job_id)} onToggle={() => toggle(r.job_id)} />
            ))}
          </div>
        )}
        {olderError && <p role="alert" className="mt-4 text-center text-sm text-vx-danger">{olderError}</p>}
        {(hasMore || nextCursor) && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => (hasMore ? setVisible((v) => v + PAGE) : loadOlder())}
              type="button"
              disabled={loadingOlder}
              aria-busy={loadingOlder}
              className="vx-press rounded-full px-5 py-2.5 border border-vx-border text-[14px] font-bold text-vx-fg hover:border-vx-fg-muted disabled:opacity-50"
            >
              {loadingOlder ? t("app.library.loadingOlder") : hasMore ? t('app.library.showOlder', { count: number(Math.min(PAGE, rows.length - visible)) }) : t("app.library.loadOlder")}
            </button>
          </div>
        )}
      </section>

      {editorOn && selected.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-vx-border bg-vx-panel">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-vx-fg-body">
              {t(pluralKey(t, locale, 'app.library.selected', pickedClips.length), {
                count: number(pickedClips.length),
                audio: picked.length > pickedClips.length ? t('app.library.audioSelected', { count: number(picked.length - pickedClips.length) }) : '',
              })}
            </span>
            <span className="flex gap-2">
              <button onClick={() => setSelected([])} className="rounded-full px-4 py-2 text-sm border border-vx-border text-vx-fg-muted hover:text-vx-fg">{t("app.library.clear")}</button>
              <button onClick={() => setEditing(true)} disabled={!pickedClips.length}
                className="rounded-full px-5 py-2 text-sm font-bold bg-vx-accent text-vx-accent-ink disabled:opacity-40">
                {t('app.library.edit', { count: number(pickedClips.length) })}
              </button>
            </span>
          </div>
        </div>
      )}

      {editing && (
        <EditSheet clips={pickedClips} audios={audios} credits5s={editCredits}
          onClose={() => setEditing(false)} onSubmitted={onEditSubmitted} />
      )}
      </Main>
    </div>
  );
}

function JobCard({ row, models, selectable, selected, onToggle, starred, onStar }) {
  const { t, locale } = useI18n();
  const asset = useAssetUrl(row.job_id, row.asset_url);
  const refundPending = row.state === 'failed' && row.refunded !== true;
  const s = STATE_UI[refundPending ? 'failed_pending' : row.state] || STATE_UI.queued;
  // No delta for `unknown`: a +N would claim a refund landed and a −N would
  // claim the debit stands, and we do not know which.
  // No delta while a refund is owed but not yet made: +N would claim it landed.
  // A job that used a free allowance (ADR-0069) has credits 0: say FREE, and show nothing if it failed
  // (its allowance went back, there is no refund line to claim).
  const free = row.credits === 0;
  const creditCount = locale === 'en' ? row.credits : Number(row.credits).toLocaleString(localeTag(locale));
  const delta = row.state === 'unknown' || refundPending ? ''
    : free ? (row.state === 'failed' ? '' : t('app.library.free'))
    : row.state === 'failed' ? `+${creditCount}` : `−${creditCount}`;
  const deltaCls = free || row.state === 'failed' ? 'text-vx-accent' : 'text-vx-fg-muted';
  // Live catalog (tokens.js fallback) so newly added models show their name.
  const model = models.find((m) => m.id === row.model_id);
  const card = useRef(null);
  return (
    <div ref={card} className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
      <div
        className={`h-48 relative ${row.state === 'running' ? 'vx-shimmer' : ''}`}
        style={{ background: row.asset_url ? 'black' : row.bg }}
      >
        {row.asset_url && row.mime_type?.startsWith('video/') && (
          <LibraryClip cardRef={card} src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} />
        )}
        {row.asset_url && row.mime_type?.startsWith('audio/') && (
          <div className="absolute inset-0 flex items-end px-4 pb-4">
            <audio src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls className="w-full" />
          </div>
        )}
        {row.asset_url && row.mime_type?.startsWith('image/') && (
          <img src={asset.url} onError={asset.onError} onLoad={asset.onLoad} alt={row.name || t("app.library.generation")} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <AssetLoadStatus asset={asset} />
        <div className="absolute top-3 start-3">
          <Chip tone={s.chip} noGlyph>
            <span aria-hidden="true" className="text-[10px] me-1">{s.glyph}</span>
            <span data-library-status={refundPending ? 'failed_pending' : row.state}>{tOr(t, `app.library.status.${refundPending ? 'failed_pending' : row.state}`, t('app.library.status.queued'))}</span>
          </Chip>
        </div>
        {row.asset_url && (
          // Disclosure on every generated asset (ADR-0058 decision 8; provider
          // GenAI policies and EU AI Act Article 50 both ask for it).
          <div className={`absolute top-3 ${selectable ? 'end-14' : 'end-3'}`}>
            <Chip tone="neutral" noGlyph className="bg-black/50">{t("app.library.generated")}</Chip>
          </div>
        )}
        {selectable && (
          <button onClick={onToggle} aria-pressed={selected} data-testid="library-add-to-edit" aria-label={t("app.library.addToEdit")}
            className={`absolute top-3 end-3 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold ${
              selected ? 'bg-vx-accent border-vx-accent text-vx-accent-ink' : 'bg-black/50 border-white/70 text-transparent'
            }`}>
            ✓
          </button>
        )}
      </div>
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{row.name || row.prompt || row.job_id.slice(0, 8)}</div>
          <div className="text-xs text-vx-fg-muted mt-0.5 truncate">
            {model?.name || row.model_id}
            {row.submitted_at ? ` · ${formatWhen(row.submitted_at, locale)}` : ''}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span className={`font-vx-mono text-[13px] font-bold vx-num ${deltaCls}`}>{delta}{free ? '' : ' cr'}</span>
          <button onClick={onStar} aria-pressed={starred} data-testid="library-favourite" aria-label={t("app.library.favourite")} type="button"
            className={`text-[18px] leading-none ${starred ? 'text-vx-accent' : 'text-vx-fg-faint hover:text-vx-fg'}`}>
            {starred ? '★' : '☆'}
          </button>
        </div>
      </div>
      <ScheduleGeneration job={row} className="mx-4 mb-3" />
      <AssetFooter row={row} />
    </div>
  );
}

// Turn a history entry into a display row.
function hydrateFromHistory(h) {
  return {
    job_id: h.job_id,
    model_id: h.model_id,
    credits: h.credits,
    prompt: h.prompt,
    name: h.name,
    submitted_at: h.submitted_at,
    state: 'queued',
    bg: gradientFor(h.job_id),
  };
}

// Deterministic thumbnail placeholder based on job id — until an asset arrives.
function gradientFor(id) {
  const seed = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(seed) % 360;
  return `linear-gradient(135deg, hsl(${hue} 40% 12%), hsl(${hue} 50% 30%), hsl(${(hue + 30) % 360} 55% 55%))`;
}
