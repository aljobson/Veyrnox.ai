'use client';
import { MediaArtwork } from './AdvancedMediaBin';
import { useRef, useState } from 'react';
import { sequenceEnd, trackFor } from '../../_lib/editorSequence.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
const button = 'rounded border border-vx-border px-2 py-1 text-[10px] hover:border-vx-accent disabled:opacity-40';
function TimedClip({ clip, track, name, ppf, selected, disabled, onSelect, onTrim, onDrag, media, blobs, loaded }) {
    const gesture = useRef(null), [preview, setPreview] = useState(null);
    const trim = edge => ({
        onPointerDown: e => { e.preventDefault(); e.stopPropagation(); gesture.current = { x: e.clientX, edge }; e.currentTarget.setPointerCapture(e.pointerId); },
        onPointerMove: e => { if (gesture.current) setPreview({ edge, delta: Math.round((e.clientX - gesture.current.x) / ppf) }); },
        onPointerUp: e => { if (!gesture.current) return; const delta = Math.round((e.clientX - gesture.current.x) / ppf); gesture.current = null; setPreview(null); if (delta) onTrim(track.kind, clip.id, edge, delta); },
        onPointerCancel: () => { gesture.current = null; setPreview(null); },
        onKeyDown: e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); onTrim(track.kind, clip.id, edge, e.key === 'ArrowLeft' ? -1 : 1); } },
    });
    const start = clip.start + (preview?.edge === 'in' ? preview.delta : 0), len = clip.len + (preview ? (preview.edge === 'in' ? -preview.delta : preview.delta) : 0);
    return <div className={`absolute bottom-1 top-1 overflow-hidden rounded-md border ${selected ? 'border-vx-accent ring-2 ring-vx-accent' : 'border-vx-border'} ${track.kind === 'audio' ? 'bg-emerald-950' : track.kind === 'text' ? 'bg-violet-950' : 'bg-vx-panel'}`} style={{ left: Math.max(0, start) * ppf, width: Math.max(8, len * ppf - 2) }}>
        <button type="button" disabled={disabled || track.locked} draggable={!disabled && !track.locked} data-testid={`clip-${clip.id}`} aria-pressed={selected}
            aria-label={`${name}, ${track.name}, starts ${formatTime(clip.start)}, duration ${formatTime(clip.len)}`}
            onDragEnd={()=>onDrag(null)} onDragStart={e => { if (!selected) onSelect({ track: track.kind, id: clip.id }); onDrag({ kind: track.kind, id: clip.id, offset: e.clientX - e.currentTarget.getBoundingClientRect().left }); e.dataTransfer.setData('text/plain', clip.id); }}
            onClick={e => { e.stopPropagation(); onSelect({ track: track.kind, id: clip.id }, e.shiftKey || e.metaKey || e.ctrlKey); }} className="h-full w-full truncate px-3 text-left text-xs font-bold">
            {media && <div className="absolute inset-0"><MediaArtwork compact media={media} blobs={blobs} loaded={loaded} /></div>}<span className="relative">{name}</span><span className="block text-[10px] font-normal opacity-70">{formatTime(clip.len)}{clip.rate && clip.rate !== 1 ? ` · ${clip.rate}×` : ''}</span>
        </button>
        {selected && !track.locked && ['in', 'out'].map(edge => <button key={edge} type="button" disabled={disabled} {...trim(edge)} aria-label={`Trim ${edge === 'in' ? 'start' : 'end'} of ${name}`} className={`absolute bottom-0 top-0 w-2 cursor-ew-resize touch-none bg-vx-accent/60 ${edge === 'in' ? 'left-0' : 'right-0'}`} />)}
    </div>;
}
export function TrackTimeline({ height=420,onMediaDrop,tl, frame, selected, selection = [], ppf, disabled, snap, onSelect, onSeek, onTrim, onMove, onTrack, onReorder, blobs, loaded }) {
    const dragged = useRef(null), total = sequenceEnd(tl), width = Math.max(600, (total + 150) * ppf);
    const at = e => Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / ppf));
    return <section aria-label="Multitrack timeline" style={{maxHeight:height}} className="overflow-y-auto rounded-xl border border-vx-border">
        <div className="flex"><div className="w-40 shrink-0 border-r border-vx-border bg-vx-panel">
            <div className="h-7 px-3 pt-1 text-[10px] text-vx-fg-muted">TRACKS</div>
            {tl.tracks.map(t => <div key={t.id} className="h-20 border-t border-vx-border px-2 py-1">
                <input aria-label={`Rename ${t.name}`} className="w-full bg-transparent text-xs font-bold" key={`${t.id}:${t.name}`} defaultValue={t.name} maxLength={40} disabled={disabled} onBlur={e => { if (e.target.value.trim()) onTrack(t.id, { name: e.target.value.trim() }); }} />
                <div className="mt-1 flex flex-wrap gap-1">
                    <button type="button" className={button} aria-label={`${t.locked ? 'Unlock' : 'Lock'} ${t.name}`} aria-pressed={t.locked} disabled={disabled} onClick={() => onTrack(t.id, { locked: !t.locked })}>{t.locked ? 'Locked' : 'Lock'}</button>
                    <button type="button" className={button} aria-label={`${t.muted ? 'Unmute' : 'Mute'} ${t.name}`} aria-pressed={t.muted} disabled={disabled} onClick={() => onTrack(t.id, { muted: !t.muted })}>{t.muted ? 'Muted' : 'Mute'}</button>
                    {t.kind !== 'text' && <button type="button" className={button} aria-label={`${t.solo ? 'Unsolo' : 'Solo'} ${t.name}`} aria-pressed={!!t.solo} disabled={disabled} onClick={() => onTrack(t.id, { solo: !t.solo })}>Solo</button>}
                    <button type="button" className={button} aria-label={`Move ${t.name} up`} disabled={disabled || tl.tracks[0].id === t.id} onClick={() => onReorder(t.id, -1)}>↑</button><button type="button" className={button} aria-label={`Move ${t.name} down`} disabled={disabled || tl.tracks.at(-1).id === t.id} onClick={() => onReorder(t.id, 1)}>↓</button>
                    {t.kind !== 'audio'  && <button type="button" className={button} aria-label={`${t.hidden ? 'Show' : 'Hide'} ${t.name}`} aria-pressed={t.hidden} disabled={disabled} onClick={() => onTrack(t.id, { hidden: !t.hidden })}>{t.hidden ? 'Hidden' : 'Hide'}</button>}
                </div>
            </div>)}
        </div><div className="min-w-0 flex-1 overflow-x-auto"><div className="relative" style={{ width }}>
            <div className="relative h-7 cursor-crosshair text-[10px] text-vx-fg-muted" onClick={e => onSeek(at(e))}>
                {Array.from({ length: Math.ceil(width / (30 * ppf)) }, (_, i) => <span key={i} className="absolute border-l border-vx-border pl-1" style={{ left: i * 30 * ppf }}>{i % (ppf < 1 ? 5 : 1) === 0 ? `${i}s` : ''}</span>)}
            </div>
            {tl.tracks.map(t => <div key={t.id} role="group" aria-label={`${t.name} timeline`} className="relative h-20 border-t border-vx-border bg-vx-base" onClick={e => onSeek(at(e))}
                onDragOver={e => { if (!t.locked && !disabled && (dragged.current?.kind === t.kind || (t.kind!=='text' && e.dataTransfer.types.includes('application/x-veyrnox-media')))) e.preventDefault(); }}
                onDrop={e => { e.preventDefault();const mediaId=e.dataTransfer.getData('application/x-veyrnox-media');if(mediaId && t.kind!=='text' && !disabled && !t.locked){onMediaDrop?.(t.kind,mediaId,at(e),t.id);return;} const source = dragged.current; dragged.current = null; if (source && source.kind === t.kind && !disabled && !t.locked) onMove(t.kind, source.id, Math.max(0, at(e) - Math.round(source.offset / ppf)), t.id, snap); }}>
                {tl[t.kind].filter(c => c.trackId === t.id).map(c => <TimedClip key={c.id} media={tl.media[c.mediaId]} blobs={blobs} loaded={loaded.includes(c.mediaId)} clip={c} track={trackFor(tl, c)} ppf={ppf} name={t.kind === 'text' ? c.text : tl.media[c.mediaId]?.name} selected={selection.some(s => s.id === c.id) || selected?.id === c.id} disabled={disabled} onSelect={onSelect} onTrim={onTrim} onDrag={source => { dragged.current = source; }} />)}
            </div>)}
            <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 w-px bg-vx-accent" style={{ left: frame * ppf }}><span className="absolute -left-1 top-0 size-2 rounded-full bg-vx-accent" /></div>
        </div></div></div>
    </section>;
}
