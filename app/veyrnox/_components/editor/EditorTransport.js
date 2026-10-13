'use client';
import { useState } from 'react';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { formatTimecode, parseTimecode } from '../../_lib/editorTransport.mjs';

const button = 'grid size-8 shrink-0 place-items-center rounded-lg border border-vx-border bg-vx-base text-vx-fg transition-colors hover:border-vx-accent hover:text-vx-accent disabled:opacity-35';
const paths = {
    start: 'M5 5v14M19 6l-10 6 10 6z', previous: 'm15 6-8 6 8 6z', play: 'm8 5 11 7-11 7z', pause: 'M8 5h3v14H8zm5 0h3v14h-3z', next: 'm9 6 8 6-8 6z', end: 'M19 5v14M5 6l10 6-10 6z', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', shortcuts: 'M8.5 9a3.5 3.5 0 1 1 5.8 2.6c-1.3 1-2.3 1.4-2.3 3.4M12 19h.01',
};
function Icon({name}) { return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>; }
function Control({name,label,onClick,disabled=false,pressed}) { return <button type="button" className={button} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><Icon name={name} /></button>; }

export function EditorTransport({frame,total,playing,preparing,disabled,onPlay,onPause,onSeek,onFit,onShortcuts}) {
    const [draft,setDraft]=useState(null),[invalid,setInvalid]=useState(false);
    const commit=event=>{
        event.preventDefault();
        const parsed=parseTimecode(draft??formatTimecode(frame));
        if(parsed===null){setInvalid(true);return;}
        setInvalid(false);setDraft(null);onSeek(Math.min(parsed,Math.max(0,total-1)));
    };
    const empty=!total;
    return <div aria-label="Playback controls" className="flex min-w-0 flex-wrap items-center justify-center gap-2 rounded-xl border border-vx-border bg-vx-base/70 px-2 py-2">
        <div className="flex items-center gap-1">
            <Control name="start" label="Go to start (Home)" disabled={empty||disabled} onClick={()=>onSeek(0)} />
            <Control name="previous" label="Previous frame (Left arrow)" disabled={empty||disabled||frame<=0} onClick={()=>onSeek(frame-1)} />
            <button type="button" className="grid size-9 shrink-0 place-items-center rounded-full bg-vx-accent text-vx-accent-ink transition-transform enabled:hover:scale-105 disabled:opacity-35" aria-label={playing||preparing?'Pause playback':'Play video'} disabled={empty||disabled} onClick={playing||preparing?onPause:onPlay}><Icon name={playing||preparing?'pause':'play'} /></button>
            <Control name="next" label="Next frame (Right arrow)" disabled={empty||disabled||frame>=total-1} onClick={()=>onSeek(frame+1)} />
            <Control name="end" label="Go to end (End)" disabled={empty||disabled} onClick={()=>onSeek(Math.max(0,total-1))} />
        </div>
        <form onSubmit={commit} className="flex items-center gap-2">
            <label className="sr-only" htmlFor="editor-timecode">Current timecode</label>
            <input id="editor-timecode" inputMode="numeric" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid?'editor-timecode-error':undefined} value={draft??formatTimecode(frame)} onFocus={()=>{setDraft(formatTimecode(frame));setInvalid(false);}} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')commit(event);}} onBlur={commit} className={`w-[106px] rounded-lg border bg-vx-panel px-2 py-1.5 text-center font-vx-mono text-xs tabular-nums outline-none focus:border-vx-accent ${invalid?'border-vx-danger':'border-vx-border'}`} />
            <span className="font-vx-mono text-[11px] tabular-nums text-vx-fg-muted">/ {formatTime(total)}</span>
            {invalid&&<span id="editor-timecode-error" role="alert" className="sr-only">Use hours, minutes, seconds and frames, for example 00:00:03:12.</span>}
        </form>
        <div className="ml-auto flex items-center gap-1">
            <Control name="fit" label="Fit timeline to window (Shift+Z)" onClick={onFit} />
            <Control name="shortcuts" label="Keyboard shortcuts (?)" onClick={onShortcuts} />
        </div>
    </div>;
}
