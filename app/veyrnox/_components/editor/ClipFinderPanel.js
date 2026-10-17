'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { insertClipSegments } from '../../_lib/editorClipFinder.mjs';
import { checkClipForFinder, findClips, pickRows, tickedPicks } from '../../_lib/editorClipRun.mjs';

const NONE = [];
// ADR-0105 slice C. Suggests the best short stretches of the selected video clip, each with its reasons, and adds the ticked ones after the
// timeline as one undoable edit. Runs on this device: no upload, no model, no credits.
export function ClipFinderPanel({ tl, blobs, disabled, selected, apply, onSeek, onError, onBusy, onPreview }) {
    const item = selected?.track === 'video' ? tl.video.find(c => c.id === selected.id) : null;
    const media = item ? tl.media[item.mediaId] : null;
    const key = item ? `${item.id}:${item.mediaId}:${item.start}:${item.in}:${item.len}:${tl.text.length}` : '';
    const [run, setRun] = useState({ status: 'idle', progress: 0, rows: [], key: '', hadAudio: true });
    const abort = useRef(null);
    const fresh = run.key === key && run.status === 'done';
    const rows = useMemo(() => (fresh ? run.rows : NONE), [fresh, run.rows]);
    const blocker = item ? checkClipForFinder(media, item) : 'Select a video clip on the timeline first.';

    useEffect(() => { onPreview?.(rows.map(r => ({ frame: r.frame, kind: 'pick', ticked: r.ticked }))); }, [rows, onPreview]);
    useEffect(() => () => { abort.current?.abort(); onPreview?.([]); }, [onPreview]);

    async function find() {
        const blob = blobs.current.get(item.mediaId);
        if (!blob) { onError?.('This clip\'s file is not loaded in this window. Relink it first.'); return; }
        const controller = new AbortController(); abort.current = controller;
        setRun({ status: 'running', progress: 0, rows: [], key, hadAudio: true });
        onBusy?.(true);
        try {
            const result = await findClips(blob, tl, item, { signal: controller.signal, onProgress: p => setRun(r => (r.status === 'running' ? { ...r, progress: p } : r)) });
            if (result.error) throw new Error(result.error);
            setRun({ status: 'done', progress: 1, rows: pickRows(item, result.picks), key, hadAudio: result.hadAudio });
        } catch (error) {
            setRun({ status: 'idle', progress: 0, rows: [], key: '', hadAudio: true });
            if (error.name !== 'AbortError') onError?.(error.message || 'Searching this clip failed. Try a shorter clip.');
        } finally { abort.current = null; onBusy?.(false); }
    }
    const toggle = index => setRun(r => ({ ...r, rows: r.rows.map((x, i) => (i === index ? { ...x, ticked: !x.ticked } : x)) }));
    const add = () => {
        const next = apply(t => insertClipSegments(t, item.mediaId, tickedPicks(rows)));
        if (next) setRun({ status: 'idle', progress: 0, rows: [], key: '', hadAudio: true });
    };
    const count = tickedPicks(rows).length;

    return <section aria-label="Clip finder" className="space-y-3">
        <h2 className="text-sm font-bold">Clip finder</h2>
        <p className="text-xs text-vx-fg-muted">Suggests short stretches of the selected clip that are likely to work on their own, using shot changes, loudness and any captions. It runs on your device: nothing is uploaded and it costs no credits. These are suggestions to review, not a judgement of quality.</p>
        {blocker && <p role="status" className="text-xs">{blocker}</p>}
        {run.status === 'running'
            ? <div className="space-y-2"><progress aria-label="Clip search progress" className="w-full" value={run.progress} max={1} /><Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button></div>
            : <Button size="sm" disabled={disabled || !!blocker} onClick={find}>{fresh ? 'Search again' : 'Find clips'}</Button>}
        {fresh && !run.hadAudio && <p role="status" className="text-xs">This clip has no sound, so loudness was not used.</p>}
        {fresh && !rows.length && <p role="status" className="text-xs">No stretch of 3 to 10 seconds was found in this clip.</p>}
        {!!rows.length && <ol aria-label="Suggested clips" className="space-y-2">{rows.map((r, i) => <li key={`${r.start}-${r.end}`} className="rounded border border-vx-border p-2">
            <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" aria-label={`Add ${formatTime(Math.round(r.start * 30))} to ${formatTime(Math.round(r.end * 30))}`} checked={r.ticked} disabled={disabled} onChange={() => toggle(i)} />
                <button type="button" className="font-vx-mono underline" onClick={e => { e.preventDefault(); onSeek?.(r.frame); }}>{formatTime(Math.round(r.start * 30))}–{formatTime(Math.round(r.end * 30))}</button>
                <span className="text-vx-fg-muted">{r.seconds.toFixed(1)} s</span>
            </label>
            <ul className="mt-1 list-disc pl-5 text-[11px] text-vx-fg-muted">{r.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </li>)}</ol>}
        {!!rows.length && <Button size="sm" disabled={disabled || !count} onClick={add}>{count ? `Add ${count} ${count === 1 ? 'clip' : 'clips'} to the timeline` : 'Tick a clip to add it'}</Button>}
    </section>;
}
