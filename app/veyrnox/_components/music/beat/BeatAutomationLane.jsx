'use client';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { automationEnvelope, envelopeAt } from '../../../_lib/music/beat/beatAutomation.mjs';
import { BEAT_LIMITS } from '../../../_lib/music/beat/beatDocument.mjs';
import { formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import * as ops from '../../../_lib/music/beat/beatMixOps.mjs';
import { button, input } from './beatStyles';
export default function BeatAutomationLane({ onHeight, track, lane, bpm, zoom, width, snap, locator, edit, close }) {
  const { t } = useI18n();
  const panel = useRef(null);
  useEffect(() => {
    if (!onHeight || !panel.current) return;
    const measure = () => onHeight(`automation:${track.id}`, panel.current.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure); observer.observe(panel.current); measure();
    return () => observer.disconnect();
  }, [onHeight, track.id]);
  const points = track.automation?.[lane] || [], envelope = automationEnvelope(points, bpm);
  const [selected, setSelected] = useState(null), drag = useRef(null), surface = useRef(null);
  const min = lane === 'gain' ? 0 : -1, name = beatLabel(lane === 'gain' ? 'Gain' : 'Pan', t);
  const x = tick => tick / 3840 * zoom, y = value => 100 - (value - min) / (1 - min) * 100;
  const sec = tick => tick / 960 * 60 / bpm;
  const at = tick => points.length ? envelopeAt(envelope, sec(tick)) : track[lane];
  function tickAt(event) { return Math.max(0, Math.min(BEAT_LIMITS.songTicks, Math.round((event.clientX - surface.current.getBoundingClientRect().left) / zoom * 3840 / snap) * snap)); }
  function add(tick) {
    edit(d => ops.addAutomationPoint(d, track.id, lane, tick, at(tick)), { label: BEAT_ACTIONS.a9, message: t('app.music.beat.status.s5', { p0: name, p1: formatPosition(tick, t) }) });
  }
  function move(index, tick, value) {
    const bounded = Math.max((points[index - 1]?.[0] ?? -60) + 60, Math.min((points[index + 1]?.[0] ?? BEAT_LIMITS.songTicks + 60) - 60, tick));
    const v = Math.max(min, Math.min(1, value));
    edit(d => ops.moveAutomationPoint(d, track.id, lane, index, bounded, v), { key: `${track.id}:auto:${lane}:${index}`,
      label: BEAT_ACTIONS.a10, message: t('app.music.beat.status.s6', { p0: name, p1: index + 1, p2: formatPosition(bounded, t), p3: Math.round(v * 100) }) });
  }
  const vertices = [[0, at(0)], ...envelope.map(([seconds, value]) => [x(seconds * bpm / 60 * 960), value]), [width, at(width / zoom * 3840)]];
  const chosen = points[selected];
  return <section ref={panel} aria-label={t('app.music.beat.labels.l4', { p0: track.name, p1: name })} className="min-h-72 border-b border-vx-border bg-vx-panel">
    <div className="sticky start-0 flex min-h-36 w-fit flex-wrap max-w-[calc(100vw-6rem)] items-center gap-1 px-2">
      <span className="text-xs">{name}</span>
      <button className={button} disabled={points.length >= 64} onClick={() => add(Math.round(locator / snap) * snap)}>{t('app.music.beat.ui.add.point')}</button>
      <button className={button} onClick={() => edit(d => ops.clearAutomation(d, track.id, lane), { label: BEAT_ACTIONS.a11, message: t('app.music.beat.status.s7', { p0: name }) })}>{t('app.music.beat.ui.clear.lane')}</button>
      <button className={button} onClick={close}>{t('app.music.beat.ui.hide.lane')}</button>
      {chosen && <>
        <label>{t('app.music.beat.control.position')}<input className={`${input} w-24`} type="number" min={0} max={BEAT_LIMITS.songTicks} step={snap} value={chosen[0]} onChange={e => move(selected, Number(e.target.value), chosen[1])} /></label>
        <label>{t('app.music.beat.control.value')}<input className={`${input} w-24`} type="number" min={min} max={1} step={0.01} value={chosen[1]} onChange={e => move(selected, chosen[0], Number(e.target.value))} /></label>
        <button className={button} onClick={() => { edit(d => ops.removeAutomationPoint(d, track.id, lane, selected), { label: BEAT_ACTIONS.a12, message: t('app.music.beat.status.s8', { p0: name }) }); setSelected(null); }}>{t('app.music.beat.shortcut.automationDelete')}</button>
      </>}
      {chosen && <label className="text-xs">{t('app.music.beat.ui.curve')}<select className={input} value={chosen[2]} onChange={e => edit(d => ops.setAutomationCurve(d, track.id, lane, selected, Number(e.target.value)), { label: BEAT_ACTIONS.a13 })}>
        <option value={0}>{t('app.music.beat.ui.linear')}</option><option value={-0.6}>{t('app.music.beat.ui.ease.in')}</option><option value={0.6}>{t('app.music.beat.ui.ease.out')}</option>
        {![0, -0.6, 0.6].includes(chosen[2]) && <option value={chosen[2]}>{t('app.music.beat.ui.custom')}{chosen[2]})</option>}
      </select></label>}
    </div>
    <div ref={surface} className="relative h-32 touch-none" onClick={e => { if (e.target === e.currentTarget) add(tickAt(e)); }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 -20 ${width} 140`} preserveAspectRatio="none">
        <polyline points={vertices.map(([left, value]) => `${left},${y(value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" className="text-vx-accent" />
      </svg>
      {points.map(([tick, value], index) => <button key={index} aria-label={t('app.music.beat.labels.l5', { p0: name, p1: index + 1, p2: Math.floor(tick / 3840) + 1, p3: Math.floor(tick % 3840 / 960) + 1, p4: Math.round(value * 100) })}
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
          if (['Delete', 'Backspace'].includes(e.key)) { edit(d => ops.removeAutomationPoint(d, track.id, lane, index), { label: BEAT_ACTIONS.a12, message: t('app.music.beat.status.s8', { p0: name }) }); setSelected(null); }
          else move(index, tick + (e.key === 'ArrowLeft' ? -snap : e.key === 'ArrowRight' ? snap : 0), value + (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0) * (e.shiftKey ? 0.1 : 0.01));
        }}><span aria-hidden="true" className="size-3 rounded-full border border-vx-fg bg-vx-accent" /></button>)}
    </div>
  </section>;
}
