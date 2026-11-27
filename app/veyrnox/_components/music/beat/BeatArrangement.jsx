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
import BeatClipSearch from './BeatClipSearch';
import { guardRipple } from '../../../_lib/music/beat/beatRippleGuard.mjs';
import { rippleDeleteRegion, rippleInsertGap } from '../../../_lib/music/beat/beatRipple.mjs';
import useRegionDrag from './useRegionDrag';
import { button, input } from './beatStyles';

const BeatTakeLanes = dynamic(() => import('./BeatTakeLanes'), { ssr: false });
function ArrangementIcon({ name }) {
  const path = name === 'library' ? 'M4 6h16v12H4z M7 9h2v6H7z M12 8h2v7h-2z M17 10h2v5h-2z' : name === 'drums' ? 'M5 10h14v6c0 3-14 3-14 0z M5 10c0-3 14-3 14 0 M9 7l-2-4 M15 7l2-4' : name === 'audio' ? 'M4 12h2l2-6 3 12 3-10 2 4h4' : 'M12 5v14 M5 12h14';
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}
export default function BeatArrangement({ armedId, onArm, automationLanes = {}, onAutomation, recording = false, ai, onAi, doc, edit, selectPattern, editTrackId, setEditTrackId,
  locator, setLocator, playhead, runId, announce, onSelectRegion, ripple = false, setRipple }) {
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
  const [activeTool, setActiveTool] = useState(null);
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
  function rippleEdit(request, options) {
    return edit(d => {
      const guard = guardRipple(d, request);
      if (!guard.ok) throw new ops.BeatRefusal(guard.reason);
      try {
        return request.type === 'delete' ? rippleDeleteRegion(d, request.trackId, request.regionId)
          : rippleInsertGap(d, request.trackId, request.atTick, 3840);
      } catch (error) {
        if (error instanceof ops.BeatRefusal && error.code) throw new ops.BeatRefusal(error.code);
        throw error;
      }
    }, options);
  }
  function deleteRegion(region, track) {
    return ripple ? rippleEdit({ type: 'delete', trackId: track.id, regionId: region.id }, { label: BEAT_ACTIONS.a59, regionId: region.id })
      : edit(d => ops.deleteRegion(d, region.id), { label: BEAT_ACTIONS.a7, regionId: region.id });
  }
  function searchChoose(result) {
    const track = doc.tracks.find(t => t.id === result.trackId);
    const region = track?.regions.find(r => r.id === result.regionId);
    if (!region) return;
    choose(region, track);
    setLocator(clampLocator(region.start, end));
    const lane = [...(scroller.current?.querySelectorAll('[data-track-lane]') || [])].find(el => el.dataset.trackLane === track.id);
    lane?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, region.start / 3840 * zoom - zoom);
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
  function addInstrument(instrument) {
    let added;
    const result = edit((d) => { const next = midi.addMidiTrack(d, instrument); added = next.tracks.at(-1).id; return next; }, { label: BEAT_ACTIONS.a1, message: t('app.music.beat.status.s3', { p0: instrument.preset, p1: instrument.id }) });
    if (result) { setEditTrackId(added); onSelectRegion(null); setActiveTool(null); }
  }
  function drop(event, trackId) {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/x-beat-sound');
    if (!payload) return;
    const start = laneTick(event);
    try { void addSound(JSON.parse(payload), trackId, start); } catch { announce(t('app.music.beat.status.s2')); }
  }
  return <div className="min-w-0 space-y-3">
    <section className="min-w-0 max-w-full space-y-3" aria-label={t('app.music.beat.ui.song.arrangement')}>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-vx-border bg-vx-panel p-2">
      <label className="text-xs font-bold">{t('app.music.beat.ui.snap')}<select className={`${input} ms-2 min-h-9 py-1.5`} value={snapValue} onChange={(e) => setSnapValue(e.target.value)}>
        <option value={3840}>{t('app.music.beat.ui.bar')}</option><option value={960}>1/4</option><option value={480}>1/8</option>
        <option value="240">1/16</option><option value="off">{t('app.music.beat.ui.off.1.16')}</option>
      </select></label>
      <button data-beat-read className={`${button} min-h-9 min-w-9 rounded-lg px-0 py-1.5`} aria-label={t('app.music.beat.ui.zoom.out')} disabled={zoom === 32} onClick={() => setZoom(Math.max(32, zoom - 32))}>−</button>
      <span className="text-xs">{zoom}{t('app.music.beat.ui.px.bar')}</span>
      <button data-beat-read className={`${button} min-h-9 min-w-9 rounded-lg px-0 py-1.5`} aria-label={t('app.music.beat.ui.zoom.in')} disabled={zoom === 256} onClick={() => setZoom(Math.min(256, zoom + 32))}>+</button>
      <span className="text-xs">{t('app.music.beat.ui.playhead')}{formatPosition(locator, t)}</span>
      <button className={`${button} ${ripple ? 'bg-vx-accent text-vx-accent-ink' : ''}`} aria-pressed={ripple}
        onClick={() => setRipple(value => !value)}>{t('app.music.beat.shortcut.ripple')}</button>
      <button className={button} disabled={!selectedRegion} onClick={() => rippleEdit(
        { type: 'insert', trackId: selectedTrack.id, atTick: snapTick(locator, snap) },
        { label: BEAT_ACTIONS.a60, regionId: selectedRegion.id })}>{t('app.music.beat.ripple.insert')}</button>
      {ripple && <p className="w-full text-xs text-vx-fg-muted">{t('app.music.beat.ripple.hint')}</p>}
      <BeatClipSearch doc={doc} choose={searchChoose} />
    </div>
    <div dir="ltr" className="flex min-w-0 max-w-full rounded-xl border border-vx-border">
      <div className="z-20 w-16 shrink-0 md:w-48">
        <div style={{ height: trackHeights.ruler }} className="flex min-h-28 items-center text-xs font-bold md:px-3">{t('app.music.beat.ui.tracks')}</div>
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
            className="relative min-h-36 border-b border-vx-border bg-vx-base" style={{ height: trackHeights[track.id] }}
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
              select={() => choose(region, track)} edit={edit} drag={drag} onDelete={() => deleteRegion(region, track)} />)}
            {track.takeGroups?.map(g => <button data-beat-read key={g.id} className={`${button} absolute bottom-2`} style={{ left: g.start / 3840 * zoom }} aria-expanded={g.id === openGroup} onClick={() => setOpenGroup(g.id === openGroup ? null : g.id)}>{t('app.music.beat.ui.takes')}{g.lanes.length})</button>)}
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
    <nav className="flex items-center justify-center gap-1 rounded-2xl border border-vx-border bg-vx-panel p-1.5" aria-label={t('app.music.beat.ui.library.tabs')}>
      <button data-beat-tip="library" className={`${button} inline-flex min-h-10 items-center gap-2 rounded-xl border-0 px-3 py-1.5 ${activeTool === 'library' ? 'bg-vx-accent text-vx-accent-ink' : 'bg-transparent'}`} aria-pressed={activeTool === 'library'} onClick={() => setActiveTool(value => value === 'library' ? null : 'library')}><ArrangementIcon name="library" />{t('app.music.beat.ui.library')}</button>
      <button className={`${button} inline-flex min-h-10 items-center gap-2 rounded-xl border-0 px-3 py-1.5 ${activeTool === 'tracks' ? 'bg-vx-accent text-vx-accent-ink' : 'bg-transparent'}`} aria-pressed={activeTool === 'tracks'} onClick={() => setActiveTool(value => value === 'tracks' ? null : 'tracks')}><ArrangementIcon name="add" />{t('app.music.beat.ui.tracks')}</button>
    </nav>
    {activeTool === 'library' && <BeatLibrary inline generate={ai?.generate ? () => onAi({ op: 'generate' }) : undefined} onAddInstrument={addInstrument} bpm={doc.tempo.bpm} announce={announce} onAdd={(item) => addSound(item, doc.tracks.find((t) => t.id === editTrackId)?.kind === 'audio' ? editTrackId : null)} />}
    {activeTool === 'tracks' && <section className="flex flex-wrap justify-center gap-2 rounded-2xl border border-vx-border bg-vx-panel p-3" aria-label={t('app.music.beat.ui.add.drum.track')}>
      <button className={`${button} inline-flex items-center gap-2`} disabled={doc.tracks.length >= 16} aria-describedby="track-limit" onClick={() => { edit((d) => ops.addTrack(d, '808'), { label: BEAT_ACTIONS.a3 }); setActiveTool(null); }}><ArrangementIcon name="drums" />{t('app.music.beat.ui.add.drum.track')}</button>
      <button className={`${button} inline-flex items-center gap-2`} disabled={doc.tracks.length >= 16} onClick={() => { edit((d) => ops.addAudioTrack(d), { label: BEAT_ACTIONS.a3 }); setActiveTool(null); }}><ArrangementIcon name="audio" />{t('app.music.beat.ui.add.audio.track')}</button>
    </section>}
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
      <button className={button} onClick={() => deleteRegion(selectedRegion, selectedTrack)}>{t('app.music.beat.shortcut.regionDelete')}</button>
    </div>}
    {selectedRegion?.pattern && <button className={button} onClick={() => edit((d) => midi.convertDrums(d, selectedRegion.id), { label: BEAT_ACTIONS.a8, message: t('app.music.beat.status.s4') })}>{t('app.music.beat.ui.convert.to.midi')}</button>}
    {selectedRegion?.assetId && <BeatRegionInspector ai={ai} onAi={onAi} asset={doc.assets[selectedRegion.assetId]} trackId={selectedTrack.id} region={selectedRegion} edit={edit} />}
    <BeatRegionActions tracks={doc.tracks} region={selectedRegion} track={selectedTrack} locator={locator} snap={snap} edit={edit} selectPattern={selectPattern}
      movePlayhead={(delta) => setLocator(clampLocator(locator + delta, end))} />
    <p className="text-xs text-vx-fg-muted">{t('app.music.beat.ui.drag.to.move.alt.drag.to.copy.drag.edges.to.trim.or.loop.focus.a.regio')}</p>
  </section></div>;
}
