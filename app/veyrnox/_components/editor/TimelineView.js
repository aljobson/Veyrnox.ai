'use client';
import { FPS, videoLayout, totalFrames, formatTime } from '../../_lib/editorTimeline.mjs';

const LANE = 'relative h-14 border-b border-vx-border bg-vx-base';

function ClipBox({ clip, name, start, ppf, selected, tone, onSelect }) {
    return <button type="button" aria-pressed={selected} aria-label={`${name}, ${formatTime(clip.len)} long, starts at ${formatTime(start)}`}
        onClick={event => { event.stopPropagation(); onSelect(); }}
        className={`absolute top-1 bottom-1 overflow-hidden rounded-lg border px-2 text-left text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent ${tone} ${selected ? 'border-vx-accent ring-2 ring-vx-accent' : 'border-vx-border'}`}
        style={{ left: start * ppf, width: Math.max(6, clip.len * ppf - 2) }}>
        <span className="block truncate">{name}</span><span className="block font-vx-mono font-normal text-vx-fg-muted">{formatTime(clip.len)}</span>
    </button>;
}

/** Three lanes (video, sound, text) and a playhead. Pure view: every change goes back to the page through the callbacks. */
export function TimelineView({ tl, frame, selected, ppf, onSelect, onSeek }) {
    const total = totalFrames(tl);
    const width = Math.max(total + FPS * 10, FPS * 20) * ppf;
    const seek = event => onSeek(Math.max(0, Math.min(Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / ppf), total)));
    const marks = Array.from({ length: Math.ceil(width / (FPS * ppf)) }, (_, s) => s);
    return <div className="overflow-x-auto rounded-2xl border border-vx-border bg-vx-panel" role="group" aria-label="Timeline">
        <div className="relative" style={{ width }}>
            <div className="relative h-6 cursor-pointer border-b border-vx-border text-[10px] text-vx-fg-muted" onClick={seek} aria-hidden="true">
                {marks.map(s => <span key={s} className="absolute top-0 border-l border-vx-border pl-1" style={{ left: s * FPS * ppf }}>{s % 5 === 0 ? `${s}s` : ''}</span>)}
            </div>
            <div className={LANE} onClick={seek} aria-label="Video track" role="group">
                {videoLayout(tl).map(({ clip, start }) => <ClipBox key={clip.id} clip={clip} name={tl.media[clip.mediaId]?.name || 'Clip'} start={start} ppf={ppf} tone="bg-vx-panel"
                    selected={selected?.id === clip.id} onSelect={() => onSelect({ track: 'video', id: clip.id })} />)}
            </div>
            <div className={LANE} onClick={seek} aria-label="Audio track" role="group">
                {tl.audio.map(clip => <ClipBox key={clip.id} clip={clip} name={tl.media[clip.mediaId]?.name || 'Sound'} start={clip.start} ppf={ppf} tone="bg-vx-base"
                    selected={selected?.id === clip.id} onSelect={() => onSelect({ track: 'audio', id: clip.id })} />)}
            </div>
            <div className={LANE} onClick={seek} aria-label="Text track" role="group">
                {tl.text.map(x => <ClipBox key={x.id} clip={{ len: x.len }} name={x.text} start={x.start} ppf={ppf} tone="bg-vx-panel"
                    selected={selected?.id === x.id} onSelect={() => onSelect({ track: 'text', id: x.id })} />)}
            </div>
            <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px bg-vx-accent" style={{ left: frame * ppf }}>
                <span className="absolute -left-1 top-0 size-2 rounded-full bg-vx-accent" />
            </div>
        </div>
    </div>;
}
