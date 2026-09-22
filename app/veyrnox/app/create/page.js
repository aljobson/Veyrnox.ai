'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { ASPECT_RATIOS } from '../../_lib/tokens';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged, GatewayError } from '../../_lib/gateway';
import { ERROR_COPY } from '../../_lib/createErrors';
import { pushJobHistory, markJobSettled } from '../../_lib/jobHistory';
import { useCatalog } from '../../_lib/useCatalog';
import { DEFAULT_CINEMA, buildCinemaPrompt } from '../../_lib/cinema';
import { CameraPanel } from '../../_components/CameraPanel';
import { CharacterPanel } from '../../_components/CharacterPanel';
import { buildCharacterPrompt } from '../../_lib/character';
import { DrawOnImage } from '../../_components/DrawOnImage';
import { SourcePickers } from '../../_components/SourcePickers';
import { ParticleButton } from '@/components/ParticleButton';

// State glyphs — colour-blind safety net matches the design system §08.
const STATE_UI = {
  queued:    { glyph: '●', tone: 'accent',  label: 'QUEUED' },
  running:   { glyph: '●', tone: 'accent',  label: 'RUNNING' },
  succeeded: { glyph: '✓', tone: 'accent',  label: 'DONE' },
  failed:    { glyph: '✕', tone: 'danger',  label: 'FAILED · REFUNDED' },
};

// How many consecutive poll failures before we stop and tell the user. At
// 2s an interval that is ~1 minute of silence, which is long enough to ride
// out a blip and short enough that nobody watches a dead shimmer.
const POLL_GIVE_UP_AFTER = 30;



const DEFAULT_MODEL = 'wan-2.5';

// Models measured well over a minute end to end in live tests (2026-09-13).
// ponytail: hand-kept list; move to the catalog if more slow models land.
const SLOW_MODEL_WAIT = {
  'ace-step-1.5': 'Music takes about 3–4 minutes.',
  'mmaudio-v2': 'Sound effects take about 3 minutes.',
  'seedance-2.0-fast': 'Video takes about 2 minutes.',
  'auto-short-32s': 'About 2–10 minutes: script, voiceover, four scenes, then the stitch.',
};

// Auto Short stays hidden until launch unless this browser opts in
// (CLAUDE.md "Delivery": new user paths behind localStorage.veyrnox_*).
const AUTO_SHORT_FLAG = 'veyrnox_auto_short';

function readFlag(name) {
  try { return window.localStorage.getItem(name) === '1'; } catch { return false; }
}

