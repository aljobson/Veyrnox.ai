'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { beatErrorMessage } from '../../../_lib/music/beat/beatErrors.mjs';
import dynamic from 'next/dynamic';
import { useI18n } from '../../../../../components/I18nProvider';
import BeatCoachMarks from './BeatCoachMarks';
import BeatShortcutSheet from './BeatShortcutSheet';
import { BEAT_KEYS } from '../../../_lib/music/beat/beatShortcuts.mjs';
import BeatGenerateSheet from './BeatGenerateSheet';
import BeatAiActionSheet from './BeatAiActionSheet';
import { useBeatAiRequest } from './useBeatAiRequest';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeatCloudSync } from './useBeatCloudSync';
import BeatCloudConflictDialog from './BeatCloudConflictDialog';
import BeatVersionsPanel from './BeatVersionsPanel';
import BeatKeyboard from './BeatKeyboard';
import BeatPianoRoll from './BeatPianoRoll';
import { useRecordingLock } from './useRecordingLock';
import { routeBeatKey } from '../../../_lib/music/beat/beatKeys.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { useBeatProject } from './useBeatProject';
import { useBeatPlayback } from './useBeatPlayback';
import BeatTransport from './BeatTransport';
import BeatArrangement from './BeatArrangement';
import { songEnd } from '../../../_lib/music/beat/beatDocument.mjs';
import { clampLocator } from '../../../_lib/music/beat/beatTime.mjs';
import { editTrack, recordTarget } from '../../../_lib/music/beat/beatEvents.mjs';
import BeatStepGrid from './BeatStepGrid';
import BeatPads from './BeatPads';
import BeatExportDialog from './BeatExportDialog';
import BeatMagicBar from './BeatMagicBar';
import { useBeatLoopLayers } from './useBeatLoopLayers';
import { action, button, input } from './beatStyles';

const BeatRecordPanel = dynamic(() => import('./BeatRecordPanel'), { ssr: false });
const BeatMixer = dynamic(() => import('./BeatMixer'), { ssr: false, loading: MixerLoading });

function MixerLoading() {
  const { t } = useI18n();
  return <div role="status" aria-busy="true" className="min-h-64 rounded-xl bg-vx-panel p-4">{t('app.music.beat.details.d31')}</div>;
}

