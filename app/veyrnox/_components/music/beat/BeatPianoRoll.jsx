'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { noteLabel } from '../../../../../lib/musicInstruments.js';
import { formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import { noteKey } from '../../../_lib/music/beat/beatMidiRules.mjs';
import * as midi from '../../../_lib/music/beat/beatMidiOps.mjs';
import BeatPianoToolbar from './BeatPianoToolbar';
import { button } from './beatStyles';
const ROW = 44, SCALE = 0.15;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
// role=application is scoped to the grid: the live cursor description and note
// buttons expose all commands without letting musical typing consume grid keys.
export default function BeatPianoRoll({ doc, region, edit, snap, setSnap, close, playback }) {
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
  function move(ticks, pitch) { run((d) => midi.moveNotes(d, region.clipId, selected, ticks, pitch), 'move notes'); setSelection(selected.map((key) => { const n = clip.notes.find((n) => noteKey(n) === key); return `${clamp(n[0] + ticks, 0, clip.lengthTicks - n[1])}:${clamp(n[2] + pitch, 21, 108)}`; })); }
  function resize(delta) { run((d) => midi.resizeNotes(d, region.clipId, selected, delta), 'resize notes'); }
  function velocity(delta) { run((d) => midi.velocityNotes(d, region.clipId, selected, delta), 'change velocity'); }
  function remove() { run((d) => midi.deleteNotes(d, region.clipId, selected), 'delete notes'); setSelection([]); }
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
        if (event.shiftKey && horizontal) run((d) => midi.resizeNotes(d, region.clipId, keys, horizontal), 'resize notes');
        else {
          run((d) => midi.moveNotes(d, region.clipId, keys, horizontal, delta), 'move notes');
          const nextKeys = keys.map((k) => { const n = clip.notes.find((v) => noteKey(v) === k); return `${clamp(n[0] + horizontal, 0, clip.lengthTicks - n[1])}:${clamp(n[2] + delta, 21, 108)}`; });
          setSelection(nextKeys);
          requestAnimationFrame(() => scroller.current?.querySelector(`[data-note="${nextKeys[keys.indexOf(noteKey(note))]}"]`)?.focus());
        }
      } else setCursor((c) => ({ tick: clamp(c.tick + horizontal, 0, clip.lengthTicks - 30), pitch: clamp(c.pitch + vertical, low, high) }));
    } else if (event.key === 'Enter' && !note) {
      event.stopPropagation();
      event.preventDefault(); const existing = clip.notes.find((n) => n[0] === cursor.tick && n[2] === cursor.pitch);
      run((d) => existing ? midi.deleteNotes(d, region.clipId, [noteKey(existing)]) : midi.addNote(d, region.clipId, [cursor.tick, Math.min(unit, clip.lengthTicks - cursor.tick), cursor.pitch, 100]), 'toggle note');
    } else if (['Delete', 'Backspace', '+', '-', '='].includes(event.key)) {
      event.stopPropagation();
      event.preventDefault(); const keys = note && !selected.includes(noteKey(note)) ? [noteKey(note)] : selected;
      run((d) => ['Delete', 'Backspace'].includes(event.key) ? midi.deleteNotes(d, region.clipId, keys) : midi.velocityNotes(d, region.clipId, keys, event.key === '-' ? -16 : 16), 'edit notes');
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
      if (start.lane) run((d) => midi.velocityNotes(d, region.clipId, start.keys, Math.round(-dy * 127 / 100)), 'change velocity');
      else if (start.resize) run((d) => midi.resizeNotes(d, region.clipId, start.keys, ticks), 'resize notes');
      else {
        const pitch = -Math.round(dy / ROW);
        run((d) => midi.moveNotes(d, region.clipId, start.keys, ticks, pitch), 'move notes');
        setSelection(start.keys.map((k) => { const n = clip.notes.find((v) => noteKey(v) === k); return `${clamp(n[0] + ticks, 0, clip.lengthTicks - n[1])}:${clamp(n[2] + pitch, 21, 108)}`; }));
      }
    } else {
      const end = point(e), at = start.point;
      if (Math.abs(dx) + Math.abs(dy) < 4) run((d) => midi.addNote(d, region.clipId, [at.tick, Math.min(unit, clip.lengthTicks - at.tick), at.pitch, 100]), 'add note');
      else setSelection(clip.notes.filter((n) => n[0] <= Math.max(at.tick, end.tick) && n[0] + n[1] >= Math.min(at.tick, end.tick) && n[2] >= Math.min(at.pitch, end.pitch) && n[2] <= Math.max(at.pitch, end.pitch)).map(noteKey));
    }
  }
  return <section aria-label="Piano roll" className="min-w-0 overflow-hidden rounded-xl border border-vx-border bg-vx-panel max-md:fixed max-md:inset-0 max-md:z-40 max-md:flex max-md:h-dvh max-md:flex-col">
    <BeatPianoToolbar {...{ doc, region, clip, edit, snap, setSnap, selection: selected, strength, setStrength, close, playback }} />
    <p id={description} aria-live="polite" className="px-2 text-xs">Cursor {noteLabel(cursor.pitch)}, {formatPosition(cursor.tick)}. Arrows move; Enter toggles a note. {selected.length} selected.</p>
    <div ref={scroller} className="max-h-[60vh] min-h-0 overflow-auto max-md:max-h-none max-md:flex-1">
      <div className="flex" style={{ width: width + 56 }}>
        <div className="sticky left-0 z-20 w-14 shrink-0 bg-vx-panel" aria-hidden="true">{Array.from({ length: high - low + 1 }, (_, i) => high - i).map((pitch) => <div key={pitch} className={`flex h-11 items-center border-b border-vx-border text-xs ${pitch % 12 === 0 ? 'font-bold text-vx-accent' : ''}`}>{noteLabel(pitch)}</div>)}</div>
        <div role="application" aria-label="Piano roll note grid" aria-describedby={description} tabIndex={0} onKeyDown={(e) => key(e)}
          className="relative touch-none outline-offset-2 focus-visible:outline-vx-accent" style={{ width, height: (high - low + 1) * ROW,
            backgroundImage: 'linear-gradient(to right, rgb(var(--vx-border-boost)) 2px, transparent 2px), linear-gradient(to right, rgb(var(--vx-border)) 1px, transparent 1px), linear-gradient(to right, rgb(var(--vx-border)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--vx-border)) 1px, transparent 1px)', backgroundSize: `${3840 * SCALE}px 100%, ${960 * SCALE}px 100%, ${unit * SCALE}px 100%, 100% ${ROW}px` }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) { e.currentTarget.focus(); down(e); } }} onPointerUp={up} onPointerCancel={() => { drag.current = null; setBox(null); }}
          onPointerMove={(e) => { if (drag.current && !drag.current.note) setBox({ start: drag.current.point, end: point(e) }); }}>
          <span aria-hidden="true" className="pointer-events-none absolute h-11 border-2 border-vx-accent" style={{ left: cursor.tick * SCALE, top: (high - cursor.pitch) * ROW, width: unit * SCALE }} />
          {box && <span aria-hidden="true" className="pointer-events-none absolute border border-vx-accent bg-vx-accent/10" style={{ left: Math.min(box.start.tick, box.end.tick) * SCALE, width: Math.max(2, Math.abs(box.end.tick - box.start.tick) * SCALE), top: (high - Math.max(box.start.pitch, box.end.pitch)) * ROW, height: (Math.abs(box.start.pitch - box.end.pitch) + 1) * ROW }} />}
          {clip.notes.map((n) => <button key={noteKey(n)} data-note={noteKey(n)} aria-label={`${noteLabel(n[2])}, ${formatPosition(n[0])}${n[0] % 3840 === 0 ? ', beat 1' : ''}, length ${n[1] / 960} ${n[1] === 960 ? 'beat' : 'beats'}, velocity ${n[3]}`} aria-pressed={selected.includes(noteKey(n))}
            className={`absolute h-11 min-w-11 touch-none text-left text-xs focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent ${selected.includes(noteKey(n)) ? 'ring-2 ring-vx-accent' : ''}`}
            style={{ left: n[0] * SCALE, top: (high - n[2]) * ROW, width: Math.max(4, n[1] * SCALE) }} onPointerDown={(e) => down(e, n)} onPointerUp={up} onKeyDown={(e) => key(e, n)} onFocus={() => setCursor({ tick: n[0], pitch: n[2] })}><span className="absolute inset-y-0 left-0 overflow-hidden rounded border border-vx-hue-rose bg-vx-hue-rose/40" style={{ width: Math.max(4, n[1] * SCALE) }}>{noteLabel(n[2])}<span aria-hidden="true" className="absolute inset-y-0 right-0 w-3 cursor-ew-resize border-l border-vx-border" /></span></button>)}
        </div>
      </div>
      <div aria-label="Velocity lane" className="relative ml-14 h-28 border-t border-vx-border" style={{ width }}>{clip.notes.map((n) => <button key={noteKey(n)} aria-label={`${noteLabel(n[2])} velocity ${n[3]}`} className="absolute bottom-0 min-h-11 w-11 touch-none border border-vx-hue-rose bg-vx-hue-rose/40 focus-visible:outline-vx-accent" style={{ left: n[0] * SCALE, height: Math.max(44, n[3] / 127 * 100) }} onPointerDown={(e) => down(e, n, true)} onPointerUp={up} onKeyDown={(e) => key(e, n)}>{n[3]}</button>)}</div>
    </div>
    {!!selected.length && <div className="flex flex-wrap gap-1 p-2 md:hidden" aria-label="Selected note actions">{[['◀', () => move(-unit, 0)], ['▶', () => move(unit, 0)], ['▲', () => move(0, 1)], ['▼', () => move(0, -1)], ['Shorter', () => resize(-unit)], ['Longer', () => resize(unit)], ['Velocity −', () => velocity(-16)], ['Velocity +', () => velocity(16)], ['Delete', remove]].map(([label, action]) => <button key={label} className={button} onClick={action}>{label}</button>)}</div>}
  </section>;
}