export default function CreateStudio() {
  const { models: catalogModels, live: catalogLive, loading: catalogLoading } = useCatalog();
  const [autoShortOn, setAutoShortOn] = useState(false);
  useEffect(() => { setAutoShortOn(readFlag(AUTO_SHORT_FLAG)); }, []);
  const models = autoShortOn ? catalogModels : catalogModels.filter((m) => !m.takesTopic);
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [duration, setDuration] = useState('5s');
  const [aspect, setAspect] = useState('16:9');
  const [prompt, setPrompt] = useState('A neon-lit Tokyo alley at 3am, low anamorphic tracking shot');
  // Start image for models whose catalog capabilities declare an image slot.
  // Uploads for the model's media slots: { image|video|audio: { file, previewUrl } }.
  const [sources, setSources] = useState({});
  const [drawing, setDrawing] = useState(false);
  const [cinemaOn, setCinemaOn] = useState(false);
  const [cinema, setCinema] = useState(DEFAULT_CINEMA);
  const [characterOn, setCharacterOn] = useState(false);
  const [character, setCharacter] = useState({});

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
  // the first open model so cost never silently reads 0. Wait for the live
  // catalog first: the tokens.js fallback it starts from lacks newer models,
  // and resetting against it threw away any ?model= it didn't list.
  useEffect(() => {
    if (catalogLoading || !models.length) return;
    if (models.some((m) => m.id === modelId)) return;
    const first = models.find((m) => !m.gated) || models[0];
    setModelId(first.id);
  }, [models, modelId, catalogLoading]);

  const model = models.find((m) => m.id === modelId) || null;
  // Lengths the gateway will actually sell for this model, from the catalog.
  // Rendering anything else offers a price the server then refuses.
  const durations = (model && model.durations && model.durations.length ? model.durations : [5]).map((s) => `${s}s`);
  const media = model?.media || {};
  const missingSource = Object.entries(media).some(([slot, spec]) => spec.required && !sources[slot]);
  // Camera text suits pictures and clips; audio and speech would read it aloud.
  const isShort = !!model?.takesTopic;
  const takesCamera = !isShort && (model?.kind === 'image' || model?.kind === 'video');
  // The model's own aspect list when the catalog has one; every video takes the default set.
  const aspectOptions = isShort ? []
    : model?.aspects ? ASPECT_RATIOS.filter((a) => model.aspects.includes(a))
    : model?.kind === 'video' ? ASPECT_RATIOS : [];
  const cost = model ? model.credits * (duration === '10s' && model.kind === 'video' ? 2 : 1) : 0;
  const durationKey = durations.join(',');
  const generating = job && (job.state === 'queued' || job.state === 'running');
  // `generating` is derived from `job`, which is only set AFTER the await in
  // onSubmit. Between the click and that setState the button stayed enabled,
  // so a second click minted a second idempotency key — a legitimately new
  // job to ledger_debit, and a second debit. The server is idempotent per
  // key; the client was defeating it by changing the key.
  const inFlight = useRef(false);

  // A 10s selection must not survive a switch to a model that only sells 5s:
  // the gateway would reject it and the quoted price would have been double.
  useEffect(() => {
    if (!durations.includes(duration)) setDuration(durations[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationKey]);

  function pickSource(slot, file) {
    setSources((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot].previewUrl);
      const next = { ...prev };
      if (file) next[slot] = { file, previewUrl: URL.createObjectURL(file) };
      else delete next[slot];
      return next;
    });
  }

  function applyDrawing(file) {
    setDrawing(false);
    pickSource('image', file);
  }

  // The browser PUTs the file straight to R2 on a 15-minute URL the gateway
  // signed (ADR-0028); the generation then names it by key, never by URL.
  async function uploadSource(file) {
    const up = await gatewayFetch('/uploads', {
      method: 'POST',
      body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
    });
    let put;
    try {
      put = await fetch(up.upload_url, { method: 'PUT', headers: { 'Content-Type': up.content_type }, body: file });
    } catch {
      throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' });
    }
    if (!put.ok) throw new GatewayError('upload_failed', { status: put.status, code: 'upload_failed' });
    return up.key;
  }

  useEffect(() => {
    if (aspectOptions.length && !aspectOptions.includes(aspect)) setAspect(aspectOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectOptions.join(',')]);

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
    // Consecutive failures used to be swallowed forever: offline or against a
    // 500 the shimmer span at 2s intervals with no error and no end, and each
    // failed call re-dispatched veyrnox:auth-required, so a dismissed sign-in
    // modal reappeared every 2 seconds indefinitely. Give up like TopUpPacks
    // already does.
    let failures = 0;
    pollRef.current = setInterval(async () => {
      try {
        const next = await gatewayFetch(`/jobs/${job.job_id}`);
        failures = 0;
        setJob((prev) => prev ? { ...prev, ...next } : prev);
        if (next.state === 'succeeded' || next.state === 'failed') markJobSettled(job.job_id, next.state);
        if (next.state === 'succeeded') {
          const asset = await gatewayFetch(`/jobs/${job.job_id}/asset`);
          setJob((prev) => prev ? { ...prev, asset_url: asset.url, mime_type: asset.mime_type } : prev);
          notifyBalanceChanged();
        } else if (next.state === 'failed') {
          notifyBalanceChanged();
        }
      } catch (e) {
        failures += 1;
        console.error('[create/poll] failed', e);
        if (failures >= POLL_GIVE_UP_AFTER) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setError({ code: 'poll_unreachable' });
        }
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [job?.job_id, job?.state]);

  // Character traits go first, the camera description last; each keeps the
  // result under the gateway's 2000-character limit by cutting the user text.
  function finalPrompt() {
    let text = prompt.trim();
    if (model.kind === 'image' && characterOn) text = buildCharacterPrompt(text, character);
    if (takesCamera && cinemaOn) text = buildCinemaPrompt(text, cinema);
    return text;
  }

  // ── submit ────────────────────────────────────────────────────────
  async function onSubmit() {
    if (inFlight.current || generating || !model || balance == null || cost > balance) return;
    inFlight.current = true;
    if (model.gated) { inFlight.current = false; setError({ code: 'model_gated' }); return; }
    if (missingSource) { inFlight.current = false; setError({ code: 'source_required' }); return; }
    setError(null);
    const idempotency_key = makeIdempotencyKey();
    // An Auto Short takes only its topic; the pipeline picks the format.
    const inputs = isShort ? { topic: prompt.trim() } : {
      prompt: finalPrompt(),
      aspect_ratio: aspect,
      duration_seconds: model.kind === 'video' ? Number(duration.replace('s', '')) : undefined,
    };
    // strip undefined so server sees a clean object
    Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);

    try {
      // Only the slots this model takes; a leftover upload from another model stays local.
      const source_keys = [];
      for (const slot of Object.keys(media)) {
        if (sources[slot]) source_keys.push(await uploadSource(sources[slot].file));
      }
      const submitted = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({ model_id: modelId, idempotency_key, inputs, source_keys: source_keys.length ? source_keys : undefined }),
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
    } finally {
      inFlight.current = false;
    }
  }

  // Leaves the running job to finish in the background (JobWatcher announces
  // it); the charge stands, so this never claimed to cancel anything.
  function cancel() {
    setJob(null);
    setError(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="create" />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-8 pt-6 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        {/* ============ CANVAS ============ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">STUDIO · UNTITLED</div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-[-0.02em] mt-1">Create</h1>
            </div>
            <Chip tone="accent">AUTO-SAVING</Chip>
          </div>

          <div
            className={`relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`}
            style={{ aspectRatio: (isShort ? '9:16' : aspect).replace(':', '/') }}
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
              ) : job?.mime_type?.startsWith('audio/') ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black px-8">
                  <audio src={job.asset_url} controls autoPlay className="w-full max-w-xl" />
                </div>
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
                    {SLOW_MODEL_WAIT[model.id] && (
                      <div className="text-xs text-vx-fg-body mt-2">{SLOW_MODEL_WAIT[model.id]}</div>
                    )}
                    <div className="text-xs text-vx-fg-muted mt-2">Keeps running if you leave or start another — we'll tell you when it's ready. Refund on failure, always.</div>
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
                      <div className="w-0 h-0 border-l-[16px] border-l-vx-fg-muted border-y-[10px] border-y-transparent ml-1" />
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
            aria-label={isShort ? 'Topic' : 'Prompt'}
            maxLength={isShort ? 200 : undefined}
            rows={3}
            className="mt-3 w-full bg-vx-panel border border-vx-border rounded-lg p-3.5 text-sm text-vx-fg placeholder:text-vx-fg-faint resize-none focus:outline-none focus:border-vx-accent"
            placeholder={isShort ? 'A topic for a 32-second short, e.g. 3 facts about octopuses' : 'Describe the shot…'}
          />

          <SourcePickers media={media} sources={sources} onPick={pickSource}
            onDraw={model?.kind === 'image' ? () => setDrawing(true) : null} />

          {drawing && sources.image && (
            <DrawOnImage file={sources.image.file} onDone={applyDrawing} onCancel={() => setDrawing(false)} />
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
              <span aria-hidden="true">✕</span>
              <span>
                {ERROR_COPY[error.code] || 'Something went wrong. Nothing was charged unless the panel above says otherwise.'}
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
                      : 'border-transparent hover:bg-vx-fg/[0.04]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold truncate">{m.name}</span>
                    {m.gated && (
                      <span className="font-vx-mono text-[10px] tracking-[0.1em] text-vx-money shrink-0">◆ PREMIUM</span>
                    )}
                    <span className="font-vx-mono text-[10px] tracking-[0.1em] text-vx-fg-faint uppercase shrink-0">{m.kind}</span>
                  </span>
                  <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num shrink-0">{m.credits} cr</span>
                </button>
              ))}
            </div>
          </div>

          {model?.kind === 'video' && durations.length > 1 && (
            <ControlRow label="DURATION" options={durations} value={duration} onChange={setDuration} />
          )}
          {aspectOptions.length > 0 && (
            <ControlRow label="ASPECT" options={aspectOptions} value={aspect} onChange={setAspect} />
          )}

          {model?.kind === 'image' && (
            <CharacterPanel enabled={characterOn} onToggle={setCharacterOn} picks={character} onChange={setCharacter} />
          )}

          {takesCamera && (
            <CameraPanel enabled={cinemaOn} onToggle={setCinemaOn} settings={cinema} onChange={setCinema} />
          )}

          <div className="mt-2 rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="flex items-baseline justify-between">
              <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">TOTAL COST</span>
              <span className="font-vx-mono text-[12px] text-vx-fg-muted vx-num">
                balance {balance ?? '—'} cr
              </span>
            </div>
            <div className="mt-1 font-vx-mono text-[36px] font-bold text-vx-money vx-num">−{cost} cr</div>
            <ParticleButton
              onClick={generating ? cancel : onSubmit}
              className="mt-4 w-full flex items-center justify-between bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-vx-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!generating && (!model || model.gated || balance == null || cost > balance || missingSource)}
            >
              <span>{generating ? 'New generation' : model?.gated ? 'Premium — gated' : 'Generate'}</span>
              <span className="font-vx-mono text-sm">−{cost} cr</span>
            </ParticleButton>
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
