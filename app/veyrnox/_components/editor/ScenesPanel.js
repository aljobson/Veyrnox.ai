'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { splitSequenceAtFrames } from '../../_lib/editorSequence.mjs';
import { checkSequenceClipForScenes, detectClipScenes, sceneRows, tickedFrames } from '../../_lib/editorSceneRun.mjs';

const NONE = [];
// ADR-0105 slice B. Finds shot changes in the selected video clip, previews them on the timeline and adds the ticked ones as one undoable edit.
export function ScenesPanel({ tl, blobs, disabled, selected, apply, onSeek, onError, onBusy, onPreview }) {
    const item = selected?.track === 'video' ? tl.video.find(c => c.id === selected.id) : null;
    const media = item ? tl.media[item.mediaId] : null;
    const key = item ? `${item.id}:${item.mediaId}:${item.start}:${item.in}:${item.len}` : '';
    const [run, setRun] = useState({ status: 'idle', progress: 0, rows: [], key: '' });
    const abort = useRef(null);
    const fresh = run.key === key && run.status === 'done';
    const rows = useMemo(() => (fresh ? run.rows : NONE), [fresh, run.rows]);
    const blocker = item ? checkSequenceClipForScenes(media, item) : 'Select a video clip on the timeline first.';

    useEffect(() => { onPreview?.(rows.map(r => ({ frame: r.frame, kind: r.kind, ticked: r.ticked }))); }, [rows, onPreview]);
    useEffect(() => () => { abort.current?.abort(); onPreview?.([]); }, [onPreview]);

    async function detect() {
        const blob = blobs.current.get(item.mediaId);
        if (!blob) { onError?.('This clip\'s file is not loaded in this window. Relink it first.'); return; }
        const controller = new AbortController(); abort.current = controller;
        setRun({ status: 'running', progress: 0, rows: [], key });
        onBusy?.(true);
        try {
            const result = await detectClipScenes(blob, item, { signal: controller.signal, onProgress: p => setRun(r => r.status === 'running' ? { ...r, progress: p } : r) });
            if (result.error) throw new Error(result.error);
            setRun({ status: 'done', progress: 1, rows: sceneRows(item, result.cuts), key });
        } catch (error) {
            setRun({ status: 'idle', progress: 0, rows: [], key: '' });
            if (error.name !== 'AbortError') onError?.(error.message || 'Scene detection failed. Try a shorter clip.');
        } finally { abort.current = null; onBusy?.(false); }
    }
    const toggle = frame => setRun(r => ({ ...r, rows: r.rows.map(x => x.frame === frame ? { ...x, ticked: !x.ticked } : x) }));
    const add = () => {
        const next = apply(t => splitSequenceAtFrames(t, 'video', item.id, tickedFrames(rows)));
        if (next) setRun({ status: 'idle', progress: 0, rows: [], key: '' });
    };
    const hard = rows.filter(r => r.kind === 'hard'), possible = rows.filter(r => r.kind !== 'hard'), count = tickedFrames(rows).length;
    const list = (title, items, note) => !!items.length && <div className="space-y-1">
        <h3 className="text-xs font-bold">{title} ({items.length})</h3>{note && <p className="text-[10px] text-vx-fg-muted">{note}</p>}
        <ul className="space-y-1">{items.map(r => <li key={r.frame} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={`Add a cut at ${formatTime(r.frame)}`} checked={r.ticked} disabled={disabled} onChange={() => toggle(r.frame)} />
            <button type="button" className="font-vx-mono underline" onClick={() => onSeek?.(r.frame)}>{formatTime(r.frame)}</button>
        </li>)}</ul></div>;

    return <section aria-label="Scenes" className="space-y-3">
        <h2 className="text-sm font-bold">Scenes</h2>
        <p className="text-xs text-vx-fg-muted">Finds where the shot changes in the selected video clip, on your device. Nothing is uploaded and it costs no credits. Check the markers, then add the cuts as one edit; Undo removes them all.</p>
        {blocker && <p role="status" className="text-xs">{blocker}</p>}
        {run.status === 'running'
            ? <div className="space-y-2"><progress aria-label="Scene detection progress" className="w-full" value={run.progress} max={1} /><Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button></div>
            : <Button size="sm" disabled={disabled || !!blocker} onClick={detect}>{fresh ? 'Detect again' : 'Detect scenes'}</Button>}
        {fresh && !rows.length && <p role="status" className="text-xs">No shot changes found in this clip.</p>}
        {list('Cuts found', hard)}
        {list('Possible dissolves', possible, 'Review these. Fades are less certain, so they start unticked.')}
        {fresh && !!rows.length && <Button size="sm" disabled={disabled || !count} onClick={add}>{count ? `Add ${count} ${count === 1 ? 'cut' : 'cuts'}` : 'Tick a cut to add it'}</Button>}
    </section>;
}
