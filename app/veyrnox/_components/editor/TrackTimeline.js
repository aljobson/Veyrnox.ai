'use client';
import { MediaArtwork } from './AdvancedMediaBin';
import { useEffect, useRef, useState } from 'react';
import { sequenceEnd, trackFor } from '../../_lib/editorSequence.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
const button = 'grid size-6 place-items-center rounded border border-vx-border text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg disabled:opacity-40';
const controlPaths={lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z',unlock:'M8 10V7a4 4 0 0 1 7.5-2M5 10h14v11H5z',mute:'M4 10h4l5-4v12l-5-4H4zM17 9l4 6m0-6-4 6',sound:'M4 10h4l5-4v12l-5-4H4zM17 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10',solo:'M7 8c0-2 2-3 5-3s5 1 5 3-2 3-5 3-5 1-5 3 2 3 5 3 5-1 5-3',up:'m7 14 5-5 5 5',down:'m7 10 5 5 5-5',show:'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Zm9 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',hide:'m3 3 18 18M10.6 10.7A2 2 0 0 0 13.3 13.4M9.9 4.2A10 10 0 0 1 21 12a13 13 0 0 1-2.2 3.1M6.2 6.2A13 13 0 0 0 3 12s3.5 6 9 6c1 0 1.9-.2 2.8-.5',remove:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14'};
function TrackControl({name,label,pressed,disabled,onClick}) {return <button type="button" className={button} title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={controlPaths[name]}/></svg></button>;}
function TimedClip({ clip, track, name, ppf, selected, disabled, onSelect, onTrim, onDrag, media, blobs, loaded, sourceRevision }) {
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
            {media && <div className="absolute inset-0"><MediaArtwork compact media={media} clip={clip} pixels={clip.len * ppf} blobs={blobs} loaded={loaded} sourceRevision={sourceRevision} /></div>}<span className="relative">{name}</span><span className="block text-[10px] font-normal opacity-70">{formatTime(clip.len)}{clip.rate && clip.rate !== 1 ? ` · ${clip.rate}×` : ''}</span>
        </button>
        {selected && !track.locked && ['in', 'out'].map(edge => <button key={edge} type="button" disabled={disabled} {...trim(edge)} aria-label={`Trim ${edge === 'in' ? 'start' : 'end'} of ${name}`} className={`absolute bottom-0 top-0 w-5 cursor-ew-resize touch-none bg-vx-accent/60 md:w-2 ${edge === 'in' ? 'left-0' : 'right-0'}`} />)}
    </div>;
}
export function TrackTimeline({ previewMarks=[],height=420,onMediaDrop,tl, frame, selected, selection = [], ppf, disabled, snap, follow=false, onSelect, onSeek, onZoom, onViewport, onTrim, onMove, onTrack, onReorder, onRemove, blobs, loaded }) {
    const dragged = useRef(null),scrubbing=useRef(false),scroll=useRef(null), total = sequenceEnd(tl), width = Math.max(480, (total + 150) * ppf);
    const at = e => Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / ppf));
    useEffect(()=>{
        const node=scroll.current;if(!node||!onViewport)return;
        const report=()=>onViewport(node.clientWidth);
        report();const observer=new ResizeObserver(report);observer.observe(node);return()=>observer.disconnect();
    },[onViewport]);
    useEffect(()=>{
        const node=scroll.current;if(!node||!follow)return;
        const x=frame*ppf,left=node.scrollLeft,right=left+node.clientWidth;
        if(x<left+node.clientWidth*.15||x>right-node.clientWidth*.15)node.scrollTo({left:Math.max(0,x-node.clientWidth*.35),behavior:'smooth'});
    },[follow,frame,ppf]);
    const scrub={
        onPointerDown:e=>{if(disabled)return;scrubbing.current=true;e.currentTarget.setPointerCapture(e.pointerId);onSeek(Math.min(at(e),Math.max(0,total-1)));},
        onPointerMove:e=>{if(scrubbing.current)onSeek(Math.min(at(e),Math.max(0,total-1)));},
        onPointerUp:e=>{scrubbing.current=false;e.currentTarget.releasePointerCapture?.(e.pointerId);},
        onPointerCancel:()=>{scrubbing.current=false;},
    };
    return <section aria-label="Multitrack timeline" style={{height,maxHeight:height}} className="min-h-0 overflow-y-auto rounded-xl border border-vx-border">
        <div className="flex"><div className="w-32 shrink-0 border-r border-vx-border bg-vx-panel sm:w-40">
            <div className="h-7 px-3 pt-1 text-[10px] text-vx-fg-muted">TRACKS</div>
            {tl.tracks.map(t => <div key={t.id} className="h-20 border-t border-vx-border px-2 py-1">
                <input aria-label={`Rename ${t.name}`} className="w-full bg-transparent text-xs font-bold" key={`${t.id}:${t.name}`} defaultValue={t.name} maxLength={40} disabled={disabled} onBlur={e => { if (e.target.value.trim()) onTrack(t.id, { name: e.target.value.trim() }); }} />
                <div className="mt-1 grid grid-cols-4 gap-0.5 sm:flex sm:flex-wrap sm:gap-1">
                    <TrackControl name={t.locked?'unlock':'lock'} label={`${t.locked ? 'Unlock' : 'Lock'} ${t.name}`} pressed={t.locked} disabled={disabled} onClick={() => onTrack(t.id, { locked: !t.locked })} />
                    <TrackControl name={t.muted?'sound':'mute'} label={`${t.muted ? 'Unmute' : 'Mute'} ${t.name}`} pressed={t.muted} disabled={disabled} onClick={() => onTrack(t.id, { muted: !t.muted })} />
                    {t.kind !== 'text' && <TrackControl name="solo" label={`${t.solo ? 'Unsolo' : 'Solo'} ${t.name}`} pressed={!!t.solo} disabled={disabled} onClick={() => onTrack(t.id, { solo: !t.solo })} />}
                    <TrackControl name="up" label={`Move ${t.name} up`} disabled={disabled || tl.tracks[0].id === t.id} onClick={() => onReorder(t.id, -1)} /><TrackControl name="down" label={`Move ${t.name} down`} disabled={disabled || tl.tracks.at(-1).id === t.id} onClick={() => onReorder(t.id, 1)} />
                    {t.kind !== 'audio' && <TrackControl name={t.hidden?'show':'hide'} label={`${t.hidden ? 'Show' : 'Hide'} ${t.name}`} pressed={t.hidden} disabled={disabled} onClick={() => onTrack(t.id, { hidden: !t.hidden })} />}
                    {onRemove && <TrackControl name="remove" label={`Remove empty ${t.name} track`} disabled={disabled || t.locked || tl[t.kind].some(c => c.trackId === t.id) || tl.tracks.filter(lane => lane.kind === t.kind).length === 1} onClick={() => onRemove(t.id)} />}
                </div>
            </div>)}
        </div><div ref={scroll} className="min-w-0 flex-1 overflow-x-auto" onWheel={e=>{if(onZoom&&(e.ctrlKey||e.metaKey)){e.preventDefault();onZoom(e.deltaY<0?1:-1);}}}><div className="relative" style={{ width }}>
            <div className="relative h-7 cursor-ew-resize touch-none select-none text-[10px] text-vx-fg-muted" aria-label="Timeline ruler" role="slider" aria-valuemin={0} aria-valuemax={Math.max(0,total-1)} aria-valuenow={Math.min(frame,Math.max(0,total-1))} tabIndex={0} {...scrub} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();onSeek(Math.max(0,Math.min(total-1,frame+(e.key==='ArrowLeft'?-1:1))));}}}>
                {Array.from({ length: Math.ceil(width / (30 * ppf)) }, (_, i) => <span key={i} className="absolute border-l border-vx-border pl-1" style={{ left: i * 30 * ppf }}>{i % (ppf < 1 ? 5 : 1) === 0 ? `${i}s` : ''}</span>)}
                {previewMarks.map(mark=><span key={`scene-${mark.frame}`} aria-hidden="true" data-scene-preview={mark.kind} className={`pointer-events-none absolute top-0 z-10 h-7 -translate-x-1/2 border-l-2 ${mark.kind==='hard'?'border-solid':'border-dashed'} ${mark.ticked?'opacity-100':'opacity-60'}`} style={{left:mark.frame*ppf,borderColor:mark.kind==='hard'?'#e4a93c':'#8ba7ff'}} />)}
                {(tl.markers || []).map(marker=><button key={marker.id} type="button" title={`${marker.label} · ${formatTime(marker.frame)}`} aria-label={`Go to ${marker.label} at ${formatTime(marker.frame)}`} className="absolute top-0 z-10 h-7 w-3 -translate-x-1/2 rounded-t-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" style={{left:marker.frame*ppf,backgroundColor:marker.color}} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onSeek(marker.frame);}} />)}
            </div>
            {tl.tracks.map(t => <div key={t.id} role="group" aria-label={`${t.name} timeline`} className="relative h-20 border-t border-vx-border bg-vx-base" onClick={e => onSeek(at(e))}
                onDragOver={e => { if (!t.locked && !disabled && (dragged.current?.kind === t.kind || (t.kind!=='text' && e.dataTransfer.types.includes('application/x-veyrnox-media')))) e.preventDefault(); }}
                onDrop={e => { e.preventDefault();const mediaId=e.dataTransfer.getData('application/x-veyrnox-media');if(mediaId && t.kind!=='text' && !disabled && !t.locked){onMediaDrop?.(t.kind,mediaId,at(e),t.id);return;} const source = dragged.current; dragged.current = null; if (source && source.kind === t.kind && !disabled && !t.locked) onMove(t.kind, source.id, Math.max(0, at(e) - Math.round(source.offset / ppf)), t.id, snap); }}>
                {tl[t.kind].filter(c => c.trackId === t.id).map(c => <TimedClip key={c.id} media={tl.media[c.mediaId]} blobs={blobs} loaded={loaded.includes(c.mediaId)} sourceRevision={loaded} clip={c} track={trackFor(tl, c)} ppf={ppf} name={t.kind === 'text' ? c.text : tl.media[c.mediaId]?.name} selected={selection.some(s => s.id === c.id) || selected?.id === c.id} disabled={disabled} onSelect={onSelect} onTrim={onTrim} onDrag={source => { dragged.current = source; }} />)}
            </div>)}
            <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 w-px bg-vx-accent" style={{ left: frame * ppf }}><span className="absolute -left-1 top-0 size-2 rounded-full bg-vx-accent" /></div>
        </div></div></div>
    </section>;
}
