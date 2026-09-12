'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { ASPECT_RATIOS } from '../../_lib/tokens';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged, GatewayError } from '../../_lib/gateway';
import { pushJobHistory } from '../../_lib/jobHistory';
import { useCatalog } from '../../_lib/useCatalog';

// State glyphs — colour-blind safety net matches the design system §08.
const STATE_UI = {
  queued:    { glyph: '●', tone: 'accent',  label: 'QUEUED' },
  running:   { glyph: '●', tone: 'accent',  label: 'RUNNING' },
  succeeded: { glyph: '✓', tone: 'accent',  label: 'DONE' },
  failed:    { glyph: '✕', tone: 'danger',  label: 'FAILED · REFUNDED' },
};

const ERROR_COPY = {
  moderation:            'The provider declined this prompt on safety grounds. Credits refunded.',
  provider_timeout:      'The model took too long. Credits refunded — try again.',
  provider_error:        'The model returned an error. Credits refunded.',
  internal:              'Something on our side broke. Credits refunded.',
  rate_limited:          'Too many generations in a short window. Wait a moment.',
  model_gated:           'This model is not open for generation yet. Nothing was charged.',
  duration_not_supported:'This model only makes 5s clips. Nothing was charged.',
  duration_invalid:      'Pick a 5s or 10s clip. Nothing was charged.',
  insufficient_balance:  'Not enough credits for this generation. Nothing was charged — top up to continue.',
  user_not_provisioned:  'Your account is still being set up. Try again in a moment.',
  debit_rejected:        'The ledger declined this debit. Nothing was charged.',
  no_token:              'Sign in to generate.',
  unauthenticated:       'Sign in to generate.',
};

const DEFAULT_MODEL = 'wan-2.5';

