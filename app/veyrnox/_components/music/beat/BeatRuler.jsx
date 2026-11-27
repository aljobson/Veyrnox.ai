'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_KEYS } from '../../../_lib/music/beat/beatShortcuts.mjs';
import { button } from './beatStyles';
import { useEffect, useRef, useState } from 'react';
import { clampLocator, moveLocator, snapTick, formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import { setCycle } from '../../../_lib/music/beat/beatOps.mjs';

const cycleFields = ['start', 'end'];
const positionPaths = {
  start: 'M5 5v14 M19 6l-9 6 9 6z',
  previousBar: 'M7 6v12 M18 6l-8 6 8 6z',
  nextBar: 'M17 6v12 M6 6l8 6-8 6z',
  end: 'M19 5v14 M5 6l9 6-9 6z',
};
function PositionIcon({ name }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={positionPaths[name]} /></svg>;
}
export default function BeatRuler({ onHeight, bars, zoom, snap, locator, end, setLocator, cycle, edit, announce }) {
  const { t } = useI18n();
  const root = useRef(null);
  useEffect(() => {
    if (!onHeight || !root.current) return;
    const measure = () => onHeight('ruler', root.current.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure); observer.observe(root.current); measure();
    return () => observer.disconnect();
  }, [onHeight]);
  const drag = useRef(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const cancel = (event) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); drag.current = null; setPreview(null); announce(t('app.music.beat.status.s48'));
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [announce, t]);
  const band = preview || cycle;
  const bandWidth = (band.end - band.start) / 3840 * zoom;
  function tick(event) { return snapTick((event.clientX - root.current.getBoundingClientRect().left) / zoom * 3840, snap); }
  const positionControls = [['start', 0], ['previousBar', Math.max(0, locator - 3840)], ['nextBar', Math.min(end, locator + 3840)], ['end', end]];
  return <div ref={root} dir="ltr" className="relative min-h-28 border-b border-vx-border bg-vx-panel">
    <div className="sticky start-0 flex min-h-10 w-fit max-w-[calc(100vw-6rem)] gap-1 p-1">
      {positionControls.map(([label, at]) => <button data-beat-read key={label} className={`${button} grid min-h-9 min-w-9 place-items-center rounded-lg px-0 py-1`} aria-label={t(`app.music.beat.control.${label}`)} title={t(`app.music.beat.control.${label}`)} onClick={() => setLocator(at)}><PositionIcon name={label} /></button>)}
      {preview && <button className={button} onClick={() => { drag.current = null; setPreview(null); announce(t('app.music.beat.status.s48')); }}>{t('app.music.beat.control.cancelDrag')}</button>}
    </div>
    <div data-beat-read data-beat-ruler-position role="slider" tabIndex={0} aria-label={t('app.music.beat.ui.playhead.position')} aria-valuemin={0}
      aria-valuemax={end / 240} aria-valuenow={locator / 240}
      aria-valuetext={formatPosition(locator, t)}
      className="relative h-11 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent"
      onClick={(event) => setLocator(clampLocator(tick(event), end))}
      onKeyDown={(event) => {
        if (!BEAT_KEYS.ruler.includes(event.key)) return;
        event.preventDefault(); setLocator(moveLocator(locator, event.key, snap, end));
      }}>
      {Array.from({ length: bars }, (_, i) => <span key={i} aria-hidden="true"
        className="absolute border-l border-vx-border ps-1 text-xs" style={{ left: i * zoom }}>{i + 1}</span>)}
      <span aria-hidden="true" className="absolute top-4 h-6 w-0.5 bg-vx-accent" style={{ left: locator / 3840 * zoom }} />
    </div>
    <div className={`relative h-11 rounded border border-vx-accent ${cycle.on ? 'bg-vx-accent/25' : 'bg-vx-panel'}`}
      style={{ left: band.start / 3840 * zoom, width: bandWidth }}>
      <span className="pointer-events-none block truncate px-3 text-xs">{t('app.music.beat.ui.cycle')}</span>
      {cycleFields.map((edge) => <span key={edge} aria-hidden="true"
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
          edit((d) => setCycle(d, value), { label: BEAT_ACTIONS.a24 });
        }} onPointerCancel={() => { drag.current = null; setPreview(null); }} />)}
    </div>
  </div>;
}
