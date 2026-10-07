'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { ASPECT_RATIOS } from '../../_lib/tokens';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged, GatewayError } from '../../_lib/gateway';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { pushJobHistory } from '../../_lib/jobHistory';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { StudioJobGrid } from '../../_components/StudioJobGrid';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { IMAGE_COUNTS, takesImageCount, imageCount, totalCost, inputsForIndex, batchNote, sendInOrder, submitErrorCode } from '../../_lib/imageBatch';
import { useCatalog } from '../../_lib/useCatalog';
import { useFreeAllowance } from '../../_lib/useFreeAllowance';
import { freeCost, freeLeftFor } from '../../_lib/freeAllowance';
import { takeStudioDraft } from '../../_lib/landingDraft';
import { templateStartId } from '../../../../lib/templateStart';
import { DEFAULT_CINEMA, buildCinemaPrompt } from '../../_lib/cinema';
import { CameraPanel } from '../../_components/CameraPanel';
import { CharacterPanel } from '../../_components/CharacterPanel';
import { buildCharacterPrompt } from '../../_lib/character';
import { DrawOnImage } from '../../_components/DrawOnImage';
import { SourcePickers } from '../../_components/SourcePickers';
import { LibraryPicker } from '../../_components/LibraryPicker';
import { GenerationSettings } from '../../_components/GenerationSettings';
import { ControlRow } from '../../_components/ControlRow';
import { TIERS, TIER_LABEL, filterByTier } from '../../_lib/modelTiers';
import { settingsInputs } from '../../_lib/generationSettings';
import { ParticleButton } from '@/components/ParticleButton';
import { jobStateUi, SLOW_MODEL_WAIT } from '../../_lib/studioStates';
const DEFAULT_MODEL = 'wan-2.5-kie';
// Auto Short stays hidden until launch unless this browser opts in
// (CLAUDE.md "Delivery": new user paths behind localStorage.veyrnox_*).
const AUTO_SHORT_FLAG = 'veyrnox_auto_short';

function readFlag(name) {
  try { return window.localStorage.getItem(name) === '1'; } catch { return false; }
}

function errorFor(e) {
  return e instanceof GatewayError ? { code: e.code, retryAfter: e.retryAfter } : { code: 'internal' };
}

// Off on the server and first paint, then whatever this browser has stored.
const never = () => () => {};
const autoShortFlag = () => readFlag(AUTO_SHORT_FLAG);
const off = () => false;

