'use client';
import { useEffect, useRef, useState } from 'react';
import { songEnd } from '../../../_lib/music/beat/beatDocument.mjs';
import { clampLocator, snapTick } from '../../../_lib/music/beat/beatTime.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import BeatRuler from './BeatRuler';
import BeatTrackHeader from './BeatTrackHeader';
import BeatRegion from './BeatRegion';
import BeatRegionActions from './BeatRegionActions';
import useRegionDrag from './useRegionDrag';
import { button, input } from './beatStyles';

export default function BeatArrangement({ doc, edit, selectPattern, editTrackId, setEditTrackId,
  locator, setLocator, playhead, runId, announce }) {
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
    setSelectedId(region.id); setEditTrackId(track.id); selectPattern(region.pattern);
    announce(`Editing pattern ${region.pattern} on ${track.name}`);
  }
  function laneTick(event) {
    return Math.max(0, Math.min(512 * 3840 - 240,
      snapTick((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom * 3840, snap)));
  }
  return <section className="min-w-0 max-w-full space-y-3" aria-label="Song arrangement">
    <div className="flex flex-wrap items-center gap-2">
      <label>Snap <select className={input} value={snapValue} onChange={(e) => setSnapValue(e.target.value)}>
        <option value={3840}>Bar</option><option value={960}>1/4</option><option value={480}>1/8</option>
        <option value="240">1/16</option><option value="off">Off (1/16)</option>
      </select></label>
      <button className={button} aria-label="Zoom out" disabled={zoom === 32} onClick={() => setZoom(Math.max(32, zoom - 32))}>−</button>
      <span className="text-xs">{zoom} px/bar</span>
      <button className={button} aria-label="Zoom in" disabled={zoom === 256} onClick={() => setZoom(Math.min(256, zoom + 32))}>+</button>
      <span className="text-xs">Playhead: bar {locator / 3840 + 1}</span>
    </div>
    <div className="flex min-w-0 max-w-full rounded-xl border border-vx-border">
      <div className="z-20 w-16 shrink-0 md:w-64">
        <div className="flex h-24 items-center text-xs font-bold md:px-3">Drum tracks</div>
        {doc.tracks.map((track) => <BeatTrackHeader key={track.id} track={track} edit={edit} locator={locator}
          last={doc.tracks.length === 1} selected={track.id === editTrackId} onSelect={() => setEditTrackId(track.id)} />)}
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
          {doc.tracks.map((track) => <div key={track.id} data-track-lane={track.id}
            className="relative h-48 border-b border-vx-border bg-vx-base md:h-80"
            onClick={(event) => { if (event.target === event.currentTarget) setLocator(clampLocator(laneTick(event), end)); }}
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget) return;
              const at = laneTick(event); setLocator(at);
              edit((d) => ops.addRegion(d, track.id, at, d.currentPattern), { label: 'add region' });
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
          </div>)}
          {doc.view === 'song' && <div aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-vx-accent"
            style={{ left: (playhead >= 0 ? playhead * 240 : locator) / 3840 * zoom }} />}
        </div>
      </div>
    </div>
    <button className={button} disabled={doc.tracks.length >= 16} aria-describedby="track-limit"
      onClick={() => edit((d) => ops.addTrack(d, '808'), { label: 'add track' })}>+ Add drum track</button>
    {doc.tracks.length >= 16 && <p id="track-limit" className="text-xs">A song can have at most 16 tracks.</p>}
    {selectedRegion && <div className="hidden flex-wrap gap-2 md:flex" role="group" aria-label="Selected region">
      <label>Region pattern <select className={input} value={selectedRegion.pattern} onChange={(e) => {
        const slot = e.target.value;
        edit((d) => ops.setRegionPattern(d, selectedRegion.id, slot), { label: 'change region pattern' });
        selectPattern(slot);
      }}>{['A', 'B', 'C', 'D'].map((slot) => <option key={slot}>{slot}</option>)}</select></label>
      <button className={button} onClick={() => edit((d) => ops.splitRegion(d, selectedRegion.id, locator),
        { label: 'split region' })}>Split at playhead</button>
      <button className={button} onClick={() => edit((d) => ops.duplicateRegion(d, selectedRegion.id),
        { label: 'duplicate region' })}>Duplicate</button>
      <button className={button} onClick={() => edit((d) => ops.deleteRegion(d, selectedRegion.id),
        { label: 'delete region' })}>Delete region</button>
    </div>}
    <BeatRegionActions region={selectedRegion} track={selectedTrack} locator={locator} snap={snap} edit={edit} selectPattern={selectPattern}
      movePlayhead={(delta) => setLocator(clampLocator(locator + delta, end))} />
    <p className="text-xs text-vx-fg-muted">Drag to move; Alt-drag to copy. Drag edges to trim or loop.
      Focus a region: arrows move; Shift+arrows resize; [ and ] trim; Ctrl/⌘+D duplicates;
      Ctrl/⌘+E splits at the playhead; Delete removes; Enter edits its pattern.
      Focus the ruler: arrows move the playhead, Page Up/Down move a bar, Home/End jump.</p>
  </section>;
}
