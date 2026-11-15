'use client';
import { useEffect, useRef, useState } from 'react';
import { clampLocator, moveLocator, snapTick, formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import { setCycle } from '../../../_lib/music/beat/beatOps.mjs';

export default function BeatRuler({ bars, zoom, snap, locator, end, setLocator, cycle, edit, announce }) {
  const root = useRef(null);
  const drag = useRef(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const cancel = (event) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); drag.current = null; setPreview(null); announce('Cycle drag cancelled');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [announce]);
  const band = preview || cycle;
  const bandWidth = (band.end - band.start) / 3840 * zoom;
  function tick(event) { return snapTick((event.clientX - root.current.getBoundingClientRect().left) / zoom * 3840, snap); }
  return <div ref={root} className="relative h-24 border-b border-vx-border bg-vx-panel">
    <div role="slider" tabIndex={0} aria-label="Playhead position" aria-valuemin={0}
      aria-valuemax={end / 240} aria-valuenow={locator / 240}
      aria-valuetext={formatPosition(locator)}
      className="absolute inset-x-0 bottom-0 h-11 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent"
      onClick={(event) => setLocator(clampLocator(tick(event), end))}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); setLocator(moveLocator(locator, event.key, snap, end));
      }}>
      {Array.from({ length: bars }, (_, i) => <span key={i} aria-hidden="true"
        className="absolute border-l border-vx-border pl-1 text-xs" style={{ left: i * zoom }}>{i + 1}</span>)}
      <span aria-hidden="true" className="absolute top-4 h-6 w-0.5 bg-vx-accent" style={{ left: locator / 3840 * zoom }} />
    </div>
    <div className={`absolute top-0 h-11 rounded border border-vx-accent ${cycle.on ? 'bg-vx-accent/25' : 'bg-vx-panel'}`}
      style={{ left: band.start / 3840 * zoom, width: bandWidth }}>
      <span className="pointer-events-none block truncate px-3 text-xs">Cycle</span>
      {['start', 'end'].map((edge) => <span key={edge} aria-hidden="true"
        className={`absolute top-0 h-11 w-3 touch-none cursor-ew-resize bg-vx-accent/40 ${edge === 'start' ? '-left-1.5' : '-right-1.5'} ${edge === 'start' && bandWidth < 24 ? 'z-20' : 'z-10'}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { edge, cycle, value: cycle };
        }} onPointerMove={(event) => {
          if (!drag.current) return;
          const original = drag.current.cycle;
          const at = Math.max(0, Math.min(512 * 3840, tick(event)));
          const value = { ...original, [edge]: edge === 'start' ? Math.min(at, original.end - 240) : Math.max(at, original.start + 240) };
          drag.current.value = value; setPreview(value);
        }} onPointerUp={() => {
          if (!drag.current) return;
          const value = drag.current.value;
          drag.current = null; setPreview(null);
          edit((d) => setCycle(d, value), { label: 'change cycle' });
        }} onPointerCancel={() => { drag.current = null; setPreview(null); }} />)}
    </div>
  </div>;
}
