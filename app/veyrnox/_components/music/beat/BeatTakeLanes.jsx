'use client';
import BeatTakeWaveform from './BeatTakeWaveform';
import { useRef, useState } from 'react';
import { setComp, useWholeTake as chooseWholeTake, deleteLane, setCrossfade, flattenGroup } from '../../../_lib/music/beat/beatTakeOps.mjs';
import { button, input } from './beatStyles';
export default function BeatTakeLanes({ group, track, doc, edit, snap, zoom, close }) {
  const [cursor, setCursor] = useState(null), drag = useRef(null);
  const step = Math.max(240, snap), end = group.start + group.length;
  const bound = tick => Math.max(group.start, Math.min(end - 240, Math.floor(tick / step) * step));
  function assign(lane, a, b) {
    const from = Math.min(a, b), to = Math.min(end, Math.max(a, b) + step);
    edit(d => setComp(d, track.id, group.id, from, to, lane), { label: 'comp takes', message: `Bars ${Math.floor(from / 3840) + 1} to ${Math.ceil(to / 3840)} now use take ${lane + 1}` });
  }
  function key(e, lane) {
    if (!['ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const selected = cursor?.lane === lane ? cursor : { lane, anchor: group.start, head: group.start };
    if (e.key === 'Escape') { setCursor(null); return; }
    if (e.key === 'Enter') { assign(lane, selected.anchor, selected.head); return; }
    const head = Math.max(group.start, Math.min(end - 240, selected.head + (e.key === 'ArrowRight' ? step : -step)));
    setCursor({ lane, anchor: e.shiftKey ? selected.anchor : head, head });
  }
  function tick(e) { return bound(group.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 3840); }
  return <section aria-label={`Take lanes for ${track.name}`} className="border-b border-vx-border bg-vx-panel" style={{ height: 112 + group.lanes.length * 112 }}>
    <div className="sticky left-0 flex h-28 w-fit max-w-full flex-wrap items-center gap-2 p-2">
      <label>Crossfade <select aria-label="Take crossfade" className={input} value={group.xfadeMs} onChange={e => edit(d => setCrossfade(d, track.id, group.id, Number(e.target.value)), { label: 'change take crossfade' })}>{[0, 5, 10, 20, 50].map(ms => <option key={ms} value={ms}>{ms} ms</option>)}</select></label>
      <button className={button} onClick={() => edit(d => flattenGroup(d, track.id, group.id), { label: 'merge takes', message: 'Take lanes merged into regions' })}>Merge takes</button><button className={button} onClick={close}>Close takes</button>
    </div>
    {group.lanes.map((id, lane) => <div key={id} className="h-28 space-y-1">
      <div className="sticky left-0 flex w-fit max-w-full flex-wrap items-center gap-2"><span>Take {lane + 1}</span><button className={button} onClick={() => edit(d => chooseWholeTake(d, track.id, group.id, lane), { label: 'use whole take', message: `Using take ${lane + 1}` })}>Use whole take {lane + 1}</button><button className={button} disabled={group.lanes.length === 1} onClick={() => edit(d => deleteLane(d, track.id, group.id, lane), { label: 'delete take' })}>Delete take {lane + 1}</button></div>
      <div tabIndex={0} role="application" aria-label={`Take ${lane + 1}, ${doc.assets[id].name}. Arrows move, Shift extends, Enter assigns, Escape clears.`}
        className="relative h-11 touch-none overflow-hidden rounded-xl border border-vx-border bg-vx-base focus-visible:outline-2 focus-visible:outline-vx-accent"
        style={{ marginLeft: group.start / 3840 * zoom, width: group.length / 3840 * zoom }}
        onKeyDown={e => key(e, lane)} onFocus={() => setCursor({ lane, anchor: group.start, head: group.start })}
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { lane, anchor: tick(e) }; setCursor({ ...drag.current, head: tick(e) }); }}
        onPointerMove={e => { if (drag.current?.lane === lane) setCursor({ ...drag.current, head: tick(e) }); }}
        onPointerCancel={() => { drag.current = null; }} onPointerUp={e => { if (drag.current?.lane === lane) { assign(lane, drag.current.anchor, tick(e)); drag.current = null; } }}>
        <BeatTakeWaveform asset={doc.assets[id]} bpm={doc.tempo.bpm} length={group.length} />
        {group.comp.map(([at, n], i) => n === lane && <span key={at} aria-hidden="true" className="pointer-events-none absolute inset-y-0 bg-vx-accent/30" style={{ left: `${(at - group.start) / group.length * 100}%`, width: `${((group.comp[i + 1]?.[0] ?? end) - at) / group.length * 100}%` }} />)}
        {cursor?.lane === lane && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-2 border-vx-accent" style={{ left: `${(Math.min(cursor.anchor, cursor.head) - group.start) / group.length * 100}%`, width: `${Math.min(end - Math.min(cursor.anchor, cursor.head), Math.abs(cursor.head - cursor.anchor) + step) / group.length * 100}%` }} />}
      </div>
    </div>)}
  </section>;
}
