'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_KEYS } from '../../../_lib/music/beat/beatShortcuts.mjs';
import BeatTakeWaveform from './BeatTakeWaveform';
import { useEffect, useRef, useState } from 'react';
import { setComp, useWholeTake as chooseWholeTake, deleteLane, setCrossfade, flattenGroup } from '../../../_lib/music/beat/beatTakeOps.mjs';
import { button, input } from './beatStyles';
const selectionFields = ['anchor', 'head'];
export default function BeatTakeLanes({ onHeight, group, track, doc, edit, snap, zoom, close }) {
  const { t } = useI18n();
  const panel = useRef(null);
  useEffect(() => {
    if (!onHeight || !panel.current) return;
    const measure = () => onHeight(`takes:${track.id}:${group.id}`, panel.current.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure); observer.observe(panel.current); measure();
    return () => observer.disconnect();
  }, [onHeight, track.id, group.id]);
  const [cursor, setCursor] = useState(null), drag = useRef(null);
  const step = Math.max(240, snap), end = group.start + group.length;
  const bound = tick => Math.max(group.start, Math.min(end - 240, Math.floor(tick / step) * step));
  function assign(lane, a, b) {
    const from = Math.min(a, b), to = Math.min(end, Math.max(a, b) + step);
    edit(d => setComp(d, track.id, group.id, from, to, lane), { label: BEAT_ACTIONS.a26, message: t('app.music.beat.status.s51', { p0: Math.floor(from / 3840) + 1, p1: Math.ceil(to / 3840), p2: lane + 1 }) });
  }
  function key(e, lane) {
    if (!BEAT_KEYS.takes.includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const selected = cursor?.lane === lane ? cursor : { lane, anchor: group.start, head: group.start };
    if (e.key === 'Escape') { setCursor(null); return; }
    if (e.key === 'Enter') { assign(lane, selected.anchor, selected.head); return; }
    const head = Math.max(group.start, Math.min(end - 240, selected.head + (e.key === 'ArrowRight' ? step : -step)));
    setCursor({ lane, anchor: e.shiftKey ? selected.anchor : head, head });
  }
  function tick(e) { return bound(group.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 3840); }
  return <section ref={panel} aria-label={t('app.music.beat.labels.l38', { p0: track.name })} className="border-b border-vx-border bg-vx-panel" style={{ minHeight: `${14 + group.lanes.length * 14}rem` }}>
    <div className="sticky start-0 flex min-h-56 w-fit max-w-[calc(100vw-6rem)] flex-wrap items-center gap-2 p-2">
      <label>{t('app.music.beat.ui.crossfade')}<select aria-label={t('app.music.beat.ui.take.crossfade')} className={input} value={group.xfadeMs} onChange={e => edit(d => setCrossfade(d, track.id, group.id, Number(e.target.value)), { label: BEAT_ACTIONS.a27 })}>{[0, 5, 10, 20, 50].map(ms => <option key={ms} value={ms}>{ms}{t('app.music.beat.ui.ms')}</option>)}</select></label>
      <button className={button} onClick={() => edit(d => flattenGroup(d, track.id, group.id), { label: BEAT_ACTIONS.a28, message: t('app.music.beat.message.merged') })}>{t('app.music.beat.ui.merge.takes')}</button><button className={button} onClick={close}>{t('app.music.beat.ui.close.takes')}</button>
    </div>
    {group.lanes.map((id, lane) => <div key={id} className="min-h-56 space-y-1">
      <div className="sticky start-0 flex w-fit max-w-[calc(100vw-6rem)] flex-wrap items-center gap-2"><span>{t('app.music.beat.ui.take')}{lane + 1}</span><button className={button} onClick={() => edit(d => chooseWholeTake(d, track.id, group.id, lane), { label: BEAT_ACTIONS.a29, message: t('app.music.beat.status.s52', { p0: lane + 1 }) })}>{t('app.music.beat.ui.use.whole.take')}{lane + 1}</button><button className={button} disabled={group.lanes.length === 1} onClick={() => edit(d => deleteLane(d, track.id, group.id, lane), { label: BEAT_ACTIONS.a30 })}>{t('app.music.beat.ui.delete.take')}{lane + 1}</button></div>
      <div className="sticky start-0 flex w-fit max-w-[calc(100vw-6rem)] flex-wrap items-center gap-2">
        {selectionFields.map(field => <label key={field}>{t(`app.music.beat.control.${field === 'anchor' ? 'selectionStart' : 'selectionEnd'}`)}<input className={`${input} w-24`} type="number" min={group.start} max={end - 240} step={step} value={cursor?.lane === lane ? cursor[field] : group.start} onChange={e => setCursor({ lane, anchor: group.start, head: group.start, ...(cursor?.lane === lane ? cursor : {}), [field]: bound(Number(e.target.value)) })} /></label>)}
        <button className={button} onClick={() => assign(lane, cursor?.lane === lane ? cursor.anchor : group.start, cursor?.lane === lane ? cursor.head : group.start)}>{t('app.music.beat.shortcut.takeAssign')}</button>
        <button className={button} onClick={() => setCursor(null)}>{t('app.music.beat.shortcut.takeClear')}</button>
      </div>
      <div dir="ltr" tabIndex={0} role="application" aria-label={t('app.music.beat.labels.l39', { p0: lane + 1, p1: doc.assets[id].name })}
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
