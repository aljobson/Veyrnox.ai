'use client';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useId, useRef, useState } from 'react';
import { noteLabel } from '../../../../../lib/musicInstruments.js';
import { formatPosition, formatNoteLength } from '../../../_lib/music/beat/beatTime.mjs';
import { noteKey, quantisedSelection } from '../../../_lib/music/beat/beatMidiRules.mjs';
import * as midi from '../../../_lib/music/beat/beatMidiOps.mjs';
import BeatPianoToolbar from './BeatPianoToolbar';
import { button, input } from './beatStyles';
const ROW = 44, SCALE = 0.15;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
// role=application is scoped to the grid: the live cursor description and note
// buttons expose all commands without letting musical typing consume grid keys.
export default function BeatPianoRoll({ doc, region, edit, snap, setSnap, close, playback }) {
  const { t, locale } = useI18n();
  const clip = doc.clips[region.clipId], scroller = useRef(null), drag = useRef(null);
  const [selection, setSelection] = useState([]), [cursor, setCursor] = useState({ tick: 0, pitch: 60 });
  const [strength, setStrength] = useState(1), [box, setBox] = useState(null);
  const description = useId(), unit = snap || 30, width = Math.max(600, clip.lengthTicks * SCALE);
  const high = Math.min(108, Math.max(84, ...clip.notes.map((n) => n[2]))), low = Math.max(21, Math.min(36, ...clip.notes.map((n) => n[2])));
  const initialNotes = useRef(clip.notes);
  useEffect(() => {
    const notes = initialNotes.current;
    const center = notes.length ? notes.reduce((n, note) => n + note[2], 0) / notes.length : 60;
    scroller.current.scrollTop = Math.max(0, (Math.max(84, ...notes.map((n) => n[2])) - center) * ROW - 150);
  }, []);
  useEffect(() => {
    const element = scroller.current, y = (high - cursor.pitch) * ROW, x = 56 + cursor.tick * SCALE;
    if (y < element.scrollTop) element.scrollTop = y;
    else if (y + ROW > element.scrollTop + element.clientHeight) element.scrollTop = y + ROW - element.clientHeight;
    if (x < element.scrollLeft + 56) element.scrollLeft = x - 56;
    else if (x + 44 > element.scrollLeft + element.clientWidth) element.scrollLeft = x + 44 - element.clientWidth;
  }, [cursor, high]);
  const run = (op, label) => edit(op, { label });
  const selected = selection.filter((key) => clip.notes.some((n) => noteKey(n) === key));
  function quantise() {
    const nextSelection = quantisedSelection(clip, selected, snap, strength);
    if (run((d) => midi.quantiseNotes(d, region.clipId, selected, snap, strength), BEAT_ACTIONS.a46)) setSelection(nextSelection);
  }
  function move(ticks, pitch) { run((d) => midi.moveNotes(d, region.clipId, selected, ticks, pitch), BEAT_ACTIONS.a47); setSelection(selected.map((key) => { const n = clip.notes.find((n) => noteKey(n) === key); return `${clamp(n[0] + ticks, 0, clip.lengthTicks - n[1])}:${clamp(n[2] + pitch, 21, 108)}`; })); }
  function resize(delta) { run((d) => midi.resizeNotes(d, region.clipId, selected, delta), BEAT_ACTIONS.a48); }
  function velocity(delta) { run((d) => midi.velocityNotes(d, region.clipId, selected, delta), BEAT_ACTIONS.a25); }
  function remove() { run((d) => midi.deleteNotes(d, region.clipId, selected), BEAT_ACTIONS.a49); setSelection([]); }
  function key(event, note) {
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === 'a') { event.stopPropagation(); event.preventDefault(); setSelection(clip.notes.map(noteKey)); }
      return;
    }
    const horizontal = event.key === 'ArrowLeft' ? -unit : event.key === 'ArrowRight' ? unit : 0;
    const vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (horizontal || vertical) {
      event.stopPropagation();
      event.preventDefault();
      if (note) {
        const keys = selected.includes(noteKey(note)) ? selected : [noteKey(note)];
        const delta = vertical * (event.altKey ? 12 : 1);
        if (event.shiftKey && horizontal) run((d) => midi.resizeNotes(d, region.clipId, keys, horizontal), BEAT_ACTIONS.a48);
        else {
          run((d) => midi.moveNotes(d, region.clipId, keys, horizontal, delta), BEAT_ACTIONS.a47);
          const nextKeys = keys.map((k) => { const n = clip.notes.find((v) => noteKey(v) === k); return `${clamp(n[0] + horizontal, 0, clip.lengthTicks - n[1])}:${clamp(n[2] + delta, 21, 108)}`; });
          setSelection(nextKeys);
          requestAnimationFrame(() => scroller.current?.querySelector(`[data-note="${nextKeys[keys.indexOf(noteKey(note))]}"]`)?.focus());
        }
      } else setCursor((c) => ({ tick: clamp(c.tick + horizontal, 0, clip.lengthTicks - 30), pitch: clamp(c.pitch + vertical, low, high) }));
    } else if (note && ['Enter', ' '].includes(event.key)) {
      event.stopPropagation(); event.preventDefault();
      const id = noteKey(note);
      setSelection((keys) => keys.includes(id) ? keys.filter((key) => key !== id) : [...keys, id]);
    } else if (event.key === 'Enter' && !note) {
      event.stopPropagation();
      event.preventDefault(); const existing = clip.notes.find((n) => n[0] === cursor.tick && n[2] === cursor.pitch);
      run((d) => existing ? midi.deleteNotes(d, region.clipId, [noteKey(existing)]) : midi.addNote(d, region.clipId, [cursor.tick, Math.min(unit, clip.lengthTicks - cursor.tick), cursor.pitch, 100]), BEAT_ACTIONS.a50);
    } else if (['Delete', 'Backspace', '+', '-', '='].includes(event.key)) {
      event.stopPropagation();
      event.preventDefault(); const keys = note && !selected.includes(noteKey(note)) ? [noteKey(note)] : selected;
      run((d) => ['Delete', 'Backspace'].includes(event.key) ? midi.deleteNotes(d, region.clipId, keys) : midi.velocityNotes(d, region.clipId, keys, event.key === '-' ? -16 : 16), BEAT_ACTIONS.a51);
      if (['Delete', 'Backspace'].includes(event.key)) requestAnimationFrame(() => scroller.current?.querySelector('[role="application"]')?.focus());
    }
  }
  function point(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { tick: clamp(Math.round((e.clientX - rect.left) / SCALE / (snap || 1)) * (snap || 1), 0, clip.lengthTicks - 30), pitch: clamp(high - Math.floor((e.clientY - rect.top) / ROW), low, high) };
  }
  function down(e, note, lane = false) {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const keys = note ? e.shiftKey ? [...new Set([...selected, noteKey(note)])] : selected.includes(noteKey(note)) ? selected : [noteKey(note)] : [];
    if (note) setSelection(keys);
    drag.current = { x: e.clientX, y: e.clientY, note, keys, lane, resize: note && !lane && e.clientX > e.currentTarget.getBoundingClientRect().right - 14, point: !note ? point(e) : null };
  }
  function up(e) {
    const start = drag.current; drag.current = null; setBox(null);
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (start.note) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      const anchor = start.resize ? start.note[1] : start.note[0];
      const ticks = Math.round((anchor + dx / SCALE) / (snap || 1)) * (snap || 1) - anchor;
      if (start.lane) run((d) => midi.velocityNotes(d, region.clipId, start.keys, Math.round(-dy * 127 / 100)), BEAT_ACTIONS.a25);
      else if (start.resize) run((d) => midi.resizeNotes(d, region.clipId, start.keys, ticks), BEAT_ACTIONS.a48);
      else {
        const pitch = -Math.round(dy / ROW);
        run((d) => midi.moveNotes(d, region.clipId, start.keys, ticks, pitch), BEAT_ACTIONS.a47);
        setSelection(start.keys.map((k) => { const n = clip.notes.find((v) => noteKey(v) === k); return `${clamp(n[0] + ticks, 0, clip.lengthTicks - n[1])}:${clamp(n[2] + pitch, 21, 108)}`; }));
      }
    } else {
      const end = point(e), at = start.point;
      if (Math.abs(dx) + Math.abs(dy) < 4) run((d) => midi.addNote(d, region.clipId, [at.tick, Math.min(unit, clip.lengthTicks - at.tick), at.pitch, 100]), BEAT_ACTIONS.a52);
      else setSelection(clip.notes.filter((n) => n[0] <= Math.max(at.tick, end.tick) && n[0] + n[1] >= Math.min(at.tick, end.tick) && n[2] >= Math.min(at.pitch, end.pitch) && n[2] <= Math.max(at.pitch, end.pitch)).map(noteKey));
    }
  }
  return <section aria-label={t('app.music.beat.shortcut.context.piano')} className="min-w-0 overflow-hidden rounded-xl border border-vx-border bg-vx-panel max-md:fixed max-md:inset-0 max-md:z-40 max-md:flex max-md:h-dvh max-md:flex-col">
    <BeatPianoToolbar {...{ doc, region, clip, edit, snap, setSnap, quantise, strength, setStrength, close, playback }} />
    <p id={description} aria-live="polite" className="px-2 text-xs">{t('app.music.beat.ui.cursor')}{noteLabel(cursor.pitch)}, {formatPosition(cursor.tick, t)}{t('app.music.beat.ui.arrows.move.enter.toggles.a.note')}{selected.length}{t('app.music.beat.ui.selected')}</p>
    <div className="flex flex-wrap gap-2 p-2">
      <button className={button} onClick={() => setSelection(clip.notes.map(noteKey))}>{t('app.music.beat.shortcut.pianoSelectAll')}</button>
      <label>{t('app.music.beat.control.cursorTick')}<input className={`${input} w-24`} type="number" min={0} max={clip.lengthTicks - 30} step={unit} value={cursor.tick} onChange={e => setCursor(c => ({ ...c, tick: clamp(Number(e.target.value), 0, clip.lengthTicks - 30) }))} /></label>
      <label>{t('app.music.beat.control.cursorPitch')}<input className={`${input} w-24`} type="number" min={low} max={high} value={cursor.pitch} onChange={e => setCursor(c => ({ ...c, pitch: clamp(Number(e.target.value), low, high) }))} /></label>
      <button className={button} onClick={() => key({ key: 'Enter', preventDefault() {}, stopPropagation() {} })}>{t('app.music.beat.control.cursorToggle')}</button>
      {!!selected.length && [-12, 12].map(delta => <button key={delta} className={button} onClick={() => move(0, delta)}>{t(delta < 0 ? 'app.music.beat.control.octaveDown' : 'app.music.beat.control.octaveUp')}</button>)}
    </div>
    <div dir="ltr" ref={scroller} className="max-h-[60vh] min-h-0 overflow-auto max-md:max-h-none max-md:flex-1">
      <div className="flex" style={{ width: width + 56 }}>
        <div className="sticky left-0 z-20 w-14 shrink-0 bg-vx-panel" aria-hidden="true">{Array.from({ length: high - low + 1 }, (_, i) => high - i).map((pitch) => <div key={pitch} className={`flex h-11 items-center border-b border-vx-border text-xs ${pitch % 12 === 0 ? 'font-bold text-vx-accent' : ''}`}>{noteLabel(pitch)}</div>)}</div>
        <div role="application" aria-label={t('app.music.beat.ui.piano.roll.note.grid')} aria-describedby={description} tabIndex={0} onKeyDown={(e) => key(e)}
          className="relative touch-none outline-offset-2 focus-visible:outline-vx-accent" style={{ width, height: (high - low + 1) * ROW,
            backgroundImage: 'linear-gradient(to right, rgb(var(--vx-border-boost)) 2px, transparent 2px), linear-gradient(to right, rgb(var(--vx-border)) 1px, transparent 1px), linear-gradient(to right, rgb(var(--vx-border)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--vx-border)) 1px, transparent 1px)', backgroundSize: `${3840 * SCALE}px 100%, ${960 * SCALE}px 100%, ${unit * SCALE}px 100%, 100% ${ROW}px` }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) { e.currentTarget.focus(); down(e); } }} onPointerUp={up} onPointerCancel={() => { drag.current = null; setBox(null); }}
          onPointerMove={(e) => { if (drag.current && !drag.current.note) setBox({ start: drag.current.point, end: point(e) }); }}>
          <span aria-hidden="true" className="pointer-events-none absolute h-11 border-2 border-vx-accent" style={{ left: cursor.tick * SCALE, top: (high - cursor.pitch) * ROW, width: unit * SCALE }} />
          {box && <span aria-hidden="true" className="pointer-events-none absolute border border-vx-accent bg-vx-accent/10" style={{ left: Math.min(box.start.tick, box.end.tick) * SCALE, width: Math.max(2, Math.abs(box.end.tick - box.start.tick) * SCALE), top: (high - Math.max(box.start.pitch, box.end.pitch)) * ROW, height: (Math.abs(box.start.pitch - box.end.pitch) + 1) * ROW }} />}
          {clip.notes.map((n) => <button key={noteKey(n)} data-note={noteKey(n)} aria-label={t('app.music.beat.labels.l27', { p0: noteLabel(n[2]), p1: formatPosition(n[0], t), p2: formatNoteLength(n[1], t, locale), p3: n[3] })} aria-pressed={selected.includes(noteKey(n))}
            className={`absolute h-11 min-w-11 touch-none text-start text-xs focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent ${selected.includes(noteKey(n)) ? 'ring-2 ring-vx-accent' : ''}`}
            style={{ left: n[0] * SCALE, top: (high - n[2]) * ROW, width: Math.max(4, n[1] * SCALE) }} onPointerDown={(e) => down(e, n)} onPointerUp={up} onKeyDown={(e) => key(e, n)} onFocus={() => setCursor({ tick: n[0], pitch: n[2] })}><span className="absolute inset-y-0 left-0 overflow-hidden rounded border border-vx-hue-rose bg-vx-hue-rose/40" style={{ width: Math.max(4, n[1] * SCALE) }}>{noteLabel(n[2])}<span aria-hidden="true" className="absolute inset-y-0 right-0 w-3 cursor-ew-resize border-l border-vx-border" /></span></button>)}
        </div>
      </div>
      <div aria-label={t('app.music.beat.ui.velocity.lane')} data-beat-velocity className="relative ms-14 h-28 border-t border-vx-border" style={{ width }} onKeyDown={(e) => e.stopPropagation()}>{clip.notes.map((n) => <button key={noteKey(n)} aria-label={t('app.music.beat.labels.l28', { p0: noteLabel(n[2]), p1: formatPosition(n[0], t), p2: n[3] })} aria-pressed={selected.includes(noteKey(n))} className="absolute bottom-0 h-full touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" style={{ left: n[0] * SCALE, width: Math.max(8, n[1] * SCALE - 2) }} onPointerDown={(e) => down(e, n, true)} onPointerUp={up} onKeyDown={(e) => { if (['+', '-', '=', 'Enter', ' '].includes(e.key)) key(e, n); }}><span aria-hidden="true" className="absolute inset-x-0 bottom-0 border border-vx-hue-rose bg-vx-hue-rose/40" style={{ height: `${n[3] / 127 * 100}%` }} /></button>)}</div>
    </div>
    {!!selected.length && <div className="flex flex-wrap gap-1 p-2 md:hidden" aria-label={t('app.music.beat.ui.selected.note.actions')}>{[['◀', () => move(-unit, 0)], ['▶', () => move(unit, 0)], ['▲', () => move(0, 1)], ['▼', () => move(0, -1)], [t('app.music.beat.enum.e36'), () => resize(-unit)], [t('app.music.beat.enum.e37'), () => resize(unit)], [t('app.music.beat.enum.e38'), () => velocity(-16)], [t('app.music.beat.enum.e39'), () => velocity(16)], [t('app.music.beat.enum.e40'), remove]].map(([label, action]) => <button key={label} aria-label={label === '◀' ? `${t('app.music.beat.control.position')} −` : label === '▶' ? `${t('app.music.beat.control.position')} +` : label === '▲' ? `${t('app.music.beat.control.cursorPitch')} +` : label === '▼' ? `${t('app.music.beat.control.cursorPitch')} −` : label} className={button} onClick={action}>{beatLabel(label, t)}</button>)}</div>}
  </section>;
}
