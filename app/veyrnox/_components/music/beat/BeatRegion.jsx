'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useSyncExternalStore } from 'react';
import { assetState, subscribeAssets } from '../../../_lib/music/beat/beatAssets.js';
import BeatMidiPreview from './BeatMidiPreview';
import BeatAudioRegion, { BeatAudioRetry } from './BeatAudioRegion';
import { formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import { audioLoopLabel, drumLoopLabel } from '../../../_lib/music/beat/beatPlaybackAudio.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';

const trimModes = ['trim', 'resize'];
export default function BeatRegion({ region, track, doc, zoom, snap, locator, selected, select, edit, drag, onDelete }) {
  const { t, locale } = useI18n();
  const position = { left: region.start / 3840 * zoom, width: region.length / 3840 * zoom };
  const asset = region.assetId && doc.assets[region.assetId];
  const held = useSyncExternalStore(subscribeAssets, () => !!asset && assetState(asset, doc.tempo.bpm).status === 'held', () => false);
  const clip = region.clipId && doc.clips[region.clipId];
  const loops = clip ? t('app.music.beat.status.s39', { p0: Math.ceil(region.length / clip.lengthTicks) }) : asset ? audioLoopLabel(region, asset, doc.tempo.bpm, t, locale) : drumLoopLabel(region, doc.steps, t);
  const name = t('app.music.beat.status.s40', { p0: selected ? t('app.music.beat.status.s41') : '', p1: clip ? t('app.music.beat.status.s42', { p0: clip.name }) : asset ? t('app.music.beat.status.s43', { p0: asset.name }) : t('app.music.beat.status.s44', { p0: region.pattern }), p2: track.name }) +
    t('app.music.beat.status.s45', { p0: formatPosition(region.start, t), p1: formatPosition(region.start + region.length, t), p2: loops, p3: asset ? t('app.music.beat.status.s46', { p0: region.gainDb }) : '', p4: region.tailSec ? t('app.music.beat.status.s47', { p0: Math.round(region.tailSec * 1000) }) : '' });
  function key(event) {
    const command = event.ctrlKey || event.metaKey;
    let operation, label;
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (direction) {
      label = event.shiftKey ? BEAT_ACTIONS.a44 : BEAT_ACTIONS.a42;
      operation = event.shiftKey ? (d) => ops.resizeRegion(d, region.id, region.length + direction * snap)
        : (d) => ops.moveRegion(d, region.id, Math.max(0, region.start + direction * snap), track.id);
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const index = doc.tracks.findIndex((t) => t.id === track.id) + (event.key === 'ArrowUp' ? -1 : 1);
      label = BEAT_ACTIONS.a42;
      operation = (d) => ops.moveRegion(d, region.id, region.start, doc.tracks[Math.max(0, Math.min(doc.tracks.length - 1, index))].id);
    } else if (['[', ']'].includes(event.key)) {
      label = BEAT_ACTIONS.a43;
      operation = (d) => ops.trimRegionStart(d, region.id, region.start + (event.key === '[' ? -snap : snap));
    } else if (command && event.key.toLowerCase() === 'd') {
      label = BEAT_ACTIONS.a6; operation = (d) => ops.duplicateRegion(d, region.id);
    } else if (command && event.key.toLowerCase() === 'e') {
      label = BEAT_ACTIONS.a5; operation = (d) => ops.splitRegion(d, region.id, locator);
    } else if (['Delete', 'Backspace'].includes(event.key)) {
      label = BEAT_ACTIONS.a7; operation = (d) => ops.deleteRegion(d, region.id);
    } else if (event.key === 'Enter') { event.preventDefault(); select(); }
    if (operation) {
      event.preventDefault();
      if (['Delete', 'Backspace'].includes(event.key) && onDelete) onDelete();
      else edit(operation, { label, regionId: region.id });
      // Moving between keyed lanes remounts the button. Keep keyboard editing continuous.
      requestAnimationFrame(() => {
        const buttons = document.querySelectorAll('[data-region-id]');
        const next = [...buttons].find((element) => element.dataset.regionId === region.id);
        (next || document.querySelector('[data-beat-ruler-position]'))?.focus();
      });
    }
  }
  const dots = asset || clip ? [] : Object.values(doc.patterns[region.pattern].rows).flat().slice(0, 32);
  return <div className="absolute top-4 h-16" style={position}>
    <button data-beat-tip="arrangement" data-region-id={region.id} className={`absolute inset-0 min-h-11 touch-none overflow-hidden rounded-lg
      border ${clip ? 'border-vx-hue-rose bg-vx-hue-rose/35' : asset ? 'border-vx-hue-sky bg-vx-hue-sky/35' : 'border-vx-hue-iris bg-vx-hue-iris/35'} text-vx-fg focus-visible:z-20 focus-visible:outline
      focus-visible:outline-2 focus-visible:outline-vx-accent ${selected ? 'ring-2 ring-vx-accent' : ''}`}
      aria-label={held ? t('app.music.beat.labels.l31', { p0: name }) : name} aria-pressed={selected} onKeyDown={key}
      onPointerDown={(event) => drag.begin(event, region, track.id)}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail !== 0 && drag.consumeClick()) return;
        select();
      }} onDoubleClick={(event) => event.stopPropagation()}>
      <span className="block">{clip ? <BeatMidiPreview clip={clip} /> : asset ? <BeatAudioRegion region={region} asset={asset} bpm={doc.tempo.bpm} zoom={zoom} /> : region.pattern}</span>
      <span aria-hidden="true" className="block truncate px-3 text-xs">{dots.map(() => '•').join(' ')}</span>
    </button>
    {region.tailSec && <span aria-hidden="true" className="pointer-events-none absolute left-full top-0 h-16 border-r border-dashed border-vx-hue-sky bg-vx-hue-sky/25" style={{ width: Math.max(1, region.tailSec * doc.tempo.bpm / 240 * zoom) }} />}
    {asset && <BeatAudioRetry asset={asset} bpm={doc.tempo.bpm} reverse={region.reverse} />}
    {trimModes.map((mode) => <span key={mode} aria-hidden="true"
      className={`absolute top-0 z-10 h-16 w-3 touch-none cursor-ew-resize rounded ${asset ? 'bg-vx-hue-sky/25' : 'bg-vx-hue-iris/25'}
        ${mode === 'trim' ? 'left-0' : 'right-0'}`}
      onPointerDown={(event) => drag.begin(event, region, track.id, mode)}
      onClick={(event) => {
        event.stopPropagation();
        if (!drag.consumeClick()) select();
      }} onDoubleClick={(event) => event.stopPropagation()} />)}
  </div>;
}
