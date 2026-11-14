'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { LibraryAccessState, LibrarySkeleton } from '../../_components/LibraryAccessState';
import { LibraryEmpty } from './LibraryEmpty';
import { gatewayFetch, GatewayError, notifyBalanceChanged } from '../../_lib/gateway';
import { readJobHistory, pushJobHistory } from '../../_lib/jobHistory';
import { EditSheet } from '../../_components/EditSheet';
import { SmartCutEntry } from '../../_components/SmartCutEntry';
import { useCatalog } from '../../_lib/useCatalog';
import { mergeHydrated, shouldPoll } from '../../_lib/jobWindow';
import { STATE_TABS, KIND_TABS, VIEWS, VIEW_KEY, filterRows, readView } from '../../_lib/libraryFilter';
import { readFavourites, toggleFavourite, reconcileFavourites } from '../../_lib/favourites';
import { fetchLibrarySync, pushFavourite } from '../../_lib/librarySync';
import { hydrateFromHistory, serverRow } from '../../_lib/libraryRows';
import { useLibraryRefresh } from '../../_lib/useLibraryRefresh';
import { FilmLibraryMasters } from '../../_components/film/FilmLibraryMasters';
import { DeviceLibrary } from '../../_components/DeviceLibrary';
import { EditorLibraryRenders } from '../../_components/editor/EditorLibraryRenders';
import { getSession, getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { useOlderLibraryJobs } from '../../_lib/useOlderLibraryJobs';
import { markSmartCutIntent, useSmartCutIntent } from '../../_lib/useSmartCutIntent';
const LibraryJobCard = dynamic(() => import('../../_components/LibraryJobCard').then((module) => module.LibraryJobCard), { ssr: false });
const POLL_MS = 3000;
// ~1 minute of consecutive failure before we stop and say so.
const POLL_GIVE_UP_AFTER = 20;
// History holds up to 50 jobs and each one costs two authenticated gateway
// calls to hydrate (/jobs/:id then /jobs/:id/asset). Hydrating the whole ring
// buffer on mount was up to 100 requests in one burst. Hydrate a page at a
// time instead; rows outside the window still render from localStorage.
const PAGE = 12;
const EDITOR_FLAG = 'veyrnox_editor'; const editorFlag = () => { try { return window.localStorage.getItem(EDITOR_FLAG) === '1'; } catch { return false; } };
// Browser-only values read once: off / 'grid' on the server and first paint.
const never = () => () => {};
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
  // Starred job ids: this browser's copy shows first (_lib/favourites.js); with library sync on (ADR-0340) the account's
  // list replaces it, so a star made on the phone is here too. Sync off or unreachable: the local copy stands.
  const [favourites, setFavourites] = useState([]);
  const [favOnly, setFavOnly] = useState(false);
  const syncFavourites = useCallback(async () => {
    const userId = getSession()?.user?.id;
    const synced = await fetchLibrarySync();
    if (synced.kind !== 'ok' || getSession()?.user?.id !== userId) return;
    const { ids, upload } = reconcileFavourites(window.localStorage, userId, synced.favourites);
    setFavourites(ids);
    for (const id of upload) await pushFavourite(id, true);
  }, []);
  useEffect(() => { setFavourites(readFavourites(window.localStorage, getSession()?.user?.id)); void syncFavourites(); }, [syncFavourites]);
  const star = (id) => {
    const userId = getSession()?.user?.id;
    const next = toggleFavourite(window.localStorage, userId, id);
    setFavourites(next);
    void pushFavourite(id, next.includes(id));
  };
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
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(false);
  const openSmartCut = useCallback(() => setKind('video'), []);
  const { editorOn = false, smartCutIntent = false, enableEditorPreview = () => {} } = useSmartCutIntent(openSmartCut, { editorKey: EDITOR_FLAG, getEditorFlag: editorFlag }) || {};

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
        if (cancelled) return;
        // An answer without a list is not a live list: say so, or the skeleton below never ends.
        if (!Array.isArray(page.jobs)) { setListLive(false); return; }
        const labels = new Map(readJobHistory().map((h) => [h.job_id, h]));
        setRows((prev) => {
          const local = new Map(prev.map((r) => [r.job_id, r]));
          const server = page.jobs.map((j) => {
            const h = labels.get(j.job_id) || local.get(j.job_id) || {};
            return serverRow(j, h);
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

  // A creation finished on the phone shows here when this tab is looked at again (ADR-0340).
  useLibraryRefresh({ actor, pageSize: PAGE * 2, setRows, setListLive, syncFavourites });

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
  const filtered = tab !== 'all' || kind !== 'all' || favOnly;
  // The button that was pressed leaves with the empty state: focus goes to the filter now in force, not to the page.
  const clearFilters = () => { setTab('all'); setKind('all'); setFavOnly(false); document.querySelector('[data-testid="library-state-all"]')?.focus(); };
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
          <div role="alert" className="rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
            <span aria-hidden="true">△</span>
            <span>{t("app.library.unreachable")}</span>
            {/* A new array restarts the polling effect, which stopped itself when it gave up.
                The banner and this button stay until the first tick that answers clears them. */}
            <button type="button" onClick={() => setRows((prev) => [...prev])} className="vx-press col-start-2 justify-self-start rounded-full border border-vx-danger/40 px-3 py-1.5 text-xs font-bold pointer-coarse:min-h-11">{t("recovery.retry")}</button>
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
              className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold capitalize pointer-coarse:min-h-11 border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base"
            >
              {t(`app.library.tab.${state}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" data-testid="library-types" aria-label={t("app.library.typeFilter")}>
            {KIND_TABS.map((k) => (
              <button data-testid={`library-kind-${k}`} key={k} onClick={() => setKind(k)} aria-pressed={kind === k} type="button"
                className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold pointer-coarse:min-h-11 border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base">
                {t(`app.library.kind.${k}`)}
              </button>
            ))}
            <button data-testid="library-favourites" onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly} type="button"
              className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold pointer-coarse:min-h-11 border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base">
              {t("app.library.favourites")}</button>
          </div>
          <div className="flex gap-2" role="group" data-testid="library-layout" aria-label={t("app.library.layout")}>
            {VIEWS.map((v) => (
              <button data-testid={`library-view-${v}`} key={v} onClick={() => chooseView(v)} aria-pressed={view === v} type="button"
                className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold capitalize pointer-coarse:min-h-11 border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base">
                {t(`app.library.view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <DeviceLibrary visible={['all','succeeded'].includes(tab) && !favOnly} kind={kind} />
      <EditorLibraryRenders visible={['all','succeeded'].includes(tab) && ['all','video'].includes(kind) && !favOnly}/>
      <FilmLibraryMasters visible={['all','succeeded'].includes(tab) && ['all','video'].includes(kind) && !favOnly}/>

      {smartCutIntent && <SmartCutEntry enabled={editorOn} selectedCount={pickedClips.length} onEnable={enableEditorPreview} />}

      <section id="library-assets" className="max-w-[1400px] mx-auto scroll-mt-24 px-4 sm:px-8 pb-16">
        {/* Nothing cached and the account list not answered yet is still loading, not an empty Library. */}
        {!historyLoaded || (listLive === null && rows.length === 0) ? <LibrarySkeleton view={view} /> : list.length === 0 ? <LibraryEmpty models={models} fresh={rows.length === 0} filtered={filtered} onClear={clearFilters} /> : (
          <div className={view === 'list' ? 'grid grid-cols-1 gap-3 max-w-[760px]' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'}>
            {list.map((r) => (
              <LibraryJobCard key={r.job_id} row={r} models={models} starred={favourites.includes(r.job_id)} onStar={() => star(r.job_id)}
                selectable={canSelect(r)} selected={selected.includes(r.job_id)} onToggle={() => toggle(r.job_id)} onSmartCut={() => { setSelected([r.job_id]); markSmartCutIntent(); setEditing(true); }} />
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
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-40 border-t border-vx-border bg-vx-panel sm:bottom-0">
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
                {smartCutIntent
                  ? `${t('app.library.openSmartCut')} (${number(pickedClips.length)})`
                  : t('app.library.edit', { count: number(pickedClips.length) })}
              </button>
            </span>
          </div>
        </div>
      )}

      {editing && <EditSheet clips={pickedClips} audios={audios} credits5s={editCredits} smartCut={smartCutIntent} onClose={() => setEditing(false)} onSubmitted={onEditSubmitted} />}
      </Main>
    </div>
  );
}
