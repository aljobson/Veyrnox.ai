'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { Button } from '../../_components/Button';
import { Chip } from '../../_components/Chip';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { DownloadAsset } from '../../_components/DownloadAsset';
import { DownloadProvenance } from '../../_components/DownloadProvenance';
import { OutputFileDisclosure } from '../../_components/OutputFileDisclosure';
import { SaveToAudioShelfButton } from '../../_components/SaveToAudioShelfButton';
import { LibraryPicker } from '../../_components/LibraryPicker';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { gatewayFetch, GatewayError, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';
import { pushJobHistory } from '../../_lib/jobHistory';
import { jobStateUi } from '../../_lib/studioStates';
import { useCatalog } from '../../_lib/useCatalog';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import {
  DIALOGUE_MODES,
  DIALOGUE_MODEL_ID,
  DIALOGUE_VOICES,
  PHOTO_DIALOGUE_MODEL_ID,
  PHOTO_DIALOGUE_VOICES,
  MAX_PHOTO_DIALOGUE_SECONDS,
  MAX_DIALOGUE_CHARS,
  MAX_DIALOGUE_TURNS,
  estimatedDialogueSeconds,
  moveDialogueTurn,
  validatePhotoDialogueTurns,
  validateDialogueTurns,
} from '../../_lib/dialogueStudio';
import { readDialogueDraft } from '../../_lib/dialogueDraft';
import { writeDialogueDubbingHandoff } from '../../_lib/dialogueDubbingHandoff';
import {
  dialogueCastInputs,
  forgetDialogueCastSpeakers,
  readDialogueCastMap,
  resolveDialogueCastAssignments,
  setDialogueCastVoice,
} from '../../_lib/dialogueCastMap';
import {
  bindProjectCastPortrait,
  projectCastTurns,
  readProjectCasts,
  removeProjectCast,
  saveProjectCast,
  unbindProjectCastPortrait,
} from '../../_lib/projectCasts';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';
const field = 'w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden';
const initialTurns = [
  { id: 1, speaker: 'Ana', text: '' },
  { id: 2, speaker: 'Ben', text: '' },
];

function TurnCard({ turn, index, total, voice, side, onChange, onMove, onRemove, disabled }) {
  return (
    <article className="rounded-xl border border-vx-border bg-vx-base p-4" aria-label={`Dialogue turn ${index + 1}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full border border-vx-accent/50 bg-vx-accent/[0.08] font-vx-mono text-[10px] font-black text-vx-accent">{side}</span>
          <div>
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-accent">TURN {String(index + 1).padStart(2, '0')}</p>
            <p className="mt-0.5 text-[10px] text-vx-fg-muted">{voice ? `Stock voice · ${voice}` : 'Name the speaker to assign a stock voice'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={disabled || index === 0} onClick={() => onMove(index, -1)} className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold hover:border-vx-accent disabled:opacity-30" aria-label={`Move turn ${index + 1} up`}>↑</button>
          <button type="button" disabled={disabled || index === total - 1} onClick={() => onMove(index, 1)} className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold hover:border-vx-accent disabled:opacity-30" aria-label={`Move turn ${index + 1} down`}>↓</button>
          <button type="button" disabled={disabled || total <= 2} onClick={() => onRemove(turn.id)} className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold text-vx-danger hover:border-vx-danger disabled:opacity-30">Remove</button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <label className="text-xs font-bold text-vx-fg-muted">
          SPEAKER
          <input className={`${field} mt-2`} value={turn.speaker} maxLength={30} disabled={disabled} onChange={(event) => onChange(turn.id, 'speaker', event.target.value)} placeholder="Ana" />
        </label>
        <label className="text-xs font-bold text-vx-fg-muted">
          <span className="flex items-center justify-between gap-3"><span>WORDS</span><span className="font-vx-mono font-normal text-vx-fg-faint">{turn.text.length} chars</span></span>
          <textarea className={`${field} mt-2 min-h-20 resize-y`} value={turn.text} disabled={disabled} onChange={(event) => onChange(turn.id, 'text', event.target.value)} placeholder="Write exactly what this speaker says…" />
        </label>
      </div>
    </article>
  );
}

export default function DialogueStudio() {
  const { models, live, loading: catalogLoading } = useCatalog();
  const [modeId, setModeId] = useState('audio-script');
  const [turns, setTurns] = useState(initialTurns);
  const [portrait, setPortrait] = useState(null);
  const [scene, setScene] = useState('Two consenting adults sit together in a natural conversation, looking toward each other as they speak.');
  const [voice1, setVoice1] = useState('Sarah');
  const [voice2, setVoice2] = useState('Roger');
  const [castMap, setCastMap] = useState([]);
  const [projectCasts, setProjectCasts] = useState([]);
  const [projectCastName, setProjectCastName] = useState('');
  const [pendingCastId, setPendingCastId] = useState(null);
  const [portraitTarget, setPortraitTarget] = useState(null);
  const [consent, setConsent] = useState(false);
  const [balance, setBalance] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const nextId = useRef(3);
  const inFlight = useRef(false);
  const audioModel = models.find((item) => item.id === DIALOGUE_MODEL_ID) || null;
  const photoModel = models.find((item) => item.id === PHOTO_DIALOGUE_MODEL_ID) || null;
  const model = modeId === 'photo-dialogue' ? photoModel : audioModel;
  const audioValidation = useMemo(() => validateDialogueTurns(turns), [turns]);
  const photoValidation = useMemo(() => validatePhotoDialogueTurns(turns), [turns]);
  const validation = modeId === 'photo-dialogue' ? photoValidation : audioValidation;
  const audioAssignments = useMemo(() => resolveDialogueCastAssignments(audioValidation.speakers, castMap), [audioValidation.speakers, castMap]);
  const estimate = estimatedDialogueSeconds(turns);
  const onUnreachable = useCallback(() => setError({ code: 'poll_unreachable' }), []);
  const { jobs, generating, startJobs, clearJobs } = useStudioJobs({ onUnreachable });
  const job = jobs[0] || null;
  const busy = sending || generating;

  const loadBalance = useCallback(async () => {
    try {
      const result = await gatewayFetch('/balance');
      setBalance(result.balance);
    } catch (next) {
      if (!(next instanceof GatewayError && next.status === 401)) setBalance(null);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCastMap(readDialogueCastMap(window.localStorage));
      setProjectCasts(readProjectCasts(window.localStorage));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const draft = readDialogueDraft(window.sessionStorage);
    if (!draft) return undefined;
    const timer = setTimeout(() => {
      setModeId(draft.mode);
      setTurns(draft.turns.map((turn, index) => ({ id: index + 1, ...turn })));
      nextId.current = draft.turns.length + 1;
      setError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const initialRead = setTimeout(loadBalance, 0);
    window.addEventListener('veyrnox:balance-changed', loadBalance);
    return () => {
      clearTimeout(initialRead);
      window.removeEventListener('veyrnox:balance-changed', loadBalance);
    };
  }, [loadBalance]);

  function updateTurn(id, key, value) {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, [key]: value } : turn)));
    setError(null);
  }

  function chooseMode(nextMode) {
    if (busy || nextMode === modeId) return;
    setModeId(nextMode);
    clearJobs();
    setError(null);
  }

  function moveTurn(index, direction) {
    setTurns((current) => moveDialogueTurn(current, index, direction));
    setError(null);
  }

  function removeTurn(id) {
    setTurns((current) => (current.length <= 2 ? current : current.filter((turn) => turn.id !== id)));
  }

  function addTurn() {
    if (turns.length >= MAX_DIALOGUE_TURNS) return;
    const lastSpeaker = turns.at(-2)?.speaker || 'Ana';
    setTurns((current) => [...current, { id: nextId.current++, speaker: lastSpeaker, text: '' }]);
  }

  function clearTurns() {
    if (busy) return;
    setTurns(initialTurns.map((turn) => ({ ...turn })));
    nextId.current = 3;
    setError(null);
  }

  function assignCastVoice(speaker, voice) {
    setCastMap(setDialogueCastVoice(window.localStorage, speaker, voice));
    setError(null);
  }

  function resetCurrentCast() {
    setCastMap(forgetDialogueCastSpeakers(window.localStorage, audioAssignments.map((entry) => entry.speaker)));
    setError(null);
  }

  function saveCurrentProjectCast() {
    const next = saveProjectCast(window.localStorage, projectCastName, audioAssignments);
    if (next !== projectCasts) setProjectCasts(next);
    if (next.some((cast) => cast.name.toLowerCase() === projectCastName.trim().toLowerCase())) setProjectCastName('');
  }

  function startProjectCast(cast) {
    if (turns.some((turn) => turn.text.trim()) && pendingCastId !== cast.id) {
      setPendingCastId(cast.id);
      return;
    }
    const nextTurns = projectCastTurns(cast);
    if (!nextTurns.length) return;
    let nextMap = readDialogueCastMap(window.localStorage);
    for (const member of cast.members) nextMap = setDialogueCastVoice(window.localStorage, member.speaker, member.voice);
    setCastMap(nextMap);
    setTurns(nextTurns);
    setModeId('audio-script');
    setPendingCastId(null);
    nextId.current = nextTurns.length + 1;
    clearJobs();
    setError(null);
  }

  function deleteProjectCast(castId) {
    setProjectCasts(removeProjectCast(window.localStorage, castId));
    setPendingCastId((current) => current === castId ? null : current);
    setPortraitTarget((current) => current?.castId === castId ? null : current);
  }

  function chooseProjectCastPortrait(item) {
    if (!portraitTarget) return;
    setProjectCasts(bindProjectCastPortrait(window.localStorage, portraitTarget.castId, portraitTarget.speaker, item));
    setPortraitTarget(null);
  }

  function unlinkProjectCastPortrait(castId, speaker) {
    setProjectCasts(unbindProjectCastPortrait(window.localStorage, castId, speaker));
  }

  function choosePortrait(file) {
    setPortrait(file || null);
    setConsent(false);
    setError(null);
  }

  async function uploadPortrait(file) {
    const reservation = await gatewayFetch('/uploads', {
      method: 'POST',
      body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
    });
    let result;
    try {
      result = await fetch(reservation.upload_url, {
        method: 'PUT',
        headers: reservation.headers || { 'Content-Type': reservation.content_type },
        body: file,
      });
    } catch {
      throw new GatewayError('upload_failed', { code: 'upload_failed' });
    }
    if (!result.ok) throw new GatewayError('upload_failed', { status: result.status, code: 'upload_failed' });
    return reservation.key;
  }

  async function submit() {
    if (inFlight.current || busy || !validation.ok || !model || balance == null || model.credits > balance
      || (modeId === 'photo-dialogue' && (!portrait || !consent || !scene.trim()))) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    clearJobs();
    try {
      const photo = modeId === 'photo-dialogue';
      const portraitKey = photo ? await uploadPortrait(portrait) : null;
      const submitted = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({
          model_id: model.id,
          idempotency_key: makeIdempotencyKey(),
          confirmed_credits: model.credits,
          inputs: photo ? {
            first_text_input: photoValidation.firstText,
            second_text_input: photoValidation.secondText,
            voice1,
            voice2,
            prompt: scene.trim(),
          } : { prompt: audioValidation.script, ...dialogueCastInputs(audioAssignments) },
          source_keys: photo ? [portraitKey] : undefined,
          consent: photo ? true : undefined,
        }),
      });
      startJobs({ job_id: submitted.job_id, state: 'queued', credits: model.credits, model_id: model.id });
      pushJobHistory({ job_id: submitted.job_id, model_id: model.id, credits: model.credits, prompt: validation.script.slice(0, 60), name: photo ? 'Two-person photo dialogue' : 'Dialogue audio' });
      if (submitted.balance_after != null) setBalance(submitted.balance_after);
      notifyBalanceChanged();
    } catch (next) {
      setError(next instanceof GatewayError ? { code: next.code || 'gateway_error', retryAfter: next.retryAfter } : { code: 'internal' });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const photoMissing = modeId === 'photo-dialogue' && (!portrait || !consent || !scene.trim());
  const blocked = busy || catalogLoading || !validation.ok || !model || photoMissing || balance == null || model.credits > balance;
  const errorCopy = error ? ERROR_COPY[error.code] || 'The dialogue did not start. Check Library before trying again.' : '';

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav balance={balance} active="performance" />
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-8 sm:px-8 sm:pt-12">
        <header className="border-b border-vx-border pb-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">DIALOGUE STUDIO</p>
            <Chip tone="neutral">{live ? 'Live catalog' : 'Cached catalog'}</Chip>
          </div>
          <h1 className="vx-display mt-3 text-[40px] leading-[0.95] sm:text-[58px]">Direct the conversation.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-vx-fg-muted sm:text-base">Create ordered multi-speaker audio, or turn one permitted two-person portrait into a short 480p conversation with a separate script and stock voice for each person.</p>
        </header>

        <section className="mt-6" aria-labelledby="dialogue-mode-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">CREATION MODE</p>
              <h2 id="dialogue-mode-title" className="mt-1 text-xl font-black">Choose the deliverable</h2>
            </div>
            <p className="max-w-xl text-xs leading-5 text-vx-fg-muted">Photo dialogue is a native two-person render, not two single-person clips stitched together. Reviewed dialogue audio can continue into Video Dubbing; automatic diarization, face mapping, overlap and per-turn uploaded audio remain unavailable.</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {DIALOGUE_MODES.map((mode) => (
              <button key={mode.id} type="button" disabled={mode.status !== 'available' || busy} onClick={() => chooseMode(mode.id)} aria-pressed={modeId === mode.id} className="min-h-36 rounded-2xl border border-vx-border bg-vx-panel p-4 text-left disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07]">
                <span className={`font-vx-mono text-[9px] font-bold tracking-[0.12em] ${mode.status === 'available' ? 'text-vx-accent' : 'text-vx-fg-faint'}`}>{mode.eyebrow}</span>
                <span className="mt-2 block text-sm font-black">{mode.label}</span>
                <span className="mt-2 block text-[11px] leading-5 text-vx-fg-muted">{mode.description}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
          {modeId === 'photo-dialogue' && (
            <section className={`${card} p-4 sm:p-5`} aria-labelledby="portrait-dialogue-title">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">TWO-PERSON SOURCE</p>
                  <h2 id="portrait-dialogue-title" className="mt-1 text-xl font-black">One photo, two visible adults</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">Use a clear, front-facing scene containing exactly two people. The render is fixed to about {MAX_PHOTO_DIALOGUE_SECONDS} seconds at 480p with safety screening enabled.</p>
                </div>
                <label className="cursor-pointer rounded-full border border-vx-border px-4 py-2 text-xs font-extrabold hover:border-vx-accent">
                  {portrait ? 'Replace portrait' : 'Add portrait'}
                  <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { choosePortrait(event.target.files?.[0] || null); event.target.value = ''; }} />
                </label>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-dashed border-vx-border bg-vx-base">
                  <span className="break-all px-5 text-center text-xs text-vx-fg-muted">{portrait ? `Selected: ${portrait.name}` : 'JPEG, PNG or WebP · 20 MB max'}</span>
                </div>
                <label className="text-xs font-bold text-vx-fg-muted">SCENE DIRECTION
                  <textarea className={`${field} mt-2 min-h-28 resize-y`} value={scene} maxLength={2000} disabled={busy} onChange={(event) => { setScene(event.target.value); setError(null); }} />
                  <span className="mt-2 block font-normal leading-5 text-vx-fg-faint">Describe the shared setting and interaction. Do not request a real person without permission.</span>
                </label>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-xl border border-vx-border bg-vx-base p-4 text-xs leading-5 text-vx-fg-muted">
                <input className="mt-1" type="checkbox" checked={consent} disabled={busy || !portrait} onChange={(event) => setConsent(event.target.checked)} />
                <span>I own this photo or have permission from both depicted adults to create an AI-animated conversation.</span>
              </label>
            </section>
          )}

          <section className={`${card} p-4 sm:p-5`} aria-labelledby="dialogue-turns-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">ORDERED SCRIPT</p>
                <h2 id="dialogue-turns-title" className="mt-1 text-xl font-black">Speaker turns</h2>
                <p className="mt-1 text-xs leading-5 text-vx-fg-muted">{modeId === 'photo-dialogue' ? `Write exactly one contribution for the person on the left and one for the person on the right. Keep the combined speech near ${MAX_PHOTO_DIALOGUE_SECONDS} seconds.` : 'Each distinct name appears in Cast Map, where its provider stock voice can be chosen and remembered.'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={clearTurns}>Clear all</Button>
                <Button size="sm" variant="ghost" disabled={busy || modeId === 'photo-dialogue' || turns.length >= MAX_DIALOGUE_TURNS} onClick={addTurn}>Add conversation</Button>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {turns.map((turn, index) => {
                const speakerIndex = validation.speakers.findIndex((speaker) => speaker.speaker.toLowerCase() === turn.speaker.trim().toLowerCase());
                const assignment = speakerIndex >= 0
                  ? (modeId === 'photo-dialogue'
                    ? { ...validation.speakers[speakerIndex], voice: speakerIndex === 0 ? voice1 : voice2 }
                    : audioAssignments[speakerIndex])
                  : null;
                return <TurnCard key={turn.id} turn={turn} index={index} total={turns.length} voice={assignment?.voice} side={speakerIndex === 0 ? 'L' : speakerIndex === 1 ? 'R' : speakerIndex >= 0 ? String(speakerIndex + 1) : '—'} onChange={updateTurn} onMove={moveTurn} onRemove={removeTurn} disabled={busy} />;
              })}
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-vx-fg-muted">
              <span>Estimated speech: {estimate}s · {validation.speakers.length} distinct speaker{validation.speakers.length === 1 ? '' : 's'}</span>
              <span className="font-vx-mono">{validation.characters}/{MAX_DIALOGUE_CHARS}</span>
            </div>
            {!validation.ok && validation.errors.some((message) => turns.some((turn) => turn.text.trim())) && (
              <ul className="mt-3 space-y-1 text-xs text-vx-danger" aria-label="Dialogue checks">
                {validation.errors.map((message) => <li key={message}>• {message}</li>)}
              </ul>
            )}
          </section>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-24">
            <section className={`${card} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-vx-border px-5 py-4">
                <div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">RESULT</p><h2 className="mt-1 font-black">{modeId === 'photo-dialogue' ? 'Two-person video' : 'Multi-speaker audio'}</h2></div>
                {job && <Chip tone={job.state === 'failed' ? 'danger' : 'accent'}>{jobStateUi(job).label}</Chip>}
              </div>
              <div className="min-h-44 bg-vx-base p-5">
                {job?.asset_url ? <JobAssetPreview job={job} /> : (
                  <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-vx-border px-6 text-center text-sm text-vx-fg-muted">The finished {modeId === 'photo-dialogue' ? 'conversation video' : 'dialogue audio'} will be playable here and stored in Library.</div>
                )}
              </div>
              {job?.state === 'failed' && <p className="border-t border-vx-border px-5 py-4 text-sm text-vx-danger">{failedJobCopy(job)}</p>}
              {job?.state === 'succeeded' && job?.asset_url && (
                <div className="flex flex-wrap gap-3 border-t border-vx-border px-5 py-4">
                  <DownloadAsset row={job} label={modeId === 'photo-dialogue' ? 'Download video' : 'Download dialogue'} className="inline-flex min-h-10 items-center rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink" errorClassName="basis-full text-xs text-vx-danger" />
                  <DownloadProvenance row={job} className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 text-xs font-extrabold" errorClassName="basis-full text-xs text-vx-danger" />
                  {modeId !== 'photo-dialogue' && <SaveToAudioShelfButton jobId={job.job_id} name={`Dialogue · ${validation.speakers.map((speaker) => speaker.speaker).join(' + ')}`} purpose="lip-sync-dialogue" className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 text-xs font-extrabold disabled:opacity-60"/>}
                  {modeId !== 'photo-dialogue' && <Link href={`/app/performance?audio=${encodeURIComponent(job.job_id)}`} className="text-sm font-bold text-vx-accent underline">Use for lip sync</Link>}
                  {modeId !== 'photo-dialogue' && <Link href={`/app/video-dubbing?audio=${encodeURIComponent(job.job_id)}&speakers=${validation.speakers.length}`} onClick={() => writeDialogueDubbingHandoff(window.sessionStorage, { jobId: job.job_id, turns, cast: audioAssignments })} className="text-sm font-bold text-vx-accent underline">Use in Video Dubbing</Link>}
                  <Link href="/app/library" className="text-sm font-bold text-vx-fg-muted underline">Open Library</Link>
                </div>
              )}
              <OutputFileDisclosure className="m-5" />
            </section>

            <section className={`${card} p-5`}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">{modeId === 'photo-dialogue' ? 'PERSON VOICES' : 'CAST MAP'}</p>
                {modeId !== 'photo-dialogue' && audioAssignments.length > 0 && <button type="button" disabled={busy} onClick={resetCurrentCast} className="min-h-8 text-[10px] font-bold text-vx-accent underline disabled:opacity-40">Reset this cast</button>}
              </div>
              <div className="mt-3 space-y-2">
                {modeId === 'photo-dialogue' ? validation.speakers.slice(0, 2).map((speaker, index) => (
                  <label key={speaker.speaker.toLowerCase()} className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 text-sm"><span className="font-bold">{index === 0 ? 'L' : 'R'} · {speaker.speaker}</span><select aria-label={`${speaker.speaker} voice`} className={field} value={index === 0 ? voice1 : voice2} disabled={busy} onChange={(event) => index === 0 ? setVoice1(event.target.value) : setVoice2(event.target.value)}>{PHOTO_DIALOGUE_VOICES.map((voice) => <option key={voice}>{voice}</option>)}</select></label>
                )) : audioAssignments.length ? audioAssignments.map((speaker, index) => (
                  <label key={speaker.speaker.toLowerCase()} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 text-sm"><span className="font-bold">{index === 0 ? 'L' : index === 1 ? 'R' : index + 1} · {speaker.speaker}</span><select aria-label={`${speaker.speaker} cast voice`} className={field} value={speaker.voice} disabled={busy} onChange={(event) => assignCastVoice(speaker.speaker, event.target.value)}>{DIALOGUE_VOICES.map((voice) => <option key={voice} disabled={audioAssignments.some((entry) => entry.speaker.toLowerCase() !== speaker.speaker.toLowerCase() && entry.voice === voice)}>{voice}</option>)}</select></label>
                )) : <p className="text-xs text-vx-fg-muted">Add two named speakers to see the mapping.</p>}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-vx-fg-faint">Dialogue uses four provider-specific stock voices. Character names and choices stay in this browser so the same named cast can return in another script; no audio, biometric voiceprint or cloned identity is stored.</p>
            </section>

            {modeId !== 'photo-dialogue' && (
              <section className={`${card} p-5`} aria-labelledby="project-casts-title">
                <div>
                  <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">REUSABLE ENSEMBLES</p>
                  <h2 id="project-casts-title" className="mt-1 text-sm font-black">Project Casts</h2>
                  <p className="mt-1 text-[10px] leading-4 text-vx-fg-faint">Save the current two-to-four-character Cast Map. Optionally link each member to one owned Library portrait.</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <label className="min-w-0 flex-1"><span className="sr-only">Project Cast name</span><input aria-label="Project Cast name" value={projectCastName} maxLength={48} disabled={busy} onChange={(event) => setProjectCastName(event.target.value)} placeholder="Night shift ensemble" className={field} /></label>
                  <Button size="sm" variant="ghost" disabled={busy || !projectCastName.trim() || audioAssignments.length < 2} onClick={saveCurrentProjectCast}>Save cast</Button>
                </div>
                {projectCasts.length ? (
                  <div className="mt-3 space-y-2">
                    {projectCasts.map((cast) => (
                      <article key={cast.id} className="rounded-xl border border-vx-border bg-vx-base p-3" aria-label={`${cast.name} Project Cast`}>
                        <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 truncate text-xs font-extrabold">{cast.name}</h3><button type="button" disabled={busy} onClick={() => deleteProjectCast(cast.id)} className="min-h-8 shrink-0 text-[10px] font-bold text-vx-danger underline disabled:opacity-40">Delete</button></div>
                        <div className="mt-2 space-y-2">
                          {cast.members.map((member) => (
                            <div key={member.speaker.toLowerCase()} className="rounded-lg border border-vx-border px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-[10px] leading-4 text-vx-fg-muted"><span className="font-extrabold text-vx-fg">{member.speaker}</span> · {member.voice}</p>
                                <button type="button" disabled={busy} onClick={() => setPortraitTarget({ castId: cast.id, speaker: member.speaker })} className="min-h-7 text-[10px] font-bold text-vx-accent underline disabled:opacity-40">{member.portraitJobId ? 'Replace portrait' : 'Choose portrait'}</button>
                              </div>
                              {member.portraitJobId && (
                                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                                  <p className="min-w-0 truncate text-[10px] text-vx-fg-faint">{member.portraitLabel}</p>
                                  <div className="flex items-center gap-3">
                                    <Link href={`/app/talking-avatar?portrait=${encodeURIComponent(member.portraitJobId)}&castMember=${encodeURIComponent(member.speaker)}`} className="text-[10px] font-bold text-vx-accent underline">Use in Talking Avatar</Link>
                                    <Link href={`/app/film-studio?castPortrait=${encodeURIComponent(member.portraitJobId)}&castMember=${encodeURIComponent(member.speaker)}`} className="text-[10px] font-bold text-vx-accent underline">Prepare Film reference</Link>
                                    <button type="button" disabled={busy} onClick={() => unlinkProjectCastPortrait(cast.id, member.speaker)} className="min-h-7 text-[10px] font-bold text-vx-danger underline disabled:opacity-40">Unlink</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <button type="button" disabled={busy} onClick={() => startProjectCast(cast)} className={`mt-2 min-h-9 w-full rounded-full border px-3 text-[10px] font-extrabold disabled:opacity-40 ${pendingCastId === cast.id ? 'border-vx-danger text-vx-danger' : 'border-vx-accent/50 text-vx-accent'}`}>{pendingCastId === cast.id ? 'Replace current words?' : 'Start clean script with cast'}</button>
                      </article>
                    ))}
                  </div>
                ) : <p className="mt-3 text-xs text-vx-fg-muted">Save this cast to reuse the ensemble in another dialogue.</p>}
                <p className="mt-3 text-[10px] leading-4 text-vx-fg-faint">Starting a cast creates a clean script. A second confirmation is required before replacing written turns. Portraits are selected only from your owned Library; this browser stores the job ID and label, never pixels or a signed URL. Talking Avatar rechecks access and clears consent. Film Studio character-passport import remains separate.</p>
              </section>
            )}

            <section className={`${card} p-5`}>
              <div className="flex items-baseline justify-between"><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">APPROVE TOTAL</p><p className="font-vx-mono text-[11px] text-vx-fg-muted">balance {balance ?? '—'} cr</p></div>
              <p className="mt-2 font-vx-mono text-[38px] font-black text-vx-money">−{model?.credits ?? 0} cr</p>
              <p className="mt-2 text-xs leading-5 text-vx-fg-muted">One {modeId === 'photo-dialogue' ? 'short 480p video' : 'audio'} job. A failed job follows the existing refund path; nothing is spent while editing.</p>
              <Button className="mt-5 w-full justify-between" cost={model?.credits ?? 0} disabled={blocked} onClick={submit}>{sending ? 'Submitting…' : generating ? 'Creating dialogue…' : modeId === 'photo-dialogue' ? 'Create video dialogue' : 'Create dialogue audio'}</Button>
              {!validation.ok && <p className="mt-3 text-xs text-vx-fg-muted">Complete at least two valid speakers and turns.</p>}
              {modeId === 'photo-dialogue' && !portrait && <p className="mt-3 text-xs text-vx-fg-muted">Add one permitted two-person portrait.</p>}
              {modeId === 'photo-dialogue' && portrait && !consent && <p className="mt-3 text-xs text-vx-fg-muted">Confirm permission from both depicted adults.</p>}
              {balance != null && model && model.credits > balance && <p className="mt-3 text-xs text-vx-danger">You need {model.credits - balance} more credits. <Link href="/app/credits" className="underline">Add credits</Link>.</p>}
              {error && <p role="alert" className="mt-3 text-xs text-vx-danger">{errorCopy}{error.retryAfter ? ` Retry in ${error.retryAfter}s.` : ''}</p>}
              <p className="mt-3 text-center font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">PRICE PINNED · STOCK VOICES · SAFETY CHECKED · NO CLONING</p>
            </section>
          </aside>
        </div>
      </div>
      {portraitTarget && <LibraryPicker mediaKind="image" onPick={chooseProjectCastPortrait} onClose={() => setPortraitTarget(null)} />}
    </div>
  );
}