export default function BeatEditor({ ai = {}, id, magicBar = false, cloud = false, librarySave = false }) {
  const router = useRouter();
  const { t } = useI18n();
  const [shortcutsOpen, setShortcutsOpen] = useState(false), [tipReplay, setTipReplay] = useState(0);
  const [message, setMessage] = useState('');
  const [ripple, setRipple] = useState(false);
  const announce = useCallback((text) => setMessage(text), []);
  const rippleRef = useRef(false);
  const toggleRipple = useCallback(() => {
    rippleRef.current = !rippleRef.current;
    setRipple(rippleRef.current);
    announce(t(rippleRef.current ? 'app.music.beat.ripple.on' : 'app.music.beat.ripple.off'));
  }, [announce, t]);
  const project = useBeatProject(id, announce);
  const aiRequest = useBeatAiRequest({ beatId: id, project, announce, enabled: Object.values(ai).some(Boolean) });
  const sync = useBeatCloudSync({ beatId: id, project, cloud, announce });
  const root = useRef(null);
  const [mixerOpen, setMixerOpen] = useState(false), [automationLanes, setAutomationLanes] = useState({});
  const [selectedRegionId, setSelectedRegionId] = useState(null), [rollOpen, setRollOpen] = useState(true);
  const [snap, setSnap] = useState(240), [octave, setOctave] = useState(0), [velocity, setVelocity] = useState(100);
  const [editTrackId, setEditTrackId] = useState(null);
  const [locatorDraft, setLocator] = useState(0);
  const locator = project.doc ? clampLocator(locatorDraft, songEnd(project.doc)) : 0;
  const playback = useBeatPlayback(project.current, project.edit, announce, { editTrackId, locator, snap, selectedRegionId });
  useRecordingLock(root, playback.recordingRun, t);
  const registerFinalizer = project.registerFinalizer, finalizeAndStop = playback.stop;
  const registerRecordingState = project.registerRecordingState, isRecording = playback.isRecording;
  useEffect(() => { registerRecordingState(isRecording); }, [registerRecordingState, isRecording]);
  useEffect(() => { registerFinalizer(finalizeAndStop); }, [registerFinalizer, finalizeAndStop]);
  const loops = useBeatLoopLayers(id, magicBar && Boolean(playback.runId));
  const [titleDraft, setTitleDraft] = useState(null);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copying, setCopying] = useState(false);
  const { doc, edit } = project;
  const [storedTitle, setStoredTitle] = useState(doc?.title);
  if (storedTitle !== doc?.title) {
    setStoredTitle(doc?.title);
    setTitleDraft(null);
  }
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  // This state belongs to the displayed history entry, not to an effect or timer replay.
  if (undo && undo.id !== project.undoId) setUndo(null);
  const keyState = useRef(null);
  useEffect(() => { keyState.current = { doc, playback, project, editTrackId, octave, velocity, toggleRipple }; });
  useEffect(() => {
    function key(event) {
      const { doc, playback, project, editTrackId, octave, velocity, toggleRipple } = keyState.current;
      if (event.defaultPrevented || event.repeat || !doc || document.querySelector('dialog[open]')) return;
      const target = event.target;
      const textInput = target.isContentEditable || target.closest('textarea, [role="textbox"]') ||
        (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(target.type));
      if (textInput || target.closest('[data-beat-velocity]')) return;
      if (event.key === BEAT_KEYS.help && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); setShortcutsOpen(true); return; }
      const inPianoRoll = Boolean(target.closest('[role="application"]'));
      const command = event.ctrlKey || event.metaKey || event.altKey;
      if ((event.ctrlKey || event.metaKey) && [BEAT_KEYS.undo, BEAT_KEYS.redo].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (playback.recordingRun) return;
        if (event.key.toLowerCase() === BEAT_KEYS.redo || event.shiftKey) project.redo(); else project.undo();
        setTitleDraft(null);
        return;
      }
      if (command || target.closest('select')) return;
      if (event.key.toLowerCase() === BEAT_KEYS.ripple) { event.preventDefault(); toggleRipple(); return; }
      if (event.code === BEAT_KEYS.play && (inPianoRoll || !target.closest('input, button, a, [role="button"]'))) { event.preventDefault(); playback.toggle(); return; }
      if (inPianoRoll) return;
      const route = routeBeatKey({ key: event.key, repeat: event.repeat, command, textInput, kind: editTrack(doc, editTrackId)?.kind, octave, velocity });
      if (!route) return;
      event.preventDefault();
      if (route.type === 'pad') playback.hit(route.pad);
      if (route.type === 'note') playback.noteOn(`typing:${event.key.toLowerCase()}`, route.pitch, route.velocity);
      if (route.type === 'octave') setOctave(route.value);
      if (route.type === 'velocity') setVelocity(route.value);
    }
    const up = (event) => keyState.current.playback.noteOff(`typing:${event.key.toLowerCase()}`);
    window.addEventListener('keydown', key); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', up); };
  }, []);
  function clear() {
    clearTimeout(undoTimer.current);
    const id = edit((d) => ops.clearPattern(d), { label: BEAT_ACTIONS.a15 });
    if (id) {
      setUndo({ id, slot: doc.currentPattern });
      announce(t('app.music.beat.status.s9', { p0: doc.currentPattern }));
    }
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }
  async function copy() {
    setCopying(true);
    await playback.finishRecording();
    const nextId = await project.copy();
    if (nextId) { playback.stop(); router.push(`/app/music/beats/${nextId}`); }
    else setCopying(false);
  }
  const back = <Link data-beat-live onClick={async e => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); await playback.finishRecording(); await project.flushLatest(); router.push('/app/music/beats'); }} className={`${button} inline-flex items-center`} href="/app/music/beats">{t('app.music.beat.ui.my.beats')}</Link>;
  if (project.error) return <div className="space-y-4 p-6"><h1 className="text-2xl font-bold">{project.error === 'blocked' ? t('app.music.beat.compat.blocked') : project.error === 'unsupported_version' ? t('app.music.beat.compat.unsupported') : project.error === 'update_required' ? t('app.music.beat.compat.updateRequired') : project.error === 'storage' ? t('app.music.beat.device.readError') : project.error === 'damaged' ? t('app.music.beat.device.damaged') : t('app.music.beat.ui.this.beat.isn.t.on.this.device')}</h1>{['storage', 'blocked'].includes(project.error) && <button className={button} onClick={project.reload}>{t('app.music.beat.ui.retry')}</button>}{back}</div>;
  if (!doc) return <p className="p-6" aria-busy="true">{t('app.music.beat.ui.loading.beat')}</p>;
  const title = titleDraft ?? doc.title;
  const titleInvalid = !title.trim() || title.length > 80;
  const track = editTrack(doc, editTrackId);
  const target = playback.playhead >= 0 ? recordTarget(doc, playback.playhead, track.id) : null;
  const patternPlayhead = target?.pattern === doc.currentPattern ? target.step : -1;
  const uses = doc.tracks.flatMap((t) => t.regions).filter((r) => r.pattern === doc.currentPattern).length;
  const midiRegion = track.kind === 'midi' ? track.regions.find((r) => r.id === selectedRegionId) : null;
  const lockedEdit = (change, options) => playback.recordingRun ? (announce(t('app.music.beat.status.s10')), null) : edit(change, options);
  function showAutomation(id, lane) {
    setAutomationLanes(previous => ({ ...previous, [id]: lane }));
    if (lane && doc.view !== 'song') edit(d => ops.setView(d, 'song'), { label: BEAT_ACTIONS.a16 });
  }
  return <div ref={root} className="mx-auto min-w-0 w-full max-w-7xl space-y-5 px-2 py-6 md:px-6">
    <BeatCoachMarks replay={tipReplay} /><BeatShortcutSheet open={shortcutsOpen} close={() => setShortcutsOpen(false)} replayTips={() => setTipReplay(value => value + 1)} />
    <header className="flex flex-wrap items-center gap-3">{back}<h1 className="text-2xl font-black">{t('app.music.beat.ui.beat.editor')}</h1>
      <button className={button} aria-disabled={!project.canUndo}
        onClick={() => { project.undo(); setTitleDraft(null); }}>{t('app.music.beat.shortcut.undo')}</button>
      <button className={button} aria-disabled={!project.canRedo}
        onClick={() => { project.redo(); setTitleDraft(null); }}>{t('app.music.beat.shortcut.redo')}</button>
      <button data-beat-live className={button} aria-expanded={mixerOpen} onClick={() => setMixerOpen(value => !value)}>{t('app.music.beat.ui.mixer')}</button>
      <button data-beat-live data-beat-tip="shortcuts" className={button} onClick={() => setShortcutsOpen(true)}>{t('app.music.beat.shortcuts')}</button>
      <button className={button} disabled={copying} onClick={copy}>{t('app.music.beat.ui.save.as.copy')}</button>
      {ai.generate && <button className={action} onClick={() => aiRequest.open({ op: 'generate' })}><span aria-hidden="true">✦ </span>{t('app.music.beat.ui.generate')}</button>}
      {Object.values(ai).some(Boolean) && aiRequest.pending.map(r => <button className={button} key={r.key} onClick={() => aiRequest.resume(r)}>{t('app.music.beat.ui.resume')}{r.prompt.slice(0, 24) || t('app.music.beat.ui.ai.parts')}</button>)}
    </header>
    {aiRequest.selection && (aiRequest.selection.op === 'generate' ? <BeatGenerateSheet key="generate" request={aiRequest} doc={doc} afterTrackId={track.id} /> : <BeatAiActionSheet key={aiRequest.selection.op} request={aiRequest} doc={doc} afterTrackId={track.id} />)}
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="flex min-w-0 flex-1 flex-col gap-1">{t('app.music.beat.ui.title')}<input className={`${input} w-full text-xl font-bold`} value={title} aria-invalid={titleInvalid} aria-describedby={titleInvalid ? 'title-error' : undefined} onChange={(e) => {
      const value = e.target.value;
      setTitleDraft(value);
      if (value.trim() && value.length <= 80 && edit((d) => ops.rename(d, value), { key: 'title', label: BEAT_ACTIONS.a17 })) {
        setStoredTitle(value);
      }
    }} onBlur={() => { if (!titleInvalid) setTitleDraft(null); }} />{titleInvalid && <span id="title-error" className="text-sm text-vx-danger">{!title.trim() ? t('app.music.beat.ui.give.your.beat.a.title') : t('app.music.beat.error.beat-title')}</span>}</label><BeatExportDialog librarySave={librarySave} finalize={() => playback.isRecording() || playback.pending.current ? playback.finishRecording() : project.current.current} doc={doc} editTrackId={track.id} announce={announce} /></div>
    <p className="text-sm text-vx-fg-muted">{project.conflict ? t('app.music.beat.ui.autosave.paused') : project.saveError ? <>{t('app.music.beat.ui.couldn.t.save.on.this.device')} <button className={button} onClick={project.retry}>{t('app.music.beat.ui.retry')}</button></> : !project.persistent ? t('app.music.beat.ui.kept.in.memory.for.this.visit') : project.dirty ? t('app.music.beat.ui.saving') : t('app.music.beat.ui.saved.on.this.device')}</p>
    {!project.persistent && <p className="rounded-xl border border-vx-border bg-vx-panel p-3">{t('app.music.beat.recovery.r11')}</p>}
    {project.conflict && <section className="space-y-3 rounded-xl border border-vx-border bg-vx-panel p-4" aria-label={t('app.music.beat.ui.beat.changed.elsewhere')}><h2 className="font-bold">{project.conflict === 'deleted' ? t('app.music.beat.ui.this.beat.was.deleted.in.another.tab') : t('app.music.beat.ui.this.beat.was.changed.in.another.tab')}</h2><div className="flex flex-wrap gap-2">{project.conflict !== 'deleted' && <button className={button} onClick={async () => { await playback.finishRecording(); setTitleDraft(null); setUndo(null); setLocator(0); setEditTrackId(null); setReloadKey((value) => value + 1); project.reload(); }}>{t('app.music.beat.ui.reload')}</button>}<button className={action} disabled={copying} onClick={copy}>{project.conflict === 'deleted' ? t('app.music.beat.ui.save.as.a.new.beat') : t('app.music.beat.ui.save.my.version.as.a.copy')}</button></div></section>}
    {playback.audioError && <p className="rounded-xl border border-vx-border p-3">{playback.audioError}</p>}
    {playback.recordingRun && <p role="status">{t('app.music.beat.ui.stop.recording.to.edit')}{playback.overlay.length}{t('app.music.beat.ui.pending.notes')}</p>}
    {playback.takeError && <div role="alert" className="rounded-xl border border-vx-border p-3">{playback.takeError}<button className={button} onClick={playback.finalizeRecording}>{t('app.music.beat.ui.try.again')}</button><button className={button} onClick={async () => { try { const take = playback.takeAsBeat(); const id = take && await project.copy(take); if (id) { playback.discardSavedTake(); router.push(`/app/music/beats/${id}`); } } catch (e) { announce(beatErrorMessage(e, 'save-take', t)); } }}>{t('app.music.beat.ui.save.take.as.a.new.beat')}</button></div>}
    {cloud && <section className="flex flex-wrap items-center gap-3" aria-label={t('app.music.beat.ui.account.save')}>
      <p>{sync.message}</p>
      {['unlinked', 'removed'].includes(sync.state) && <button className={button} onClick={sync.link}>{t('app.music.beat.ui.save.to.your.account')}</button>}
      {sync.state === 'signed_out' && <Link className={button} href="/app/account">{t('app.music.beat.ui.sign.in')}</Link>}
      {['error', 'offline', 'limit', 'rate_limited', 'conflict'].includes(sync.state) && <button className={button} onClick={sync.retry}>{t('app.music.beat.ui.retry')}</button>}
      <BeatVersionsPanel beatId={id} project={project} sync={sync} />
      {sync.media.length > 0 && <p className="w-full text-sm text-vx-fg-muted">{t('app.music.beat.ui.only.on.this.device')}{sync.media.join(', ')}</p>}
      <BeatCloudConflictDialog sync={sync} />
    </section>}
    {!Object.values(doc.patterns).some(p => Object.values(p.rows).some(hits => hits.length)) && !Object.values(doc.clips).some(c => c.notes.length) && !Object.keys(doc.assets).length && <p>{t('app.music.beat.empty')}</p>}
    <BeatTransport key={`transport-${reloadKey}`} doc={doc} edit={lockedEdit} selectPattern={project.selectPattern} playing={playback.playing} loading={playback.loading} toggle={playback.toggle} clear={clear} announce={announce} />
    {undo && undo.id === project.undoId && <div className="flex items-center gap-3 rounded-xl bg-vx-panel p-3">
      <p>{t('app.music.beat.ui.pattern')}{undo.slot}{t('app.music.beat.ui.cleared')}</p><button className={button} onClick={() => {
        project.undo(); setTitleDraft(null); setUndo(null); clearTimeout(undoTimer.current);
      }}>{t('app.music.beat.shortcut.undo')}</button>
    </div>}
    <BeatArrangement recording={playback.recordingRun} armedId={playback.audioRecorder.armedId} onArm={playback.audioRecorder.arm} automationLanes={automationLanes} onAutomation={showAutomation} ai={ai} onAi={aiRequest.open} key={`arrangement-${reloadKey}`} doc={doc} edit={edit} selectPattern={project.selectPattern} editTrackId={track.id}
      onSelectRegion={(id) => { setSelectedRegionId(id); setRollOpen(true); }} setEditTrackId={setEditTrackId} locator={locator} setLocator={setLocator}
      playhead={playback.playhead} runId={playback.runId} announce={announce} ripple={ripple} setRipple={toggleRipple} />
    {(playback.audioRecorder.armedId || playback.audioRecorder.hasPending() || playback.audioRecorder.error || playback.audioRecorder.recovery.length > 0) && <BeatRecordPanel recorder={playback.audioRecorder} playback={playback} announce={announce} />}
    {mixerOpen ? <BeatMixer recording={playback.recordingRun} doc={doc} edit={edit} engine={playback.engine} close={() => setMixerOpen(false)} onAutomation={showAutomation} /> : track.kind === 'midi' ? <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={playback.record} onChange={(e) => playback.setRecord(e.target.checked)} />{t('app.music.beat.ui.record')}</label>
        <label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={playback.quantise} onChange={(e) => playback.setQuantise(e.target.checked)} />{t('app.music.beat.ui.quantise.while.recording')}</label>
        <label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={playback.countIn} onChange={(e) => playback.setCountIn(e.target.checked)} />{t('app.music.beat.ui.count.in.1.bar')}</label>
        {track.regions.length > 0 && (!midiRegion || !rollOpen) && <button className={button} onClick={() => { setSelectedRegionId(track.regions[0].id); setRollOpen(true); }}>{t('app.music.beat.ui.open.piano.roll')}</button>}
      </div>
      {midiRegion && rollOpen && !playback.recordingRun && <BeatPianoRoll playback={playback} key={midiRegion.clipId} doc={doc} region={midiRegion} edit={lockedEdit} snap={snap} setSnap={setSnap} close={() => setRollOpen(false)} />}
      <div data-beat-live><BeatKeyboard key={track.id} playback={playback} octave={octave} setOctave={setOctave} velocity={velocity} setVelocity={setVelocity} /></div>
      {playback.recordingRun && <div aria-label={t('app.music.beat.ui.pending.recording.notes')} className="relative h-24 overflow-hidden rounded-xl border border-vx-hue-rose">{playback.overlay.map((n, i) => <span key={i} className="absolute h-1 bg-vx-hue-rose" style={{ left: `${(n.start % (16 * 3840)) / (16 * 3840) * 100}%`, width: `${Math.max(0.5, (n.end - n.start) / (16 * 3840) * 100)}%`, top: `${(108 - n.pitch) / 87 * 90}%` }} />)}</div>}
    </> : track.kind === 'drums' && <>
      <h2 className="font-bold">{t('app.music.beat.ui.editing.pattern')}{doc.currentPattern}{t('app.music.beat.ui.used.by')}{uses} {uses === 1 ? t('app.music.beat.ui.region') : t('app.music.beat.ui.regions')})</h2>
      <BeatStepGrid doc={doc} edit={lockedEdit} playhead={patternPlayhead} runId={playback.runId} />
      <BeatPads hit={playback.hit} record={playback.record} setRecord={playback.setRecord} />
    </>}
    {magicBar && <BeatMagicBar hidePrompt={ai.generate} doc={doc} loops={loops} announce={announce} />}
    <p aria-live="polite" aria-atomic="true" className="min-h-6 text-sm text-vx-fg-muted">{message}</p>
  </div>;
}
