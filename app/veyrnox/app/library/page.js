'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { gatewayFetch, GatewayError, notifyBalanceChanged } from '../../_lib/gateway';
import { readJobHistory } from '../../_lib/jobHistory';
import { useCatalog } from '../../_lib/useCatalog';
import { mergeHydrated, shouldPoll } from '../../_lib/jobWindow';

// Client-side ring buffer supplies the ids; server has no /jobs list yet.
const STATE_UI = {
  queued:    { chip: 'accent', glyph: '●', label: 'QUEUED' },
  running:   { chip: 'accent', glyph: '●', label: 'RUNNING' },
  succeeded: { chip: 'accent', glyph: '✓', label: 'DONE' },
  failed:    { chip: 'danger', glyph: '✕', label: 'FAILED · REFUNDED' },
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

  // Must run before the hydrate effect below: mergeHydrated keeps prev's tail.
  useEffect(() => {
    setRows(readJobHistory().map(hydrateFromHistory));
    setHistoryLoaded(true);
  }, []);

  // fetch: hydrate the visible window's real state; then poll the in-flight ones.
  // ponytail: growing the window re-hydrates rows already fetched. That is a
  // click-driven handful of requests; add a hydrated-id set if it ever bites.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const history = readJobHistory();
      const window_ = history.slice(0, visible);
      const results = await Promise.all(window_.map(async (h) => {
        try {
          const j = await gatewayFetch(`/jobs/${h.job_id}`);
          const merged = { ...hydrateFromHistory(h), ...j };
          if (j.state === 'succeeded') {
            try {
              const a = await gatewayFetch(`/jobs/${h.job_id}/asset`);
              return { ...merged, asset_url: a.url, mime_type: a.mime_type };
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
  }, [visible]);

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
              return { ...r, ...j, asset_url: a.url, mime_type: a.mime_type };
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

  const shown = rows.slice(0, visible);
  const list = tab === 'all' ? shown : shown.filter((r) => r.state === tab);
  const hasMore = rows.length > visible;

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="library" />

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
            {list.map((r) => <JobCard key={r.job_id} row={r} models={models} />)}
          </div>
        )}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => setVisible((v) => v + PAGE)}
              className="font-vx-mono text-[11px] tracking-[0.12em] font-bold rounded-full px-5 py-2.5 border border-vx-border bg-vx-panel text-vx-fg hover:text-vx-fg"
            >
              LOAD MORE · {rows.length - visible} OLDER
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({ row, models }) {
  const s = STATE_UI[row.state] || STATE_UI.queued;
  // No delta for `unknown`: a +N would claim a refund landed and a −N would
  // claim the debit stands, and we do not know which.
  const delta = row.state === 'unknown' ? '' : row.state === 'failed' ? `+${row.credits}` : `−${row.credits}`;
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
          <video src={row.asset_url} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay loop />
        )}
        {row.asset_url && row.mime_type?.startsWith('audio/') && (
          <div className="absolute inset-0 flex items-end px-4 pb-4">
            <audio src={row.asset_url} controls className="w-full" />
          </div>
        )}
        {row.asset_url && row.mime_type?.startsWith('image/') && (
          <img src={row.asset_url} alt={row.name || 'generation'} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute top-3 left-3">
          <Chip tone={s.chip} noGlyph>
            <span aria-hidden="true" className="text-[10px] mr-1">{s.glyph}</span>
            {s.label}
          </Chip>
        </div>
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
