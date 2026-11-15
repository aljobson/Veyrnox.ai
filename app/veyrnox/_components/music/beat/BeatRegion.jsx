'use client';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';

export default function BeatRegion({ region, track, doc, zoom, snap, locator, selected, select, edit, drag }) {
  const position = { left: region.start / 3840 * zoom, width: region.length / 3840 * zoom };
  const loops = region.length / (doc.steps * 240);
  const name = `${selected ? 'Selected, ' : ''}Pattern ${region.pattern} on ${track.name}, ` +
    `bars ${region.start / 3840 + 1} to ${(region.start + region.length) / 3840}, looped ${loops === 1 ? 'once' : `${loops} times`}`;
  function key(event) {
    const command = event.ctrlKey || event.metaKey;
    let operation, label;
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (direction) {
      label = event.shiftKey ? 'resize region' : 'move region';
      operation = event.shiftKey ? (d) => ops.resizeRegion(d, region.id, region.length + direction * snap)
        : (d) => ops.moveRegion(d, region.id, Math.max(0, region.start + direction * snap), track.id);
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const index = doc.tracks.findIndex((t) => t.id === track.id) + (event.key === 'ArrowUp' ? -1 : 1);
      label = 'move region';
      operation = (d) => ops.moveRegion(d, region.id, region.start, doc.tracks[Math.max(0, Math.min(doc.tracks.length - 1, index))].id);
    } else if (['[', ']'].includes(event.key)) {
      label = 'trim region';
      operation = (d) => ops.trimRegionStart(d, region.id, region.start + (event.key === '[' ? -snap : snap));
    } else if (command && event.key.toLowerCase() === 'd') {
      label = 'duplicate region'; operation = (d) => ops.duplicateRegion(d, region.id);
    } else if (command && event.key.toLowerCase() === 'e') {
      label = 'split region'; operation = (d) => ops.splitRegion(d, region.id, locator);
    } else if (['Delete', 'Backspace'].includes(event.key)) {
      label = 'delete region'; operation = (d) => ops.deleteRegion(d, region.id);
    } else if (event.key === 'Enter') { event.preventDefault(); select(); }
    if (operation) {
      event.preventDefault(); edit(operation, { label, regionId: region.id });
      // Moving between keyed lanes remounts the button. Keep keyboard editing continuous.
      requestAnimationFrame(() => {
        const buttons = document.querySelectorAll('[data-region-id]');
        const next = [...buttons].find((element) => element.dataset.regionId === region.id);
        (next || document.querySelector('[aria-label="Playhead position"]'))?.focus();
      });
    }
  }
  const dots = Object.values(doc.patterns[region.pattern].rows).flat().slice(0, 32);
  return <div className="absolute top-4 h-16" style={position}>
    <button data-region-id={region.id} className={`absolute inset-0 min-h-11 touch-none overflow-hidden rounded-lg
      border border-vx-hue-iris bg-vx-hue-iris/35 text-vx-fg focus-visible:z-20 focus-visible:outline
      focus-visible:outline-2 focus-visible:outline-vx-accent ${selected ? 'ring-2 ring-vx-accent' : ''}`}
      aria-label={name} aria-pressed={selected} onKeyDown={key}
      onPointerDown={(event) => drag.begin(event, region, track.id)}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail !== 0 && drag.consumeClick()) return;
        select();
      }} onDoubleClick={(event) => event.stopPropagation()}>
      <span className="block truncate px-3 font-bold">{region.pattern}</span>
      <span aria-hidden="true" className="block truncate px-3 text-xs">{dots.map(() => '•').join(' ')}</span>
    </button>
    {['trim', 'resize'].map((mode) => <span key={mode} aria-hidden="true"
      className={`absolute top-0 z-10 h-16 w-3 touch-none cursor-ew-resize rounded bg-vx-hue-iris/25
        ${mode === 'trim' ? 'left-0' : 'right-0'}`}
      onPointerDown={(event) => drag.begin(event, region, track.id, mode)}
      onClick={(event) => {
        event.stopPropagation();
        if (!drag.consumeClick()) select();
      }} onDoubleClick={(event) => event.stopPropagation()} />)}
  </div>;
}
