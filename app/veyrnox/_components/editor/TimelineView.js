'use client';
import { useRef, useState } from 'react';
import { FPS, MAX_FRAMES, videoLayout, totalFrames, formatTime } from '../../_lib/editorTimeline.mjs';

const LANE = 'relative h-16 border-b border-vx-border bg-vx-base';
const HANDLE = 'absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize bg-vx-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

function TrimHandle({ side, name, ppf, disabled, onSelect, onTrim, onPreview }) {
    const drag = useRef(null);
    return <button type="button" disabled={disabled} aria-label={`Trim ${side === 'in' ? 'start' : 'end'} of ${name}`}
        className={`${HANDLE} ${side === 'in' ? 'left-0' : 'right-0'}`}
        onPointerDown={event => { event.stopPropagation(); event.preventDefault(); onSelect(); drag.current = event.clientX; onPreview(side, 0); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (drag.current !== null) onPreview(side, Math.round((event.clientX - drag.current) / ppf)); }}
        onPointerUp={event => { if (drag.current === null) return; const delta = Math.round((event.clientX - drag.current) / ppf); drag.current = null; onPreview(null, 0); if (delta) onTrim(side, delta); }}
        onPointerCancel={() => { drag.current = null; onPreview(null, 0); }} onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.stopPropagation(); event.preventDefault(); onTrim(side, event.key === 'ArrowLeft' ? -1 : 1); } }} />;
}

function ClipBox({ clip, name, start, ppf, selected, track, disabled, onSelect, onTrim, onDragStart, onDrop }) {
    const [delta, setDelta] = useState(0);
    const [edge, setEdge] = useState(null);
    const ghostStart = start + (edge === 'in' && track !== 'video' ? delta : 0);
    const ghostLen = clip.len + (edge === 'in' ? -delta : edge === 'out' ? delta : 0);
    return <div className={`absolute top-1 bottom-1 overflow-hidden rounded-lg border bg-vx-panel ${selected ? 'border-vx-accent ring-2 ring-vx-accent' : 'border-vx-border'}`}
        style={{ left: ghostStart * ppf, width: Math.max(6, ghostLen * ppf - 2) }} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        <button type="button" disabled={disabled} draggable={!disabled} onDragStart={onDragStart} aria-pressed={selected}
            aria-label={`${name}, ${formatTime(clip.len)} long, starts at ${formatTime(start)}`}
            onClick={event => { event.stopPropagation(); onSelect(); }}
            className="h-full w-full overflow-hidden px-3 text-left text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent">
            <span className="block truncate">{name}</span><span className="block font-vx-mono font-normal text-vx-fg-muted">{formatTime(clip.len)}</span>
        </button>
        {selected && ['in', 'out'].map(side => <TrimHandle key={side} side={side} name={name} ppf={ppf} disabled={disabled} onSelect={onSelect} onTrim={onTrim} onPreview={(edge, delta) => { setEdge(edge); setDelta(delta); }} />)}
    </div>;
}

/** Time is shared across the lanes. Edits commit once at the end of a drag, so one gesture is one undo. */
export function TimelineView({ tl, frame, selected, ppf, disabled, onSelect, onSeek, onTrim, onMove }) {
    const dragged = useRef(null);
    const total = totalFrames(tl);
    const width = Math.max(total + FPS * 5, FPS * 20) * ppf;
    const at = event => Math.max(0, Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / ppf));
    const seek = event => { if (!disabled) onSeek(Math.min(at(event), Math.max(0, total - 1))); };
    const marks = Array.from({ length: Math.ceil(width / (FPS * ppf)) }, (_, s) => s);
    const drop = (event, track, index) => {
        event.preventDefault(); event.stopPropagation();
        const source = dragged.current; dragged.current = null;
        if (!disabled && source?.track === track) onMove(track, source.id, track === 'video' ? index : Math.min(at(event), Math.max(0, MAX_FRAMES - source.len)));
    };
    const box = (clip, start, track, index, name) => <ClipBox key={clip.id} clip={clip} name={name} start={start} ppf={ppf} track={track} disabled={disabled}
        selected={selected?.id === clip.id} onSelect={() => onSelect({ track, id: clip.id })}
        onTrim={(edge, delta) => onTrim(track, clip.id, edge, delta)}
        onDragStart={e => { dragged.current = { track, id: clip.id, len: clip.len }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', clip.id); }}
        onDrop={e => { if (track === 'video') drop(e, track, index); }} />;
    return <div className="overflow-x-auto rounded-2xl border border-vx-border bg-vx-panel" role="group" aria-label="Timeline">
        <div className="relative" style={{ width }}>
            <div className="relative h-7 cursor-pointer border-b border-vx-border text-[10px] text-vx-fg-muted" onClick={seek} aria-hidden="true">
                {marks.map(s => <span key={s} className="absolute top-0 border-l border-vx-border pl-1" style={{ left: s * FPS * ppf }}>{s % (ppf < 1 ? 5 : 1) === 0 ? `${s}s` : ''}</span>)}
            </div>
            <div className={LANE} onClick={seek} aria-label="Video track" role="group" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'video', Math.max(0, tl.video.length - 1))}>
                {videoLayout(tl).map(({ clip, start }, index) => box(clip, start, 'video', index, tl.media[clip.mediaId]?.name || 'Video'))}
            </div>
            <div className={LANE} onClick={seek} aria-label="Audio track" role="group" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'audio')}>
                {tl.audio.map(clip => box(clip, clip.start, 'audio', 0, tl.media[clip.mediaId]?.name || 'Audio'))}
            </div>
            <div className={LANE} onClick={seek} aria-label="Text track" role="group" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'text')}>
                {tl.text.map(clip => box(clip, clip.start, 'text', 0, clip.text))}
            </div>
            <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px bg-vx-accent" style={{ left: frame * ppf }}>
                <span className="absolute -left-1 top-0 size-2 rounded-full bg-vx-accent" />
            </div>
        </div>
    </div>;
}
