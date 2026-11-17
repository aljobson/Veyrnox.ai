'use client';
import dynamic from 'next/dynamic';
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
import { action, button, input, storageWarning } from './beatStyles';

const BeatMixer = dynamic(() => import('./BeatMixer'), { ssr: false, loading: () => <div role="status" aria-busy="true" className="h-64 rounded-xl bg-vx-panel p-4">Loading mixer…</div> });

export default function BeatEditor({ ai = {}, id, magicBar = false, cloud = false, librarySave = false }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const announce = useCallback((text) => setMessage(text), []);
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
  useRecordingLock(root, playback.recordingRun);
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
  useEffect(() => { keyState.current = { doc, playback, project, editTrackId, octave, velocity }; });
  useEffect(() => {
    function key(event) {
      const { doc, playback, project, editTrackId, octave, velocity } = keyState.current;
      if (event.defaultPrevented || event.repeat || !doc || document.querySelector('dialog[open]')) return;
      const target = event.target;
      const textInput = target.isContentEditable || target.closest('textarea, [role="textbox"]') ||
        (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(target.type));
      if (textInput || target.closest('[data-beat-velocity]')) return;
      const inPianoRoll = Boolean(target.closest('[role="application"]'));
      const command = event.ctrlKey || event.metaKey || event.altKey;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (playback.recordingRun) return;
        if (event.key.toLowerCase() === 'y' || event.shiftKey) project.redo(); else project.undo();
        setTitleDraft(null);
        return;
      }
      if (command || target.closest('select')) return;
      if (event.code === 'Space' && (inPianoRoll || !target.closest('input, button, a, [role="button"]'))) { event.preventDefault(); playback.toggle(); return; }
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
    const id = edit((d) => ops.clearPattern(d), { label: 'clear pattern' });
    if (id) {
      setUndo({ id, slot: doc.currentPattern });
      announce(`Pattern ${doc.currentPattern} cleared. Undo is available for five seconds.`);
    }
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }
  async function copy() {
    setCopying(true);
    playback.finalizeRecording(); playback.stop();
    const nextId = await project.copy();
    if (nextId) { playback.stop(); router.push(`/app/music/beats/${nextId}`); }
    else setCopying(false);
  }
  const back = <Link onClick={() => { playback.finalizeRecording(); playback.stop(); }} className={`${button} inline-flex items-center`} href="/app/music/beats">My beats</Link>;
  if (project.error) return <div className="space-y-4 p-6"><h1 className="text-2xl font-bold">{project.error === 'damaged' ? 'This beat is damaged' : "This beat isn't on this device"}</h1>{back}</div>;
  if (!doc) return <p className="p-6" aria-busy="true">Loading beat…</p>;
  const title = titleDraft ?? doc.title;
  const track = editTrack(doc, editTrackId);
  const target = playback.playhead >= 0 ? recordTarget(doc, playback.playhead, track.id) : null;
  const patternPlayhead = target?.pattern === doc.currentPattern ? target.step : -1;
  const uses = doc.tracks.flatMap((t) => t.regions).filter((r) => r.pattern === doc.currentPattern).length;
  const midiRegion = track.kind === 'midi' ? track.regions.find((r) => r.id === selectedRegionId) : null;
  const lockedEdit = (change, options) => playback.recordingRun ? (announce('Stop recording to edit'), null) : edit(change, options);
  function showAutomation(id, lane) {
    setAutomationLanes(previous => ({ ...previous, [id]: lane }));
    if (lane && doc.view !== 'song') edit(d => ops.setView(d, 'song'), { label: 'Show song automation' });
  }
  return <div ref={root} className="mx-auto min-w-0 w-full max-w-7xl space-y-5 px-2 py-6 md:px-6">
    <header className="flex flex-wrap items-center gap-3">{back}<h1 className="text-2xl font-black">Beat editor</h1>
      <button className={button} aria-disabled={!project.canUndo}
        onClick={() => { project.undo(); setTitleDraft(null); }}>Undo</button>
      <button className={button} aria-disabled={!project.canRedo}
        onClick={() => { project.redo(); setTitleDraft(null); }}>Redo</button>
      <button data-beat-live className={button} aria-expanded={mixerOpen} onClick={() => setMixerOpen(value => !value)}>Mixer</button>
      <button className={button} disabled={copying} onClick={copy}>Save as copy</button>
      {ai.generate && <button className={action} onClick={() => aiRequest.open({ op: 'generate' })}><span aria-hidden="true">✦ </span>Generate</button>}
      {Object.values(ai).some(Boolean) && aiRequest.pending.map(r => <button className={button} key={r.key} onClick={() => aiRequest.resume(r)}>Resume {r.prompt.slice(0, 24) || 'AI parts'}</button>)}
    </header>
    {aiRequest.selection && (aiRequest.selection.op === 'generate' ? <BeatGenerateSheet key="generate" request={aiRequest} doc={doc} afterTrackId={track.id} /> : <BeatAiActionSheet key={aiRequest.selection.op} request={aiRequest} doc={doc} afterTrackId={track.id} />)}
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="flex min-w-0 flex-1 flex-col gap-1">Title<input className={`${input} w-full text-xl font-bold`} maxLength={80} value={title} aria-invalid={!title.trim()} aria-describedby={!title.trim() ? 'title-error' : undefined} onChange={(e) => {
      const value = e.target.value;
      setTitleDraft(value);
      if (value.trim() && edit((d) => ops.rename(d, value), { key: 'title', label: 'rename beat' })) {
        setStoredTitle(value);
      }
    }} onBlur={() => { if (title.trim()) setTitleDraft(null); }} /></label><BeatExportDialog librarySave={librarySave} finalize={() => playback.isRecording() || playback.pending.current ? playback.stop() : project.current.current} doc={doc} editTrackId={track.id} announce={announce} /></div>
    {!title.trim() && <p id="title-error">Give your beat a title.</p>}
    <p className="text-sm text-vx-fg-muted">{project.conflict ? 'Autosave paused' : project.saveError ? <>{"Couldn't save on this device."} <button className={button} onClick={project.retry}>Retry</button></> : !project.persistent ? 'Kept in memory for this visit' : project.dirty ? 'Saving…' : 'Saved on this device'}</p>
    {!project.persistent && <p className="rounded-xl border border-vx-border bg-vx-panel p-3">{storageWarning}</p>}
    {project.conflict && <section className="space-y-3 rounded-xl border border-vx-border bg-vx-panel p-4" aria-label="Beat changed elsewhere"><h2 className="font-bold">{project.conflict === 'deleted' ? 'This beat was deleted in another tab' : 'This beat was changed in another tab'}</h2><div className="flex flex-wrap gap-2">{project.conflict !== 'deleted' && <button className={button} onClick={() => { playback.stop(); setTitleDraft(null); setUndo(null); setLocator(0); setEditTrackId(null); setReloadKey((value) => value + 1); project.reload(); }}>Reload</button>}<button className={action} disabled={copying} onClick={copy}>{project.conflict === 'deleted' ? 'Save as a new beat' : 'Save my version as a copy'}</button></div></section>}
    {playback.audioError && <p className="rounded-xl border border-vx-border p-3">{playback.audioError}</p>}
    {playback.recordingRun && <p role="status">Stop recording to edit · {playback.overlay.length} pending notes</p>}
    {playback.takeError && <div role="alert" className="rounded-xl border border-vx-border p-3">{playback.takeError}<button className={button} onClick={playback.finalizeRecording}>Try again</button><button className={button} onClick={async () => { try { const take = playback.takeAsBeat(); const id = take && await project.copy(take); if (id) { playback.discardSavedTake(); router.push(`/app/music/beats/${id}`); } } catch (e) { announce(e.message); } }}>Save take as a new beat</button></div>}
    {cloud && <section className="flex flex-wrap items-center gap-3" aria-label="Account save">
      <p>{sync.message}</p>
      {['unlinked', 'removed'].includes(sync.state) && <button className={button} onClick={sync.link}>Save to your account</button>}
      {sync.state === 'signed_out' && <Link className={button} href="/app/account">Sign in</Link>}
      {['error', 'offline', 'limit', 'rate_limited', 'conflict'].includes(sync.state) && <button className={button} onClick={sync.retry}>Retry</button>}
      <BeatVersionsPanel beatId={id} project={project} sync={sync} />
      {sync.media.length > 0 && <p className="w-full text-sm text-vx-fg-muted">Only on this device: {sync.media.join(', ')}</p>}
      <BeatCloudConflictDialog sync={sync} />
    </section>}
    <BeatTransport key={`transport-${reloadKey}`} doc={doc} edit={lockedEdit} selectPattern={project.selectPattern} playing={playback.playing} loading={playback.loading} toggle={playback.toggle} clear={clear} announce={announce} />
    {undo && undo.id === project.undoId && <div className="flex items-center gap-3 rounded-xl bg-vx-panel p-3">
      <p>Pattern {undo.slot} cleared</p><button className={button} onClick={() => {
        project.undo(); setTitleDraft(null); setUndo(null); clearTimeout(undoTimer.current);
      }}>Undo</button>
    </div>}
    <BeatArrangement recording={playback.recordingRun} automationLanes={automationLanes} onAutomation={showAutomation} ai={ai} onAi={aiRequest.open} key={`arrangement-${reloadKey}`} doc={doc} edit={edit} selectPattern={project.selectPattern} editTrackId={track.id}
      onSelectRegion={(id) => { setSelectedRegionId(id); setRollOpen(true); }} setEditTrackId={setEditTrackId} locator={locator} setLocator={setLocator}
      playhead={playback.playhead} runId={playback.runId} announce={announce} />
    {mixerOpen ? <BeatMixer recording={playback.recordingRun} doc={doc} edit={edit} engine={playback.engine} close={() => setMixerOpen(false)} onAutomation={showAutomation} /> : track.kind === 'midi' ? <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={playback.record} onChange={(e) => playback.setRecord(e.target.checked)} />Record</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={playback.quantise} onChange={(e) => playback.setQuantise(e.target.checked)} />Quantise while recording</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={playback.countIn} onChange={(e) => playback.setCountIn(e.target.checked)} />Count-in 1 bar</label>
        {track.regions.length > 0 && (!midiRegion || !rollOpen) && <button className={button} onClick={() => { setSelectedRegionId(track.regions[0].id); setRollOpen(true); }}>Open piano roll</button>}
      </div>
      {midiRegion && rollOpen && !playback.recordingRun && <BeatPianoRoll playback={playback} key={midiRegion.clipId} doc={doc} region={midiRegion} edit={lockedEdit} snap={snap} setSnap={setSnap} close={() => setRollOpen(false)} />}
      <div data-beat-live><BeatKeyboard key={track.id} playback={playback} octave={octave} setOctave={setOctave} velocity={velocity} setVelocity={setVelocity} /></div>
      {playback.recordingRun && <div aria-label="Pending recording notes" className="relative h-24 overflow-hidden rounded-xl border border-vx-hue-rose">{playback.overlay.map((n, i) => <span key={i} className="absolute h-1 bg-vx-hue-rose" style={{ left: `${(n.start % (16 * 3840)) / (16 * 3840) * 100}%`, width: `${Math.max(0.5, (n.end - n.start) / (16 * 3840) * 100)}%`, top: `${(108 - n.pitch) / 87 * 90}%` }} />)}</div>}
    </> : track.kind === 'drums' && <>
      <h2 className="font-bold">Editing pattern {doc.currentPattern} (used by {uses} {uses === 1 ? 'region' : 'regions'})</h2>
      <BeatStepGrid doc={doc} edit={lockedEdit} playhead={patternPlayhead} runId={playback.runId} />
      <BeatPads hit={playback.hit} record={playback.record} setRecord={playback.setRecord} />
    </>}
    {magicBar && <BeatMagicBar hidePrompt={ai.generate} doc={doc} loops={loops} announce={announce} />}
    <p aria-live="polite" aria-atomic="true" className="min-h-6 text-sm text-vx-fg-muted">{message}</p>
  </div>;
}
