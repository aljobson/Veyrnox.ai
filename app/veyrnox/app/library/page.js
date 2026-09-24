'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { gatewayFetch, GatewayError, notifyBalanceChanged } from '../../_lib/gateway';
import { readJobHistory, pushJobHistory } from '../../_lib/jobHistory';
import { useAssetUrl } from '../../_lib/useAssetUrl';
import { AssetRetention } from '../../_components/AssetRetention';
import { AssetLoadStatus } from '../../_components/AssetLoadStatus';
import { EditSheet } from '../../_components/EditSheet';
import { useCatalog } from '../../_lib/useCatalog';
import { mergeHydrated, shouldPoll } from '../../_lib/jobWindow';

// Account list is authoritative; local history supplies cached display names.
const STATE_UI = {
  queued:    { chip: 'accent', glyph: '●', label: 'QUEUED' },
  running:   { chip: 'accent', glyph: '●', label: 'RUNNING' },
  succeeded: { chip: 'accent', glyph: '✓', label: 'DONE' },
  // FAILED is not REFUNDED: the refund is a second call, and /jobs/:id says
  // whether it has landed. Claiming it either way was the old bug.
  failed:    { chip: 'danger', glyph: '✕', label: 'FAILED · REFUNDED' },
  failed_pending: { chip: 'danger', glyph: '✕', label: 'FAILED · REFUND DUE' },
  // We could not read this job's state: it 404s (not ours, or aged out of the
  // window) or the server was unreachable. Deliberately neutral — claiming
  // either DONE or FAILED · REFUNDED would assert something about the ledger
  // that we have not checked.
  unknown:   { chip: 'neutral', glyph: '?', label: 'UNKNOWN' },
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
const isVideo = (r) => !!r.asset_url && !!r.mime_type?.startsWith('video/');
const isAudio = (r) => !!r.asset_url && !!r.mime_type?.startsWith('audio/');

export default function Library() {
  const { models } = useCatalog();
  const [tab, setTab] = useState('all');
  const [balance, setBalance] = useState(null);
  // History lives in localStorage, which the server cannot read. Start empty
  // on both sides so hydration matches, then load it after mount.
  const [rows, setRows] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const pollRef = useRef(null);
  const [unreachable, setUnreachable] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [listLive, setListLive] = useState(null);
  const [editorOn, setEditorOn] = useState(false);
  const [expiryOn, setExpiryOn] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    try { setExpiryOn(window.localStorage.getItem('veyrnox_asset_expiry') === '1'); } catch { /* opt-in only */ }
  }, []);
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try { setEditorOn(window.localStorage.getItem(EDITOR_FLAG) === '1'); } catch { /* storage blocked: editor stays off */ }
  }, []);

  // load balance
  const loadBalance = useCallback(async () => {
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
  }, [loadBalance]);

  // localStorage paints instantly and names the rows (the server has no
  // display name), but it is one browser's 50-entry cache — it is no longer
  // what the Library IS. The account's own list follows.
  useEffect(() => {
    setRows(readJobHistory().map(hydrateFromHistory));
    setHistoryLoaded(true);
  }, []);

  // The account's jobs, newest first, from GET /api/v1/jobs. A second device
  // or a cleared cache used to show "Nothing here yet" while the files sat
  // in R2 (audit finding 11).
  useEffect(() => {
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
              state: j.state, refunded: j.refunded, error_code: j.error_code, has_asset: j.has_asset, asset_expires_at: j.asset_expires_at };
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
  }, []);

  // fetch: hydrate the visible window's real state; then poll the in-flight ones.
  // ponytail: growing the window re-hydrates rows already fetched. That is a
  // click-driven handful of requests; add a hydrated-id set if it ever bites.
  useEffect(() => {
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
              return { ...merged, asset_url: a.url, mime_type: a.mime_type, has_asset: true, asset_expires_at: a.asset_expires_at };
            } catch { return merged; }
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
  }, [visible, listLive]);

  // poll any in-flight rows
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
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
              return { ...r, ...j, asset_url: a.url, mime_type: a.mime_type, has_asset: true, asset_expires_at: a.asset_expires_at };
            } catch { notifyBalanceChanged(); return { ...r, ...j }; }
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
  }, [rows, visible]);

  // Older jobs, a page at a time, from the server's keyset cursor.
  const loadOlder = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const q = new URLSearchParams({ limit: String(PAGE * 2), before: nextCursor.before, before_id: nextCursor.before_id });
      const page = await gatewayFetch(`/jobs?${q}`);
      if (!Array.isArray(page.jobs)) return;
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.job_id));
        const older = page.jobs.filter((j) => !seen.has(j.job_id)).map((j) => ({
          ...hydrateFromHistory({ job_id: j.job_id, model_id: j.model_id, credits: j.credits }),
          name: j.label, prompt: j.label, submitted_at: Date.parse(j.created_at) || undefined,
          state: j.state, refunded: j.refunded, error_code: j.error_code, has_asset: j.has_asset, asset_expires_at: j.asset_expires_at,
        }));
        return [...prev, ...older];
      });
      setVisible((v) => v + PAGE * 2);
      setNextCursor(page.next || null);
    } catch { /* the button stays; the next click retries */ }
  }, [nextCursor]);

  const shown = rows.slice(0, visible);
  const list = tab === 'all' ? shown : shown.filter((r) => r.state === tab);
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

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="library" />

      {listLive === false && (
        <div className="max-w-[1500px] mx-auto px-4 sm:px-8 pt-4">
          <div role="status" className="rounded-lg border border-vx-border bg-vx-panel px-4 py-3 text-sm text-vx-fg-body flex items-start gap-2">
            <span aria-hidden="true">△</span>
            <span>We couldn&apos;t reach your library, so this is what this browser remembers — up to 50 recent jobs. Reload to try again.</span>
          </div>
        </div>
      )}

      {unreachable && (
        <div className="max-w-[1500px] mx-auto px-4 sm:px-8 pt-4">
          <div role="status" className="rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
            <span aria-hidden="true">△</span>
            <span>We stopped checking for updates — the server isn&apos;t responding. Cards marked UNKNOWN may have finished. Reload to try again.</span>
          </div>
        </div>
      )}

      <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-4">
        <Chip tone="accent" className="mb-3">LIBRARY · YOUR GENERATIONS</Chip>
        <h1 className="text-[28px] sm:text-[34px] md:text-[40px] font-black tracking-[-0.02em]">Everything you&rsquo;ve made</h1>
        <p className="text-vx-fg-body mt-2">
          Failed jobs refund automatically — they still show here so you can retry.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {['all', 'succeeded', 'running', 'queued', 'failed'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`font-vx-mono text-[11px] tracking-[0.12em] font-bold rounded-full px-4 py-2 border ${
                tab === t
                  ? 'bg-vx-panel text-vx-fg border-vx-border'
                  : 'border-transparent text-vx-fg-muted hover:text-vx-fg'
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pb-16">
        {!historyLoaded ? null : list.length === 0 ? (
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-12 text-center">
            <div className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">EMPTY</div>
            <div className="text-lg font-black mt-2">Nothing here yet.</div>
            <div className="text-sm text-vx-fg-muted mt-1">
              Head to Create and press Generate — jobs will appear here as they run.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((r) => (
              <JobCard key={r.job_id} row={r} models={models} expiryOn={expiryOn}
                selectable={canSelect(r)} selected={selected.includes(r.job_id)} onToggle={() => toggle(r.job_id)} />
            ))}
          </div>
        )}
        {(hasMore || nextCursor) && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => (hasMore ? setVisible((v) => v + PAGE) : loadOlder())}
              className="font-vx-mono text-[11px] tracking-[0.12em] font-bold rounded-full px-5 py-2.5 border border-vx-border bg-vx-panel text-vx-fg hover:text-vx-fg"
            >
              {hasMore ? `LOAD MORE · ${rows.length - visible} OLDER` : 'LOAD OLDER'}
            </button>
          </div>
        )}
      </section>

      {editorOn && selected.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-vx-border bg-vx-panel">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-vx-fg-body">
              {pickedClips.length} video{pickedClips.length === 1 ? '' : 's'}
              {picked.length > pickedClips.length ? ` · ${picked.length - pickedClips.length} audio` : ''} selected
            </span>
            <span className="flex gap-2">
              <button onClick={() => setSelected([])} className="rounded-full px-4 py-2 text-sm border border-vx-border text-vx-fg-muted hover:text-vx-fg">Clear</button>
              <button onClick={() => setEditing(true)} disabled={!pickedClips.length}
                className="rounded-full px-5 py-2 text-sm font-bold bg-vx-accent text-vx-accent-ink disabled:opacity-40">
                Edit ({pickedClips.length})
              </button>
            </span>
          </div>
        </div>
      )}

      {editing && (
        <EditSheet clips={pickedClips} audios={audios} credits5s={editCredits}
          onClose={() => setEditing(false)} onSubmitted={onEditSubmitted} />
      )}
    </div>
  );
}

function JobCard({ row, models, expiryOn, selectable, selected, onToggle }) {
  const asset = useAssetUrl(row.job_id, row.asset_url);
  const refundPending = row.state === 'failed' && row.refunded === false;
  const s = STATE_UI[refundPending ? 'failed_pending' : row.state] || STATE_UI.queued;
  // No delta for `unknown`: a +N would claim a refund landed and a −N would
  // claim the debit stands, and we do not know which.
  // No delta while a refund is owed but not yet made: +N would claim it landed.
  const delta = row.state === 'unknown' || refundPending ? ''
    : row.state === 'failed' ? `+${row.credits}` : `−${row.credits}`;
  const deltaCls = row.state === 'failed' ? 'text-vx-accent' : 'text-vx-fg-muted';
  // Live catalog (tokens.js fallback) so newly added models show their name.
  const model = models.find((m) => m.id === row.model_id);
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
      <div
        className={`h-48 relative ${row.state === 'running' ? 'vx-shimmer' : ''}`}
        style={{ background: row.asset_url ? 'black' : row.bg }}
      >
        {row.asset_url && row.mime_type?.startsWith('video/') && (
          <video src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay loop />
        )}
        {row.asset_url && row.mime_type?.startsWith('audio/') && (
          <div className="absolute inset-0 flex items-end px-4 pb-4">
            <audio src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls className="w-full" />
          </div>
        )}
        {row.asset_url && row.mime_type?.startsWith('image/') && (
          <img src={asset.url} onError={asset.onError} onLoad={asset.onLoad} alt={row.name || 'generation'} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <AssetLoadStatus asset={asset} />
        <div className="absolute top-3 left-3">
          <Chip tone={s.chip} noGlyph>
            <span aria-hidden="true" className="text-[10px] mr-1">{s.glyph}</span>
            {s.label}
          </Chip>
        </div>
        {selectable && (
          <button onClick={onToggle} aria-pressed={selected} aria-label={selected ? 'Remove from edit' : 'Add to edit'}
            className={`absolute top-3 right-3 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold ${
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
            {row.submitted_at ? ` · ${formatWhen(row.submitted_at)}` : ''}
          </div>
        </div>
        <div className={`shrink-0 font-vx-mono text-[13px] font-bold vx-num pt-1 ${deltaCls}`}>
          {delta} cr
        </div>
      </div>
      {expiryOn && <AssetRetention row={row} />}
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

function formatWhen(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
