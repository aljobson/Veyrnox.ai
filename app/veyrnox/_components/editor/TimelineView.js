'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useRef, useState } from 'react';
import { FPS, MAX_FRAMES, videoLayout, totalFrames, formatTime } from '../../_lib/editorTimeline.mjs';

const TRACK_TEXT = 'text';
const LANE = 'relative h-16 border-b border-vx-border bg-vx-base';
const HANDLE = 'absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize bg-vx-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

function TrimHandle({ side, name, ppf, disabled, onSelect, onTrim, onPreview }) {
    const { t } = useI18n();
    const drag = useRef(null);
    return <button type="button" disabled={disabled} aria-label={t(side === 'in' ? 'app.editor.timeline.trimStart' : 'app.editor.timeline.trimEnd', {name})}
        className={`${HANDLE} ${side === 'in' ? 'start-0' : 'end-0'}`}
        onPointerDown={event => { event.stopPropagation(); event.preventDefault(); onSelect(); drag.current = event.clientX; onPreview(side, 0); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (drag.current !== null) onPreview(side, Math.round((event.clientX - drag.current) / ppf)); }}
        onPointerUp={event => { if (drag.current === null) return; const delta = Math.round((event.clientX - drag.current) / ppf); drag.current = null; onPreview(null, 0); if (delta) onTrim(side, delta); }}
        onPointerCancel={() => { drag.current = null; onPreview(null, 0); }} onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.stopPropagation(); event.preventDefault(); onTrim(side, event.key === 'ArrowLeft' ? -1 : 1); } }} />;
}

function ClipBox({ clip, name, start, ppf, selected, track, disabled, onSelect, onTrim, onDragStart, onDrop }) {
    const { t, locale } = useI18n();
    const time = value => locale === 'en' ? formatTime(value) : formatTime(value).replace(/\d+/g, part => new Intl.NumberFormat(localeTag(locale), {useGrouping:false,minimumIntegerDigits:part.length}).format(Number(part)));
    const [delta, setDelta] = useState(0);
    const [edge, setEdge] = useState(null);
    const ghostStart = start + (edge === 'in' && track !== 'video' ? delta : 0);
    const ghostLen = clip.len + (edge === 'in' ? -delta : edge === 'out' ? delta : 0);
    return <div className={`absolute top-1 bottom-1 overflow-hidden rounded-lg border bg-vx-panel ${selected ? 'border-vx-accent ring-2 ring-vx-accent' : 'border-vx-border'}`}
        style={{ insetInlineStart: ghostStart * ppf, width: Math.max(6, ghostLen * ppf - 2) }} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        <button type="button" disabled={disabled} draggable={!disabled} onDragStart={onDragStart} aria-pressed={selected}
            aria-label={t('app.editor.timeline.clip', {name,duration:time(clip.len),start:time(start)})}
            onClick={event => { event.stopPropagation(); onSelect(); }}
            className="h-full w-full overflow-hidden px-3 text-start text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent">
            <span className="block truncate">{name}</span><span className="block font-vx-mono font-normal text-vx-fg-muted">{time(clip.len)}</span>
        </button>
        {selected && Object.keys({in:0,out:0}).map(side => <TrimHandle key={side} side={side} name={name} ppf={ppf} disabled={disabled} onSelect={onSelect} onTrim={onTrim} onPreview={(edge, delta) => { setEdge(edge); setDelta(delta); }} />)}
    </div>;
}

/** Time is shared across the lanes. Edits commit once at the end of a drag, so one gesture is one undo. */
export function TimelineView({ tl, frame, selected, ppf, disabled, onSelect, onSeek, onTrim, onMove }) {
  const { t, locale } = useI18n();
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
    return <div dir="ltr" className="overflow-x-auto rounded-2xl border border-vx-border bg-vx-panel" role="group" aria-label={t("app.editor.workspace.timeline")}>
        <div className="relative" style={{ width }}>
            <div className="relative h-7 cursor-pointer border-b border-vx-border text-[10px] text-vx-fg-muted" onClick={seek} aria-hidden="true">
                {marks.map(s => <span key={s} className="absolute top-0 border-s border-vx-border ps-1" style={{ insetInlineStart: s * FPS * ppf }}>{s % (ppf < 1 ? 5 : 1) === 0 ? `${locale === 'en' ? s : new Intl.NumberFormat(localeTag(locale)).format(s)}s` : ''}</span>)}
            </div>
            <div className={LANE} onClick={seek} aria-label={t("app.editor.timeline.video")} role="group" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'video', Math.max(0, tl.video.length - 1))}>
                {videoLayout(tl).map(({ clip, start }, index) => box(clip, start, t("app.publish.composer.media.video"), index, tl.media[clip.mediaId]?.name || t("app.library.kind.video")))}
            </div>
            <div className={LANE} onClick={seek} aria-label={t("app.editor.timeline.audio")} role="group" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'audio')}>
                {tl.audio.map(clip => box(clip, clip.start, t("app.editor.media.kind.audio"), 0, tl.media[clip.mediaId]?.name || t("app.library.kind.audio")))}
            </div>
            <div className={LANE} onClick={seek} aria-label={t("app.editor.timeline.text")} role="group" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'text')}>
                {tl.text.map(clip => box(clip, clip.start, TRACK_TEXT, 0, clip.text))}
            </div>
            <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px bg-vx-accent" style={{ insetInlineStart: frame * ppf }}>
                <span className="absolute -start-1 top-0 size-2 rounded-full bg-vx-accent" />
            </div>
        </div>
    </div>;
}
