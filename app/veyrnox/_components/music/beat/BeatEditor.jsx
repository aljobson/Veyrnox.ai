'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DRUM_PADS } from '../../../../../lib/musicInstruments.js';
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
import { action, button, input, storageWarning } from './beatStyles';

export default function BeatEditor({ id }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const announce = useCallback((text) => setMessage(text), []);
  const project = useBeatProject(id, announce);
  const [editTrackId, setEditTrackId] = useState(null);
  const [locatorDraft, setLocator] = useState(0);
  const locator = project.doc ? clampLocator(locatorDraft, songEnd(project.doc)) : 0;
  const playback = useBeatPlayback(project.current, project.edit, announce, { editTrackId, locator });
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
  useEffect(() => {
    function key(event) {
      if (event.defaultPrevented || event.repeat || !doc || document.querySelector('dialog[open]')) return;
      const target = event.target;
      const textInput = target.isContentEditable || target.closest('textarea, [role="textbox"]') ||
        (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(target.type));
      if (textInput) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.key.toLowerCase() === 'y' || event.shiftKey) project.redo(); else project.undo();
        setTitleDraft(null);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest('input, select')) return;
      if (event.code === 'Space'  && !target.closest('button, a, [role="button"]')) { event.preventDefault(); playback.toggle(); return; }
      const pad = DRUM_PADS.find((item) => item.key === event.key.toLowerCase());
      if (pad) { event.preventDefault(); playback.hit(pad.id); }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [doc, playback, project]);
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
    const nextId = await project.copy();
    if (nextId) { playback.stop(); router.push(`/app/music/beats/${nextId}`); }
    else setCopying(false);
  }
  const back = <Link className={`${button} inline-flex items-center`} href="/app/music/beats">My beats</Link>;
  if (project.error) return <div className="space-y-4 p-6"><h1 className="text-2xl font-bold">{project.error === 'damaged' ? 'This beat is damaged' : "This beat isn't on this device"}</h1>{back}</div>;
  if (!doc) return <p className="p-6" aria-busy="true">Loading beat…</p>;
  const title = titleDraft ?? doc.title;
  const track = editTrack(doc, editTrackId);
  const target = playback.playhead >= 0 ? recordTarget(doc, playback.playhead, track.id) : null;
  const patternPlayhead = target?.pattern === doc.currentPattern ? target.step : -1;
  const uses = doc.tracks.flatMap((t) => t.regions).filter((r) => r.pattern === doc.currentPattern).length;
  return <div className="mx-auto min-w-0 w-full max-w-7xl space-y-5 px-2 py-6 md:px-6">
    <header className="flex flex-wrap items-center gap-3">{back}<h1 className="text-2xl font-black">Beat editor</h1>
      <button className={button} aria-disabled={!project.canUndo}
        onClick={() => { project.undo(); setTitleDraft(null); }}>Undo</button>
      <button className={button} aria-disabled={!project.canRedo}
        onClick={() => { project.redo(); setTitleDraft(null); }}>Redo</button>
    </header>
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="flex min-w-0 flex-1 flex-col gap-1">Title<input className={`${input} w-full text-xl font-bold`} maxLength={80} value={title} aria-invalid={!title.trim()} aria-describedby={!title.trim() ? 'title-error' : undefined} onChange={(e) => {
      const value = e.target.value;
      setTitleDraft(value);
      if (value.trim() && edit((d) => ops.rename(d, value), { key: 'title', label: 'rename beat' })) {
        setStoredTitle(value);
      }
    }} onBlur={() => { if (title.trim()) setTitleDraft(null); }} /></label><BeatExportDialog doc={doc} editTrackId={track.id} announce={announce} /></div>
    {!title.trim() && <p id="title-error">Give your beat a title.</p>}
    <p className="text-sm text-vx-fg-muted">{project.conflict ? 'Autosave paused' : project.saveError ? <>{"Couldn't save on this device."} <button className={button} onClick={project.retry}>Retry</button></> : !project.persistent ? 'Kept in memory for this visit' : project.dirty ? 'Saving…' : 'Saved on this device'}</p>
    {!project.persistent && <p className="rounded-xl border border-vx-border bg-vx-panel p-3">{storageWarning}</p>}
    {project.conflict && <section className="space-y-3 rounded-xl border border-vx-border bg-vx-panel p-4" aria-label="Beat changed elsewhere"><h2 className="font-bold">{project.conflict === 'deleted' ? 'This beat was deleted in another tab' : 'This beat was changed in another tab'}</h2><div className="flex flex-wrap gap-2">{project.conflict !== 'deleted' && <button className={button} onClick={() => { playback.stop(); setTitleDraft(null); setUndo(null); setLocator(0); setEditTrackId(null); setReloadKey((value) => value + 1); project.reload(); }}>Reload</button>}<button className={action} disabled={copying} onClick={copy}>{project.conflict === 'deleted' ? 'Save as a new beat' : 'Save my version as a copy'}</button></div></section>}
    {playback.audioError && <p className="rounded-xl border border-vx-border p-3">{playback.audioError}</p>}
    <BeatTransport key={`transport-${reloadKey}`} doc={doc} edit={edit} selectPattern={project.selectPattern} playing={playback.playing} toggle={playback.toggle} clear={clear} announce={announce} />
    {undo && undo.id === project.undoId && <div className="flex items-center gap-3 rounded-xl bg-vx-panel p-3">
      <p>Pattern {undo.slot} cleared</p><button className={button} onClick={() => {
        project.undo(); setTitleDraft(null); setUndo(null); clearTimeout(undoTimer.current);
      }}>Undo</button>
    </div>}
    <BeatArrangement key={`arrangement-${reloadKey}`} doc={doc} edit={edit} selectPattern={project.selectPattern} editTrackId={track.id}
      setEditTrackId={setEditTrackId} locator={locator} setLocator={setLocator}
      playhead={playback.playhead} runId={playback.runId} announce={announce} />
    <h2 className="font-bold">Editing pattern {doc.currentPattern} (used by {uses} {uses === 1 ? 'region' : 'regions'})</h2>
    <BeatStepGrid doc={doc} edit={edit} playhead={patternPlayhead} runId={playback.runId} />
    <BeatPads hit={playback.hit} record={playback.record} setRecord={playback.setRecord} />
    <p aria-live="polite" aria-atomic="true" className="min-h-6 text-sm text-vx-fg-muted">{message}</p>
  </div>;
}
