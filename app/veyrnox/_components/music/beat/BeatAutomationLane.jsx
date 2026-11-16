'use client';
import { useRef, useState } from 'react';
import { automationEnvelope, envelopeAt } from '../../../_lib/music/beat/beatAutomation.mjs';
import { BEAT_LIMITS } from '../../../_lib/music/beat/beatDocument.mjs';
import { formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import * as ops from '../../../_lib/music/beat/beatMixOps.mjs';
import { button, input } from './beatStyles';
export default function BeatAutomationLane({ track, lane, bpm, zoom, width, snap, locator, edit, close }) {
  const points = track.automation?.[lane] || [], envelope = automationEnvelope(points, bpm);
  const [selected, setSelected] = useState(null), drag = useRef(null), surface = useRef(null);
  const min = lane === 'gain' ? 0 : -1, name = lane === 'gain' ? 'Gain' : 'Pan';
  const x = tick => tick / 3840 * zoom, y = value => 100 - (value - min) / (1 - min) * 100;
  const sec = tick => tick / 960 * 60 / bpm;
  const at = tick => points.length ? envelopeAt(envelope, sec(tick)) : track[lane];
  function tickAt(event) { return Math.max(0, Math.min(BEAT_LIMITS.songTicks, Math.round((event.clientX - surface.current.getBoundingClientRect().left) / zoom * 3840 / snap) * snap)); }
  function add(tick) {
    edit(d => ops.addAutomationPoint(d, track.id, lane, tick, at(tick)), { label: 'Add automation point', message: `${name} point added at ${formatPosition(tick)}` });
  }
  function move(index, tick, value) {
    const bounded = Math.max((points[index - 1]?.[0] ?? -60) + 60, Math.min((points[index + 1]?.[0] ?? BEAT_LIMITS.songTicks + 60) - 60, tick));
    const v = Math.max(min, Math.min(1, value));
    edit(d => ops.moveAutomationPoint(d, track.id, lane, index, bounded, v), { key: `${track.id}:auto:${lane}:${index}`,
      label: 'Move automation point', message: `${name} point ${index + 1}, ${formatPosition(bounded)}, ${Math.round(v * 100)}%` });
  }
  const vertices = [[0, at(0)], ...envelope.map(([seconds, value]) => [x(seconds * bpm / 60 * 960), value]), [width, at(width / zoom * 3840)]];
  const chosen = points[selected];
  return <section aria-label={`${track.name} ${name} automation`} className="h-52 border-b border-vx-border bg-vx-panel">
    <div className="sticky left-0 flex h-16 w-fit max-w-[calc(100vw-6rem)] items-center gap-1 overflow-x-auto px-2">
      <span className="text-xs">{name}</span>
      <button className={button} disabled={points.length >= 64} onClick={() => add(Math.round(locator / snap) * snap)}>Add point</button>
      <button className={button} onClick={() => edit(d => ops.clearAutomation(d, track.id, lane), { label: 'Clear automation', message: `${name} lane cleared` })}>Clear lane</button>
      <button className={button} onClick={close}>Hide lane</button>
      {chosen && <label className="text-xs">Curve<select className={input} value={chosen[2]} onChange={e => edit(d => ops.setAutomationCurve(d, track.id, lane, selected, Number(e.target.value)), { label: 'Change curve' })}>
        <option value={0}>Linear</option><option value={-0.6}>Ease in</option><option value={0.6}>Ease out</option>
        {![0, -0.6, 0.6].includes(chosen[2]) && <option value={chosen[2]}>Custom ({chosen[2]})</option>}
      </select></label>}
    </div>
    <div ref={surface} className="relative h-32 touch-none" onClick={e => { if (e.target === e.currentTarget) add(tickAt(e)); }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 -20 ${width} 140`} preserveAspectRatio="none">
        <polyline points={vertices.map(([left, value]) => `${left},${y(value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" className="text-vx-accent" />
      </svg>
      {points.map(([tick, value], index) => <button key={index} aria-label={`${name} point ${index + 1}, bar ${Math.floor(tick / 3840) + 1} beat ${Math.floor(tick % 3840 / 960) + 1}, ${Math.round(value * 100)}%`}
        aria-pressed={selected === index} className="absolute flex size-11 -translate-y-1/2 touch-none items-center justify-center rounded focus-visible:outline-vx-accent"
        style={{ left: Math.max(0, Math.min(width - 44, x(tick) - 22)), top: `${(y(value) + 20) / 140 * 100}%` }}
        onClick={e => { e.stopPropagation(); setSelected(index); }} onFocus={() => setSelected(index)}
        onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { index, x: e.clientX, y: e.clientY }; setSelected(index); }}
        onPointerMove={e => {
          if (drag.current?.index !== index || Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) < 3) return;
          const bounds = surface.current.getBoundingClientRect();
          move(index, tickAt(e), min + (1 - ((e.clientY - bounds.top) / bounds.height * 140 - 20) / 100) * (1 - min));
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          if (['Delete', 'Backspace'].includes(e.key)) { edit(d => ops.removeAutomationPoint(d, track.id, lane, index), { label: 'Remove automation point', message: `${name} point removed` }); setSelected(null); }
          else move(index, tick + (e.key === 'ArrowLeft' ? -snap : e.key === 'ArrowRight' ? snap : 0), value + (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0) * (e.shiftKey ? 0.1 : 0.01));
        }}><span aria-hidden="true" className="size-3 rounded-full border border-vx-fg bg-vx-accent" /></button>)}
    </div>
  </section>;
}
