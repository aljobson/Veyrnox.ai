'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { beatErrorMessage } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import dynamic from 'next/dynamic';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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

const BeatTakeLanes = dynamic(() => import('./BeatTakeLanes'), { ssr: false });
export default function BeatArrangement({ armedId, onArm, automationLanes = {}, onAutomation, recording = false, ai, onAi, doc, edit, selectPattern, editTrackId, setEditTrackId,
  locator, setLocator, playhead, runId, announce, onSelectRegion }) {
  const { t } = useI18n();
  useEffect(() => () => clearBeatAssets(), []);
  useEffect(() => { syncAssetTempo(doc.tempo.bpm); }, [doc.tempo.bpm]);
  const [openGroup, setOpenGroup] = useState(null);
  const [trackHeights, setTrackHeights] = useState({});
  const measureTrack = useCallback((id, height) => setTrackHeights(previous => previous[id] === height ? previous : { ...previous, [id]: height }), []);
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
    announce(region.clipId ? t('app.music.beat.status.s0', { p0: doc.clips[region.clipId].name, p1: track.name }) : region.assetId ? t('app.music.beat.status.s0', { p0: doc.assets[region.assetId].name, p1: track.name }) : t('app.music.beat.status.s1', { p0: region.pattern, p1: track.name }));
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
      }, { label: BEAT_ACTIONS.a0, start });
      if (changed && addedTrack) setEditTrackId(addedTrack);
    } catch (error) { announce(beatErrorMessage(error, 'add-sound', t)); }
  }
  function drop(event, trackId) {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/x-beat-sound');
    if (!payload) return;
    const start = laneTick(event);
    try { void addSound(JSON.parse(payload), trackId, start); } catch { announce(t('app.music.beat.status.s2')); }
  }
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
    <BeatLibrary generate={ai?.generate ? () => onAi({ op: 'generate' }) : undefined} onAddInstrument={(instrument) => {
      let added;
      const result = edit((d) => { const next = midi.addMidiTrack(d, instrument); added = next.tracks.at(-1).id; return next; }, { label: BEAT_ACTIONS.a1, message: t('app.music.beat.status.s3', { p0: instrument.preset, p1: instrument.id }) });
      if (result) { setEditTrackId(added); onSelectRegion(null); }
    }} bpm={doc.tempo.bpm} announce={announce} onAdd={(item) => addSound(item, doc.tracks.find((t) => t.id === editTrackId)?.kind === 'audio' ? editTrackId : null)} />
    <section className="min-w-0 max-w-full space-y-3" aria-label={t('app.music.beat.ui.song.arrangement')}>
    <div className="flex flex-wrap items-center gap-2">
      <label>{t('app.music.beat.ui.snap')}<select className={input} value={snapValue} onChange={(e) => setSnapValue(e.target.value)}>
        <option value={3840}>{t('app.music.beat.ui.bar')}</option><option value={960}>1/4</option><option value={480}>1/8</option>
        <option value="240">1/16</option><option value="off">{t('app.music.beat.ui.off.1.16')}</option>
      </select></label>
      <button className={button} aria-label={t('app.music.beat.ui.zoom.out')} disabled={zoom === 32} onClick={() => setZoom(Math.max(32, zoom - 32))}>−</button>
      <span className="text-xs">{zoom}{t('app.music.beat.ui.px.bar')}</span>
      <button className={button} aria-label={t('app.music.beat.ui.zoom.in')} disabled={zoom === 256} onClick={() => setZoom(Math.min(256, zoom + 32))}>+</button>
      <span className="text-xs">{t('app.music.beat.ui.playhead')}{formatPosition(locator, t)}</span>
    </div>
    <div dir="ltr" className="flex min-w-0 max-w-full rounded-xl border border-vx-border">
      <div className="z-20 w-16 shrink-0 md:w-64">
        <div style={{ height: trackHeights.ruler }} className="flex min-h-40 items-center text-xs font-bold md:px-3">{t('app.music.beat.ui.tracks')}</div>
        {doc.tracks.map((track) => <Fragment key={track.id}><BeatTrackHeader recording={recording} onHeight={measureTrack} armedId={armedId} onArm={onArm} mode={doc.view} automationLane={automationLanes[track.id]} onAutomation={lane => onAutomation(track.id, lane)} track={track} edit={edit} locator={locator}
          last={doc.tracks.length === 1} selected={track.id === editTrackId} onSelect={() => { setEditTrackId(track.id); onSelectRegion(track.regions[0]?.id || null); }} />{track.takeGroups?.filter(g => g.id === openGroup).map(g => <div key={g.id} style={{ height: trackHeights[`takes:${track.id}:${g.id}`] || `${14 + g.lanes.length * 14}rem` }} />)}{automationLanes[track.id] && <div style={{ height: trackHeights[`automation:${track.id}`] }} className="min-h-72 border-b border-vx-border bg-vx-panel" />}</Fragment>)}
      </div>
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden" aria-label={t('app.music.beat.ui.arrangement.timeline')}
        onWheel={() => { manualRun.current = runId; }}
        onTouchMove={() => { manualRun.current = runId; }}
        onScroll={() => {
          if (programmaticScroll.current === scroller.current.scrollLeft) programmaticScroll.current = null;
          else manualRun.current = runId;
        }}>
        <div className="relative" style={{ width }}>
          <BeatRuler onHeight={measureTrack} bars={bars} zoom={zoom} snap={snap} locator={locator} end={end}
            setLocator={setLocator} cycle={doc.cycle} edit={edit} announce={announce} />
          {doc.tracks.map((track) => <Fragment key={track.id}><div data-track-lane={track.id}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, track.id)}
            className="relative min-h-64 border-b border-vx-border bg-vx-base md:min-h-80" style={{ height: trackHeights[track.id] }}
            onClick={(event) => { if (event.target === event.currentTarget) setLocator(clampLocator(laneTick(event), end)); }}
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget || track.kind === 'audio') return;
              const at = laneTick(event); setLocator(at);
              edit((d) => track.kind === 'midi' ? midi.addMidiRegion(d, track.id, at) : ops.addRegion(d, track.id, at, d.currentPattern), { label: BEAT_ACTIONS.a2, trackId: track.id, start: at });
            }}>
            {Array.from({ length: bars }, (_, i) => <span key={i} aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-l border-vx-border" style={{ left: i * zoom }} />)}
            {track.regions.map((region) => <BeatRegion key={region.id} region={region} track={track} doc={doc}
              zoom={zoom} snap={snap} locator={locator} selected={region.id === selectedId}
              select={() => choose(region, track)} edit={edit} drag={drag} />)}
            {track.takeGroups?.map(g => <button key={g.id} className={`${button} absolute bottom-2`} style={{ left: g.start / 3840 * zoom }} aria-expanded={g.id === openGroup} onClick={() => setOpenGroup(g.id === openGroup ? null : g.id)}>{t('app.music.beat.ui.takes')}{g.lanes.length})</button>)}
            {drag.preview?.trackId === track.id && <div aria-hidden="true"
              className="pointer-events-none absolute top-4 z-20 h-16 rounded-lg border-2 border-vx-accent bg-vx-hue-iris/60"
              style={{ left: drag.preview.start / 3840 * zoom, width: drag.preview.length / 3840 * zoom }}>
              {drag.preview.pattern}
            </div>}
          </div>{track.takeGroups?.filter(g => g.id === openGroup).map(g => <BeatTakeLanes onHeight={measureTrack} key={g.id} group={g} track={track} doc={doc} edit={edit} snap={snap} zoom={zoom} close={() => setOpenGroup(null)} />)}{automationLanes[track.id] && <BeatAutomationLane onHeight={measureTrack} track={track} lane={automationLanes[track.id]} bpm={doc.tempo.bpm} zoom={zoom} width={width} snap={snap} locator={locator} edit={edit} close={() => onAutomation(track.id, null)} />}</Fragment>)}
          <div className="min-h-20 border-b border-dashed border-vx-border p-3 text-sm text-vx-fg-muted" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, null)}>{t('app.music.beat.ui.drop.a.sound.here.to.add.an.audio.track.use.add.on.touch.screens')}</div>
          {doc.view === 'song' && <div aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-vx-accent"
            style={{ left: (playhead >= 0 ? playhead * 240 : locator) / 3840 * zoom }} />}
        </div>
      </div>
    </div>
    <button className={button} disabled={doc.tracks.length >= 16} aria-describedby="track-limit"
      onClick={() => edit((d) => ops.addTrack(d, '808'), { label: BEAT_ACTIONS.a3 })}>{t('app.music.beat.ui.add.drum.track')}</button>
    <button className={button} disabled={doc.tracks.length >= 16} onClick={() => edit((d) => ops.addAudioTrack(d), { label: BEAT_ACTIONS.a3 })}>{t('app.music.beat.ui.add.audio.track')}</button>
    {doc.tracks.length >= 16 && <p id="track-limit" className="text-xs">{t('app.music.beat.ui.a.song.can.have.at.most.16.tracks')}</p>}
    {selectedRegion && <div className="flex flex-wrap gap-2" role="group" aria-label={t('app.music.beat.ui.selected.region')}>
      {selectedRegion.pattern && <label>{t('app.music.beat.ui.region.pattern')}<select className={input} value={selectedRegion.pattern} onChange={(e) => {
        const slot = e.target.value;
        edit((d) => ops.setRegionPattern(d, selectedRegion.id, slot), { label: BEAT_ACTIONS.a4, regionId: selectedRegion.id });
        selectPattern(slot);
      }}>{['A', 'B', 'C', 'D'].map((slot) => <option key={slot}>{slot}</option>)}</select></label>}
      <button className={button} onClick={() => edit((d) => ops.splitRegion(d, selectedRegion.id, locator),
        { label: BEAT_ACTIONS.a5, regionId: selectedRegion.id })}>{t('app.music.beat.shortcut.regionSplit')}</button>
      <button className={button} onClick={() => edit((d) => ops.duplicateRegion(d, selectedRegion.id),
        { label: BEAT_ACTIONS.a6, regionId: selectedRegion.id })}>{t('app.music.beat.shortcut.regionDuplicate')}</button>
      <button className={button} onClick={() => edit((d) => ops.deleteRegion(d, selectedRegion.id),
        { label: BEAT_ACTIONS.a7, regionId: selectedRegion.id })}>{t('app.music.beat.shortcut.regionDelete')}</button>
    </div>}
    {selectedRegion?.pattern && <button className={button} onClick={() => edit((d) => midi.convertDrums(d, selectedRegion.id), { label: BEAT_ACTIONS.a8, message: t('app.music.beat.status.s4') })}>{t('app.music.beat.ui.convert.to.midi')}</button>}
    {selectedRegion?.assetId && <BeatRegionInspector ai={ai} onAi={onAi} asset={doc.assets[selectedRegion.assetId]} trackId={selectedTrack.id} region={selectedRegion} edit={edit} />}
    <BeatRegionActions tracks={doc.tracks} region={selectedRegion} track={selectedTrack} locator={locator} snap={snap} edit={edit} selectPattern={selectPattern}
      movePlayhead={(delta) => setLocator(clampLocator(locator + delta, end))} />
    <p className="text-xs text-vx-fg-muted">{t('app.music.beat.ui.drag.to.move.alt.drag.to.copy.drag.edges.to.trim.or.loop.focus.a.regio')}</p>
  </section></div>;
}
