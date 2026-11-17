'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { songEnd } from '../../../_lib/music/beat/beatDocument.mjs';
import { clampLocator, snapTick, formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import * as midi from '../../../_lib/music/beat/beatMidiOps.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import BeatAutomationLane from './BeatAutomationLane';
import BeatRuler from './BeatRuler';
import BeatTrackHeader from './BeatTrackHeader';
import BeatRegion from './BeatRegion';
import BeatRegionInspector from './BeatRegionInspector';
import BeatLibrary from './BeatLibrary';
import { prepareAsset, syncAssetTempo, clearBeatAssets } from '../../../_lib/music/beat/beatAssets';
import { soundDuration } from '../../../_lib/music/beat/beatSounds.mjs';
import BeatRegionActions from './BeatRegionActions';
import useRegionDrag from './useRegionDrag';
import { button, input } from './beatStyles';

export default function BeatArrangement({ automationLanes = {}, onAutomation, recording = false, ai, onAi, doc, edit, selectPattern, editTrackId, setEditTrackId,
  locator, setLocator, playhead, runId, announce, onSelectRegion }) {
  useEffect(() => () => clearBeatAssets(), []);
  useEffect(() => { syncAssetTempo(doc.tempo.bpm); }, [doc.tempo.bpm]);
  const [zoom, setZoom] = useState(96);
  const [snapValue, setSnapValue] = useState('240');
  const snap = snapValue === 'off' ? 240 : Number(snapValue);
  const [selectedId, setSelectedId] = useState(null);
  const scroller = useRef(null);
  const manualRun = useRef(null);
  const programmaticScroll = useRef(null);
  const end = songEnd(doc);
  const bars = Math.min(512, Math.max(16, Math.ceil(Math.max(end, doc.cycle.end, locator) / 3840) + 4));
  const width = bars * zoom;
  const drag = useRegionDrag({ scroller, zoom, snap, edit, announce });
  const selectedTrack = doc.tracks.find((track) => track.regions.some((r) => r.id === selectedId));
  const selectedRegion = selectedTrack?.regions.find((r) => r.id === selectedId);
  useEffect(() => {
    if (doc.view !== 'song' || playhead < 0 || runId === null || manualRun.current === runId) return;
    const element = scroller.current;
    const x = playhead / 16 * zoom;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 32) {
      const left = Math.max(0, x - element.clientWidth / 4);
      element.scrollLeft = left;
      programmaticScroll.current = element.scrollLeft;
    }
  }, [playhead, runId, zoom, doc.view]);
  function choose(region, track) {
    setSelectedId(region.id); onSelectRegion(region.id); setEditTrackId(track.id); if (region.pattern) selectPattern(region.pattern);
    announce(region.clipId ? `Editing ${doc.clips[region.clipId].name} on ${track.name}` : region.assetId ? `Editing ${doc.assets[region.assetId].name} on ${track.name}` : `Editing pattern ${region.pattern} on ${track.name}`);
  }
  function laneTick(event) {
    return Math.max(0, Math.min(512 * 3840 - 240,
      snapTick((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom * 3840, snap)));
  }
  async function addSound(item, trackId, start = locator) {
    try {
      const asset = await prepareAsset(item, doc.tempo.bpm);
      let addedTrack;
      const changed = edit((d) => {
        const next = ops.addAudioRegion(d, asset.source === 'sound' ? { ...asset, durationSec: soundDuration(asset.ref, d.tempo.bpm) } : asset, trackId, start);
        addedTrack = trackId || next.tracks.at(-1).id;
        return next;
      }, { label: 'add audio region', start });
      if (changed && addedTrack) setEditTrackId(addedTrack);
    } catch (error) { announce(error.message || 'Could not add sound.'); }
  }
  function drop(event, trackId) {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/x-beat-sound');
    if (!payload) return;
    const start = laneTick(event);
    try { void addSound(JSON.parse(payload), trackId, start); } catch { announce('Could not read that sound.'); }
  }
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
    <BeatLibrary onAddInstrument={(instrument) => {
      let added;
      const result = edit((d) => { const next = midi.addMidiTrack(d, instrument); added = next.tracks.at(-1).id; return next; }, { label: 'add MIDI track', message: `Added ${instrument.preset} ${instrument.id} track` });
      if (result) { setEditTrackId(added); onSelectRegion(null); }
    }} bpm={doc.tempo.bpm} announce={announce} onAdd={(item) => addSound(item, doc.tracks.find((t) => t.id === editTrackId)?.kind === 'audio' ? editTrackId : null)} />
    <section className="min-w-0 max-w-full space-y-3" aria-label="Song arrangement">
    <div className="flex flex-wrap items-center gap-2">
      <label>Snap <select className={input} value={snapValue} onChange={(e) => setSnapValue(e.target.value)}>
        <option value={3840}>Bar</option><option value={960}>1/4</option><option value={480}>1/8</option>
        <option value="240">1/16</option><option value="off">Off (1/16)</option>
      </select></label>
      <button className={button} aria-label="Zoom out" disabled={zoom === 32} onClick={() => setZoom(Math.max(32, zoom - 32))}>−</button>
      <span className="text-xs">{zoom} px/bar</span>
      <button className={button} aria-label="Zoom in" disabled={zoom === 256} onClick={() => setZoom(Math.min(256, zoom + 32))}>+</button>
      <span className="text-xs">Playhead: {formatPosition(locator)}</span>
    </div>
    <div className="flex min-w-0 max-w-full rounded-xl border border-vx-border">
      <div className="z-20 w-16 shrink-0 md:w-64">
        <div className="flex h-24 items-center text-xs font-bold md:px-3">Tracks</div>
        {doc.tracks.map((track) => <Fragment key={track.id}><BeatTrackHeader recording={recording} mode={doc.view} automationLane={automationLanes[track.id]} onAutomation={lane => onAutomation(track.id, lane)} track={track} edit={edit} locator={locator}
          last={doc.tracks.length === 1} selected={track.id === editTrackId} onSelect={() => { setEditTrackId(track.id); onSelectRegion(track.regions[0]?.id || null); }} />{automationLanes[track.id] && <div className="h-52 border-b border-vx-border bg-vx-panel" />}</Fragment>)}
      </div>
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden" aria-label="Arrangement timeline"
        onWheel={() => { manualRun.current = runId; }}
        onTouchMove={() => { manualRun.current = runId; }}
        onScroll={() => {
          if (programmaticScroll.current === scroller.current.scrollLeft) programmaticScroll.current = null;
          else manualRun.current = runId;
        }}>
        <div className="relative" style={{ width }}>
          <BeatRuler bars={bars} zoom={zoom} snap={snap} locator={locator} end={end}
            setLocator={setLocator} cycle={doc.cycle} edit={edit} announce={announce} />
          {doc.tracks.map((track) => <Fragment key={track.id}><div data-track-lane={track.id}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, track.id)}
            className="relative h-48 border-b border-vx-border bg-vx-base md:h-80"
            onClick={(event) => { if (event.target === event.currentTarget) setLocator(clampLocator(laneTick(event), end)); }}
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget || track.kind === 'audio') return;
              const at = laneTick(event); setLocator(at);
              edit((d) => track.kind === 'midi' ? midi.addMidiRegion(d, track.id, at) : ops.addRegion(d, track.id, at, d.currentPattern), { label: 'add region', trackId: track.id, start: at });
            }}>
            {Array.from({ length: bars }, (_, i) => <span key={i} aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-l border-vx-border" style={{ left: i * zoom }} />)}
            {track.regions.map((region) => <BeatRegion key={region.id} region={region} track={track} doc={doc}
              zoom={zoom} snap={snap} locator={locator} selected={region.id === selectedId}
              select={() => choose(region, track)} edit={edit} drag={drag} />)}
            {drag.preview?.trackId === track.id && <div aria-hidden="true"
              className="pointer-events-none absolute top-4 z-20 h-16 rounded-lg border-2 border-vx-accent bg-vx-hue-iris/60"
              style={{ left: drag.preview.start / 3840 * zoom, width: drag.preview.length / 3840 * zoom }}>
              {drag.preview.pattern}
            </div>}
          </div>{automationLanes[track.id] && <BeatAutomationLane track={track} lane={automationLanes[track.id]} bpm={doc.tempo.bpm} zoom={zoom} width={width} snap={snap} locator={locator} edit={edit} close={() => onAutomation(track.id, null)} />}</Fragment>)}
          <div className="h-20 border-b border-dashed border-vx-border p-3 text-sm text-vx-fg-muted" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, null)}>Drop a sound here to add an audio track. Use Add on touch screens.</div>
          {doc.view === 'song' && <div aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-vx-accent"
            style={{ left: (playhead >= 0 ? playhead * 240 : locator) / 3840 * zoom }} />}
        </div>
      </div>
    </div>
    <button className={button} disabled={doc.tracks.length >= 16} aria-describedby="track-limit"
      onClick={() => edit((d) => ops.addTrack(d, '808'), { label: 'add track' })}>+ Add drum track</button>
    <button className={button} disabled={doc.tracks.length >= 16} onClick={() => edit((d) => ops.addAudioTrack(d), { label: 'add track' })}>+ Add audio track</button>
    {doc.tracks.length >= 16 && <p id="track-limit" className="text-xs">A song can have at most 16 tracks.</p>}
    {selectedRegion && <div className="hidden flex-wrap gap-2 md:flex" role="group" aria-label="Selected region">
      {selectedRegion.pattern && <label>Region pattern <select className={input} value={selectedRegion.pattern} onChange={(e) => {
        const slot = e.target.value;
        edit((d) => ops.setRegionPattern(d, selectedRegion.id, slot), { label: 'change region pattern', regionId: selectedRegion.id });
        selectPattern(slot);
      }}>{['A', 'B', 'C', 'D'].map((slot) => <option key={slot}>{slot}</option>)}</select></label>}
      <button className={button} onClick={() => edit((d) => ops.splitRegion(d, selectedRegion.id, locator),
        { label: 'split region', regionId: selectedRegion.id })}>Split at playhead</button>
      <button className={button} onClick={() => edit((d) => ops.duplicateRegion(d, selectedRegion.id),
        { label: 'duplicate region', regionId: selectedRegion.id })}>Duplicate</button>
      <button className={button} onClick={() => edit((d) => ops.deleteRegion(d, selectedRegion.id),
        { label: 'delete region', regionId: selectedRegion.id })}>Delete region</button>
    </div>}
    {selectedRegion?.pattern && <button className={button} onClick={() => edit((d) => midi.convertDrums(d, selectedRegion.id), { label: 'convert drums to MIDI', message: 'Converted to MIDI. The original drum region remains and its track is muted.' })}>Convert to MIDI</button>}
    {selectedRegion?.assetId && <BeatRegionInspector ai={ai} onAi={onAi} asset={doc.assets[selectedRegion.assetId]} trackId={selectedTrack.id} region={selectedRegion} edit={edit} />}
    <BeatRegionActions region={selectedRegion} track={selectedTrack} locator={locator} snap={snap} edit={edit} selectPattern={selectPattern}
      movePlayhead={(delta) => setLocator(clampLocator(locator + delta, end))} />
    <p className="text-xs text-vx-fg-muted">Drag to move; Alt-drag to copy. Drag edges to trim or loop.
      Focus a region: arrows move; Shift+arrows resize; [ and ] trim; Ctrl/⌘+D duplicates;
      Ctrl/⌘+E splits at the playhead; Delete removes; Enter edits its pattern.
      Focus the ruler: arrows move the playhead, Page Up/Down move a bar, Home/End jump.</p>
  </section></div>;
}
