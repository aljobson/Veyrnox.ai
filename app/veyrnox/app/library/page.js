'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { gatewayFetch, GatewayError, notifyBalanceChanged } from '../../_lib/gateway';
import { readJobHistory } from '../../_lib/jobHistory';
import { MODELS } from '../../_lib/tokens';

// Client-side ring buffer supplies the ids; server has no /jobs list yet.
const STATE_UI = {
  queued:    { chip: 'accent', glyph: '●', label: 'QUEUED' },
  running:   { chip: 'accent', glyph: '●', label: 'RUNNING' },
  succeeded: { chip: 'accent', glyph: '✓', label: 'DONE' },
  failed:    { chip: 'danger', glyph: '✕', label: 'FAILED · REFUNDED' },
};

const POLL_MS = 3000;

export default function Library() {
  const [tab, setTab] = useState('all');
  const [balance, setBalance] = useState(null);
  const [rows, setRows] = useState(() => readJobHistory().map(hydrateFromHistory));
  const pollRef = useRef(null);

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

  // initial fetch: hydrate every row's real state; then start a poller for in-flight
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const history = readJobHistory();
      const results = await Promise.all(history.map(async (h) => {
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
            return { ...hydrateFromHistory(h), state: 'failed', error_code: 'internal' };
          }
          return hydrateFromHistory(h);
        }
      }));
      if (!cancelled) setRows(results);
    })();
    return () => { cancelled = true; };
  }, []);

  // poll any in-flight rows
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const hasInFlight = rows.some((r) => r.state === 'queued' || r.state === 'running');
    if (!hasInFlight) return;
    pollRef.current = setInterval(async () => {
      const updates = await Promise.all(rows.map(async (r) => {
        if (r.state !== 'queued' && r.state !== 'running') return r;
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
          return { ...r, ...j };
        } catch { return r; }
      }));
      setRows(updates);
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [rows]);

  const list = tab === 'all' ? rows : rows.filter((r) => r.state === tab);

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance ?? 0} active="library" />

      <section className="max-w-[1400px] mx-auto px-8 pt-10 pb-4">
        <Chip tone="accent" className="mb-3">LIBRARY · YOUR GENERATIONS</Chip>
        <h1 className="text-[40px] font-black tracking-[-0.02em]">Everything you've made</h1>
        <p className="text-vx-fg-body mt-2">
          Failed jobs refund automatically — they still show here so you can retry.
        </p>

        <div className="mt-6 flex gap-2">
          {['all', 'succeeded', 'running', 'queued', 'failed'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
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

      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        {list.length === 0 ? (
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-12 text-center">
            <div className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">EMPTY</div>
            <div className="text-lg font-black mt-2">Nothing here yet.</div>
            <div className="text-sm text-vx-fg-muted mt-1">
              Head to Create and press Generate — jobs will appear here as they run.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((r) => <JobCard key={r.job_id} row={r} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({ row }) {
  const s = STATE_UI[row.state] || STATE_UI.queued;
  const delta = row.state === 'failed' ? `+${row.credits}` : `−${row.credits}`;
  const deltaCls = row.state === 'failed' ? 'text-vx-accent' : 'text-vx-money';
  const model = MODELS.find((m) => m.id === row.model_id);
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
      <div
        className={`h-48 relative ${row.state === 'running' ? 'vx-shimmer' : ''}`}
        style={{ background: row.asset_url ? 'black' : row.bg }}
      >
        {row.asset_url && row.mime_type?.startsWith('video/') && (
          <video src={row.asset_url} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay loop />
        )}
        {row.asset_url && !row.mime_type?.startsWith('video/') && (
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