export default function CreateStudio() {
  const { models, live: catalogLive } = useCatalog();
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [duration, setDuration] = useState('5s');
  const [aspect, setAspect] = useState('16:9');
  const [prompt, setPrompt] = useState('A neon-lit Tokyo alley at 3am, low anamorphic tracking shot');

  const [balance, setBalance] = useState(null);
  const [job, setJob] = useState(null);          // { job_id, state, credits, model_id, error_code?, asset_url? }
  const [error, setError] = useState(null);

  const pollRef = useRef(null);

  // ?model=<id> from landing tiles / hero cards. Read once on mount —
  // avoids the Suspense boundary useSearchParams demands on client pages.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wanted = new URLSearchParams(window.location.search).get('model');
    if (wanted) setModelId(wanted);
  }, []);

  // If the selected id isn't in the (live or fallback) catalog, fall back to
  // the first open model so cost never silently reads 0.
  useEffect(() => {
    if (!models.length) return;
    if (models.some((m) => m.id === modelId)) return;
    const first = models.find((m) => !m.gated) || models[0];
    setModelId(first.id);
  }, [models, modelId]);

  const model = models.find((m) => m.id === modelId) || null;
  // Lengths the gateway will actually sell for this model, from the catalog.
  // Rendering anything else offers a price the server then refuses.
  const durations = (model && model.durations && model.durations.length ? model.durations : [5]).map((s) => `${s}s`);
  const cost = model ? model.credits * (duration === '10s' && model.kind === 'video' ? 2 : 1) : 0;
  const durationKey = durations.join(',');
  const generating = job && (job.state === 'queued' || job.state === 'running');

  // A 10s selection must not survive a switch to a model that only sells 5s:
  // the gateway would reject it and the quoted price would have been double.
  useEffect(() => {
    if (!durations.includes(duration)) setDuration(durations[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationKey]);

  // ── balance fetch + focus revalidation ────────────────────────────
  const loadBalance = useCallback(async () => {
    try {
      const b = await gatewayFetch('/balance');
      setBalance(b.balance);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) return;
      setBalance(null);
    }
  }, []);

  useEffect(() => {
    loadBalance();
    const onFocus = () => loadBalance();
    const onBalance = () => loadBalance();
    window.addEventListener('focus', onFocus);
    window.addEventListener('veyrnox:balance-changed', onBalance);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('veyrnox:balance-changed', onBalance);
    };
  }, [loadBalance]);

  // ── poll job state ────────────────────────────────────────────────
  useEffect(() => {
    if (!job || job.state === 'succeeded' || job.state === 'failed') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const next = await gatewayFetch(`/jobs/${job.job_id}`);
        setJob((prev) => prev ? { ...prev, ...next } : prev);
        if (next.state === 'succeeded') {
          const asset = await gatewayFetch(`/jobs/${job.job_id}/asset`);
          setJob((prev) => prev ? { ...prev, asset_url: asset.url, mime_type: asset.mime_type } : prev);
          notifyBalanceChanged();
        } else if (next.state === 'failed') {
          notifyBalanceChanged();
        }
      } catch (e) {
        console.error('[create/poll] failed', e);
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [job?.job_id, job?.state]);

  // ── submit ────────────────────────────────────────────────────────
  async function onSubmit() {
    if (generating || !model || balance == null || cost > balance) return;
    if (model.gated) { setError({ code: 'model_gated' }); return; }
    setError(null);
    const idempotency_key = makeIdempotencyKey();
    const inputs = {
      prompt: prompt.trim(),
      aspect_ratio: aspect,
      duration_seconds: model.kind === 'video' ? Number(duration.replace('s', '')) : undefined,
    };
    // strip undefined so server sees a clean object
    Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);

    try {
      const submitted = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({ model_id: modelId, idempotency_key, inputs }),
      });
      setJob({
        job_id: submitted.job_id,
        state: submitted.state === 'DEBITED' || submitted.state === 'SUBMITTED' ? 'queued' : 'queued',
        credits: cost,
        model_id: modelId,
      });
      pushJobHistory({
        job_id: submitted.job_id,
        model_id: modelId,
        credits: cost,
        prompt: prompt.slice(0, 60),
        name: prompt.slice(0, 40),
      });
      setBalance(submitted.balance_after);
      notifyBalanceChanged();
    } catch (e) {
      if (e instanceof GatewayError) {
        setError({ code: e.code, retryAfter: e.retryAfter });
      } else {
        setError({ code: 'internal' });
      }
    }
  }

  function cancel() {
    setJob(null);
    setError(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance ?? 0} active="create" />

      <div className="max-w-[1500px] mx-auto px-8 pt-6 pb-16 grid grid-cols-[1fr_360px] gap-6">
        {/* ============ CANVAS ============ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">STUDIO · UNTITLED</div>
              <h1 className="text-3xl font-black tracking-[-0.02em] mt-1">Create</h1>
            </div>
            <Chip tone="accent">AUTO-SAVING</Chip>
          </div>

          <div
            className={`relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`}
            style={{ aspectRatio: aspect.replace(':', '/') }}
          >
            {job?.asset_url ? (
              job?.mime_type?.startsWith('video/') ? (
                <video
                  src={job.asset_url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                />
              ) : (
                <img
                  src={job.asset_url}
                  alt="Generated result"
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                />
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                {generating ? (
                  <div className="text-center">
                    <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">
                      <span aria-hidden="true">●</span> {STATE_UI[job.state].label} · {model.name.toUpperCase()}
                    </div>
                    <div className="mt-2 font-vx-mono text-[42px] font-bold vx-num">…</div>
                    <div className="text-xs text-vx-fg-muted mt-2">Refund on failure — always.</div>
                  </div>
                ) : job?.state === 'failed' ? (
                  <div className="text-center max-w-md px-6">
                    <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-danger">
                      <span aria-hidden="true">✕</span> FAILED · REFUNDED
                    </div>
                    <div className="mt-2 text-sm text-vx-fg-body">
                      {ERROR_COPY[job.error_code] || 'Something went wrong. Credits refunded.'}
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full border border-vx-border/60 flex items-center justify-center mx-auto opacity-70">
                      <div className="w-0 h-0 border-l-[16px] border-l-white border-y-[10px] border-y-transparent ml-1" />
                    </div>
                    <div className="mt-3 text-sm text-vx-fg-muted">Type a prompt or pick a preset</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="mt-3 w-full bg-vx-panel border border-vx-border rounded-lg p-3.5 text-sm text-vx-fg placeholder:text-vx-fg-faint resize-none focus:outline-none focus:border-vx-accent"
            placeholder="Describe the shot…"
          />

          {error && (
            <div className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
              <span aria-hidden="true">✕</span>
              <span>
                {ERROR_COPY[error.code] || `Error: ${error.code}`}
                {error.retryAfter && ` Retry in ${error.retryAfter}s.`}
              </span>
            </div>
          )}
        </div>

        {/* ============ CONTROLS ============ */}
        <aside className="flex flex-col gap-5">
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="flex items-baseline justify-between mb-3">
              <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">MODEL</span>
              {catalogLive ? (
                <span className="inline-flex items-center gap-1 font-vx-mono text-[9px] tracking-[0.12em] text-vx-accent">
                  <span aria-hidden="true">●</span> LIVE
                </span>
              ) : (
                <span className="font-vx-mono text-[9px] tracking-[0.12em] text-vx-fg-faint">CACHED</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  aria-pressed={modelId === m.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 border ${
                    modelId === m.id
                      ? 'border-vx-accent bg-vx-accent/[0.07]'
                      : 'border-transparent hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold truncate">{m.name}</span>
                    {m.gated && (
                      <span className="font-vx-mono text-[8.5px] tracking-[0.1em] text-vx-money shrink-0">◆ PREMIUM</span>
                    )}
                    <span className="font-vx-mono text-[8.5px] tracking-[0.1em] text-vx-fg-faint uppercase shrink-0">{m.kind}</span>
                  </span>
                  <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num shrink-0">{m.credits} cr</span>
                </button>
              ))}
            </div>
          </div>

          {model?.kind === 'video' && (
            <>
              {durations.length > 1 && (
                <ControlRow label="DURATION" options={durations} value={duration} onChange={setDuration} />
              )}
              <ControlRow label="ASPECT"   options={ASPECT_RATIOS} value={aspect} onChange={setAspect} />
            </>
          )}

          <div className="mt-2 rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="flex items-baseline justify-between">
              <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">TOTAL COST</span>
              <span className="font-vx-mono text-[12px] text-vx-fg-muted vx-num">
                balance {balance ?? '—'} cr
              </span>
            </div>
            <div className="mt-1 font-vx-mono text-[36px] font-bold text-vx-money vx-num">−{cost} cr</div>
            <button
              onClick={generating ? cancel : onSubmit}
              className="mt-4 w-full flex items-center justify-between bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-vx-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!generating && (!model || model.gated || balance == null || cost > balance)}
            >
              <span>{generating ? 'Cancel' : model?.gated ? 'Premium — gated' : 'Generate'}</span>
              <span className="font-vx-mono text-sm">−{cost} cr</span>
            </button>
            <div className="mt-2 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-fg-faint text-center">
              {model?.gated ? '◆ PREMIUM MODEL · NOT OPEN YET' : 'REFUND ON FAILURE · ALWAYS'}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ControlRow({ label, options, value, onChange }) {
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border ${
              value === o
                ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]'
                : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