export default function CreateStudio() {
  const { models: catalogModels, live: catalogLive, loading: catalogLoading } = useCatalog();
  const freeMap = useFreeAllowance(); // ADR-0069: free jobs left today per model; empty while the feature is off
  const autoShortOn = useSyncExternalStore(never, autoShortFlag, off);
  const models = catalogModels.filter((m) => !m.isEdit && (autoShortOn || !m.takesTopic));
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [presetParam, setPresetParam] = useState(null);
  const [tier, setTier] = useState(null);
  const [duration, setDuration] = useState('5s');
  const [aspect, setAspect] = useState('16:9');
  const [prompt, setPrompt] = useState('A neon-lit Tokyo alley at 3am, low anamorphic tracking shot');
  // Start image for models whose catalog capabilities declare an image slot.
  // Sources for the model's media slots: { image|video|audio: { file, previewUrl } },
  // or { assetId, previewUrl, label } for an image picked from the Library.
  const [sources, setSources] = useState({});
  const [libraryFor, setLibraryFor] = useState(null);
  const [drawing, setDrawing] = useState(false);
  // Uploads can carry a real face or voice: the AUP consent statement is
  // required before one is sent, and the gateway records it on the job (0096).
  const [consent, setConsent] = useState(false);
  const [cinemaOn, setCinemaOn] = useState(false);
  const [cinema, setCinema] = useState(DEFAULT_CINEMA);
  const [seed, setSeed] = useState('');
  const [negative, setNegative] = useState('');
  const [characterOn, setCharacterOn] = useState(false);
  const [character, setCharacter] = useState({});
  const [count, setCount] = useState(1);

  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const onUnreachable = useCallback(() => setError({ code: 'poll_unreachable' }), []);
  const { jobs, generating, startJobs, addJob, clearJobs } = useStudioJobs({ onUnreachable });
  const job = jobs.length === 1 ? jobs[0] : null;
  // True while a batch is still being sent, so New generation cannot clear it halfway.
  const [sending, setSending] = useState(false);

  // ?model=<id> from landing tiles / hero cards. Read once on mount —
  // avoids the Suspense boundary useSearchParams demands on client pages.
  // ?duration=10s and the prompt come from the landing price slip; the
  // duration effect below drops a length the model does not sell.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('model');
    if (wanted) setModelId(wanted);
    setPresetParam(params.get('preset')); // a template's id, from its studio link; sent only while its own model is selected
    if (params.get('duration') === '10s') setDuration('10s');
    const draft = takeStudioDraft(window.sessionStorage, wanted);
    if (draft) setPrompt(draft.prompt);
    if (draft?.aspect) setAspect(draft.aspect);
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
  // The picked model stays listed even when the tier filter would hide it.
  const listed = filterByTier(models, tier);
  const visibleModels = model && !listed.includes(model) ? [model, ...listed] : listed;
  // Lengths the gateway will actually sell for this model, from the catalog.
  // Rendering anything else offers a price the server then refuses.
  const durations = (model && model.durations && model.durations.length ? model.durations : [5]).map((s) => `${s}s`);
  const media = model?.media || {};
  const missingSource = Object.entries(media).some(([slot, spec]) => spec.required && !sources[slot]);
  const hasUpload = Object.keys(media).some((slot) => sources[slot]);
  const missingConsent = hasUpload && !consent;
  // Camera text suits pictures and clips; audio and speech would read it aloud.
  const isShort = !!model?.takesTopic;
  const takesCamera = !isShort && (model?.kind === 'image' || model?.kind === 'video');
  // The model's own aspect list when the catalog has one; every video takes the default set.
  const aspectOptions = isShort ? []
    : model?.aspects ? ASPECT_RATIOS.filter((a) => model.aspects.includes(a))
    : model?.kind === 'video' ? ASPECT_RATIOS : [];
  const unitCost = model ? model.credits * (duration === '10s' && model.kind === 'video' ? 2 : 1) : 0;
  // Other models always send one; the count control is image-only.
  const n = imageCount(model, count);
  // The server decides what is free; the first `freeLeft` jobs of a batch are, the rest cost the catalog price.
  const freeLeft = freeLeftFor(freeMap, modelId);
  const cost = freeLeft > 0 ? freeCost(unitCost, n, freeLeft) : totalCost(unitCost, n);
  const durationKey = durations.join(',');
  // `generating` is derived from `jobs`, which is only set AFTER the await in
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
  }, [durationKey, duration]);

  function pickSource(slot, file, asset = null) {
    setSources((prev) => {
      if (prev[slot]?.file) URL.revokeObjectURL(prev[slot].previewUrl);
      const next = { ...prev };
      if (file) next[slot] = { file, previewUrl: URL.createObjectURL(file) };
      else if (asset) next[slot] = { assetId: asset.id, previewUrl: asset.url, label: asset.label };
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
      put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers || { 'Content-Type': up.content_type }, body: file });
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

  // Character traits go first, the camera description last; each keeps the
  // result under the gateway's 2000-character limit by cutting the user text.
  function finalPrompt() {
    let text = prompt.trim();
    if (model.kind === 'image' && characterOn) text = buildCharacterPrompt(text, character);
    if (takesCamera && cinemaOn) text = buildCinemaPrompt(text, cinema);
    return text;
  }

  // ── submit ────────────────────────────────────────────────────────
  // N images are N separate generations: each its own key, debit, refund path
  // and job. Sent one at a time; the first failure stops the rest, and none is
  // ever retried under a new key.
  async function onSubmit() {
    if (inFlight.current || sending || generating || !model || balance == null || cost > balance) return;
    inFlight.current = true;
    if (model.gated) { inFlight.current = false; setError({ code: 'model_gated' }); return; }
    if (missingSource) { inFlight.current = false; setError({ code: 'source_required' }); return; }
    if (missingConsent) { inFlight.current = false; setError({ code: 'consent_required' }); return; }
    setError(null);
    setSending(true);
    const keys = Array.from({ length: n }, () => makeIdempotencyKey());
    // An Auto Short takes only its topic; the pipeline picks the format.
    const inputs = isShort ? { topic: prompt.trim() } : {
      prompt: finalPrompt(),
      aspect_ratio: aspect,
      duration_seconds: model.kind === 'video' ? Number(duration.replace('s', '')) : undefined,
      ...settingsInputs(model, { seed, negative }),
    };
    // strip undefined so server sees a clean object
    Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);

    try {
      // Only the slots this model takes; a leftover upload from another model stays local.
      // Each file is uploaded once and its key reused by every request.
      const source_keys = [];
      const source_assets = [];
      for (const slot of Object.keys(media)) {
        if (sources[slot]?.assetId) source_assets.push(sources[slot].assetId);
        else if (sources[slot]) source_keys.push(await uploadSource(sources[slot].file));
      }
      const anySource = source_keys.length + source_assets.length > 0;
      const { started, error: failure } = await sendInOrder(n, async (i) => {
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: modelId, idempotency_key: keys[i], inputs: inputsForIndex(inputs, i, n),
            preset: templateStartId(presetParam, modelId) || undefined,
            source_keys: source_keys.length ? source_keys : undefined,
            source_assets: source_assets.length ? source_assets : undefined,
            consent: anySource ? true : undefined,
          }),
        });
        // A job that took a free allowance (ADR-0069) cost nothing; the server says so.
        const jobCredits = submitted.free_allowance === true ? 0 : unitCost;
        // The first accepted job replaces the previous click's jobs.
        (i === 0 ? startJobs : addJob)({ job_id: submitted.job_id, state: 'queued', credits: jobCredits, model_id: modelId });
        pushJobHistory({
          job_id: submitted.job_id,
          model_id: modelId,
          credits: jobCredits,
          prompt: prompt.slice(0, 60),
          name: prompt.slice(0, 40),
        });
        if (submitted.balance_after != null) setBalance(submitted.balance_after);
      });
      if (started > 0) notifyBalanceChanged();
      if (failure) {
        const err = errorFor(failure);
        const code = submitErrorCode(err.code);
        setError({ ...err, code, note: batchNote(started, n, code) });
      }
    } catch (e) {
      setError(errorFor(e));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  // Leaves the running jobs to finish in the background (JobWatcher announces
  // them); the charge stands, so this never claimed to cancel anything.
  function cancel() {
    clearJobs();
    setError(null);
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
            <Chip tone="accent">UNSAVED DRAFT</Chip>
          </div>

          {jobs.length > 1 ? <StudioJobGrid jobs={jobs} aspect={aspect} /> : (
            <div
              className={`relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`}
              style={{ aspectRatio: (isShort ? '9:16' : aspect).replace(':', '/') }}
            >
              {job?.asset_url ? (
                <JobAssetPreview job={job} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  {generating ? (
                    <div className="text-center">
                      <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">
                        <span aria-hidden="true">●</span> {jobStateUi(job).label} · {model.name.toUpperCase()}
                      </div>
                      <div className="mt-2 font-vx-mono text-[42px] font-bold vx-num">…</div>
                      {SLOW_MODEL_WAIT[model.id] && (
                        <div className="text-xs text-vx-fg-body mt-2">{SLOW_MODEL_WAIT[model.id]}</div>
                      )}
                      <div className="text-xs text-vx-fg-muted mt-2">Keeps running if you leave or start another — we&apos;ll tell you when it&apos;s ready. Refund on failure, always.</div>
                    </div>
                  ) : job?.state === 'failed' ? (
                    <div className="text-center max-w-md px-6">
                      <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-danger">
                        <span aria-hidden="true">✕</span> {jobStateUi(job).label}
                      </div>
                      <div className="mt-2 text-sm text-vx-fg-body">
                        {failedJobCopy(job)}
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
          )}

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label={isShort ? 'Topic' : 'Prompt'}
            maxLength={isShort ? 200 : undefined}
            rows={3}
            className="mt-3 w-full bg-vx-panel border border-vx-border rounded-lg p-3.5 text-sm text-vx-fg placeholder:text-vx-fg-faint resize-none focus:outline-none focus:border-vx-accent"
            placeholder={isShort ? 'A topic for a 32-second short, e.g. 3 facts about octopuses'
              : model?.id === 'elevenlabs-dialogue' ? 'One line per speaker, e.g.' + '\n' + 'Ana: Did you hear that?' + '\n' + 'Ben: [whispers] Stay quiet.'
              : 'Describe the shot…'}
          />

          {!isShort && (
            <p className="mt-2 text-xs text-vx-fg-muted">
              Need help? Ask a Studio skill (1 Credit a reply):{' '}
              <Link href="/app/chat?skill=prompt-writer" className="text-vx-accent hover:underline">Prompt writer</Link>,{' '}
              <Link href="/app/chat?skill=fix-my-prompt" className="text-vx-accent hover:underline">Fix my prompt</Link>,{' '}
              <Link href="/app/chat?skill=model-picker" className="text-vx-accent hover:underline">Model picker</Link> or{' '}
              <Link href="/app/chat" className="text-vx-accent hover:underline">all skills</Link>.
            </p>
          )}

          <SourcePickers media={media} sources={sources} onPick={pickSource}
            onDraw={model?.kind === 'image' ? () => setDrawing(true) : null} onLibrary={setLibraryFor} />
          {libraryFor && (
            <LibraryPicker onClose={() => setLibraryFor(null)}
              onPick={(item) => { pickSource(libraryFor, null, item); setLibraryFor(null); }} />
          )}

          {hasUpload && (
            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-vx-border bg-vx-panel px-4 py-3 text-sm text-vx-fg-body cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-vx-accent"
              />
              <span>
                I own this file, or I have the permission of everyone identifiable in it. No real person&apos;s face, body or
                voice is used without their consent, and I hold the rights to any brand, artwork or recording in it
                (<a href="/legal/aup" target="_blank" rel="noreferrer" className="text-vx-accent underline">Acceptable Use</a>).
                This statement is recorded against the generation and your account.
              </span>
            </label>
          )}

          {drawing && sources.image?.file && (
            <DrawOnImage file={sources.image.file} onDone={applyDrawing} onCancel={() => setDrawing(false)} />
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
              <span aria-hidden="true">✕</span>
              <span>
                {ERROR_COPY[error.code] || 'Something went wrong. Nothing was charged unless the panel above says otherwise.'}
                {error.retryAfter && ` Retry in ${error.retryAfter}s.`}
                {error.note && ` ${error.note}`}
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
            <div className="flex gap-1.5 mb-3" role="group" aria-label="Price tier">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(tier === t ? null : t)}
                  aria-pressed={tier === t}
                  className={`rounded-full px-3 py-1 border font-vx-mono text-[10px] tracking-[0.1em] uppercase ${
                    tier === t ? 'border-vx-accent text-vx-accent' : 'border-vx-fg/15 text-vx-fg-muted hover:bg-vx-fg/[0.04]'
                  }`}
                >
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {visibleModels.map((m) => (
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
                  {freeLeftFor(freeMap, m.id) > 0
                    ? <span className="font-vx-mono text-[12px] font-bold text-vx-accent shrink-0">FREE · {freeLeftFor(freeMap, m.id)} left</span>
                    : <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num shrink-0">{m.credits} cr</span>}
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
          {takesImageCount(model) && (
            <ControlRow label="IMAGES" options={IMAGE_COUNTS} value={count} onChange={setCount} />
          )}

          {model?.kind === 'image' && (
            <CharacterPanel enabled={characterOn} onToggle={setCharacterOn} picks={character} onChange={setCharacter} />
          )}

          {!isShort && (
            <GenerationSettings model={model} seed={seed} onSeed={setSeed} negative={negative} onNegative={setNegative} />
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
            {freeLeft > 0 && (
              <div role="status" className="mt-1 font-vx-mono text-[11px] tracking-[0.08em] text-vx-accent">
                {n > freeLeft ? `FREE · ${freeLeft} OF ${n} · ${freeLeft} LEFT TODAY` : `FREE · ${freeLeft} LEFT TODAY`}
              </div>
            )}
            <ParticleButton
              onClick={generating ? cancel : onSubmit}
              className="mt-4 w-full flex items-center justify-between bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-vx-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={sending || (!generating && (!model || model.gated || balance == null || cost > balance || missingSource || missingConsent))}
              aria-label={sending || generating || model?.gated ? undefined : `Generate ${n > 1 ? `${n} images ` : ''}for ${cost} credits`}
            >
              <span>{sending ? 'Sending…' : generating ? 'New generation' : model?.gated ? 'Premium — gated' : n > 1 ? `Generate ${n}` : 'Generate'}</span>
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
