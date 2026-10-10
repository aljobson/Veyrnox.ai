'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { Button } from '../../_components/Button';
import { TimelineView } from '../../_components/editor/TimelineView';
import { gatewayFetch } from '../../_lib/gateway';
import { useEditorPreview } from '../../_lib/useEditorPreview';
import {
    FPS, LIMITS, emptyTimeline, addMedia, addVideoClip, addAudioClip, splitClip, trimClip, removeClip, setVolume, moveVideoClip,
    moveAudioClip, pruneMedia, totalFrames, videoLayout, formatTime,
} from '../../_lib/editorTimeline.mjs';
import { checkLocalFile, probeMedia, checkProbe, mediaFromProbe, libraryMediaId, localMediaId } from '../../_lib/editorMedia.mjs';
import { listLibraryMedia, loadLibraryBlob } from '../../_lib/editorLibrary.mjs';
import { createPreviewer } from '../../_lib/editorPreview.mjs';
import { exportBlocker, exportTimeline, exportFileName } from '../../_lib/editorExport.mjs';

const PPF = 4; // pixels per frame on the timeline (120 px a second)
const field = 'rounded-xl border border-vx-border bg-vx-base px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
const range = 'mt-2 w-full accent-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent';

function Editor() {
    const canvas = useRef(null), blobs = useRef(new Map()), previewer = useRef(null), exportAbort = useRef(null), alive = useRef(true);
    const [history, setHistory] = useState({ past: [], now: emptyTimeline() });
    const tl = history.now;
    const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [selected, setSelected] = useState(null);
    const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const [library, setLibrary] = useState(null), [libraryError, setLibraryError] = useState('');
    const [blocker, setBlocker] = useState(''), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
    const [result, setResult] = useState(null), [height, setHeight] = useState(720);
    const total = totalFrames(tl);

    useEffect(() => { alive.current = true; return () => { alive.current = false; exportAbort.current?.abort(); }; }, []);
    useEffect(() => { exportBlocker().then(text => alive.current && setBlocker(text || '')); }, []);
    useEffect(() => () => { previewer.current?.dispose(); }, []);
    useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

    // Apply an edit. A model refusal ({ error }) is shown and nothing changes; a success is one undo step.
    const apply = useCallback(fn => {
        setNotice(''); setResult(null);
        setHistory(h => {
            const next = fn(h.now);
            if (next?.error) { setNotice(next.error); return h; }
            if (next === h.now) return h;
            return { past: [...h.past.slice(-49), h.now], now: next };
        });
    }, []);
    const undo = () => { setResult(null); setHistory(h => (h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1] } : h)); };

    // Draw the frame under the playhead. A new previewer is made whenever files change, so decoders never outlive their blobs.
    useEffect(() => {
        if (!canvas.current) return;
        if (!previewer.current) previewer.current = createPreviewer(blobs.current);
        previewer.current.draw(tl, Math.min(frame, Math.max(total - 1, 0)), canvas.current).catch(() => {});
    }, [tl, frame, total]);

    useEffect(() => {
        if (!playing) return undefined;
        let raf = 0, last = performance.now(), carry = 0;
        const tick = now => {
            carry += ((now - last) / 1000) * FPS; last = now;
            const step = Math.floor(carry); carry -= step;
            if (step > 0) setFrame(f => { const n = f + step; if (n >= total) { setPlaying(false); return Math.max(total - 1, 0); } return n; });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing, total]);

    async function ingest(id, name, blob) {
        const probe = await probeMedia(blob);
        const bad = checkProbe(probe);
        if (bad) throw new Error(bad);
        blobs.current.set(id, blob);
        const media = mediaFromProbe(id, name, probe);
        apply(t => {
            const withMedia = addMedia(t, media);
            if (withMedia.error) return withMedia;
            return media.kind === 'video' ? addVideoClip(withMedia, id) : addAudioClip(withMedia, id, { start: 0 });
        });
    }
    async function chooseFiles(event) {
        const files = [...event.target.files]; event.target.value = '';
        setBusy(true); setNotice('');
        for (const file of files) {
            const ok = checkLocalFile(file);
            if (ok.error) { setNotice(ok.error); continue; }
            try { await ingest(localMediaId(), file.name, file); } catch (e) { setNotice(e.message); }
        }
        if (alive.current) setBusy(false);
    }
    async function openLibrary() {
        setLibraryError(''); setLibrary([]);
        try { const items = await listLibraryMedia(gatewayFetch); if (alive.current) setLibrary(items); }
        catch { if (alive.current) { setLibrary(null); setLibraryError('Could not load your Library. Try again.'); } }
    }
    async function addFromLibrary(item) {
        setBusy(true); setNotice('');
        try { const { blob } = await loadLibraryBlob(gatewayFetch, item.jobId); await ingest(libraryMediaId(item.jobId), item.label, blob); }
        catch (e) { setNotice(e.message); }
        if (alive.current) setBusy(false);
    }

    const clip = selected ? tl[selected.track].find(c => c.id === selected.id) : null;
    const media = clip ? tl.media[clip.mediaId] : null;
    const layoutStart = clip && selected.track === 'video' ? videoLayout(tl).find(l => l.clip.id === clip.id)?.start : clip?.start;
    const edit = fn => selected && apply(t => fn(t, selected.track, selected.id));

    async function runExport() {
        const abort = new AbortController(); exportAbort.current = abort;
        setPlaying(false); setNotice(''); setResult(null); setProgress(0); setExporting(true);
        try {
            const blob = await exportTimeline(tl, blobs.current, { signal: abort.signal, height, onProgress: p => alive.current && setProgress(p) });
            if (alive.current) setResult({ url: URL.createObjectURL(blob), name: exportFileName(), size: blob.size });
        } catch (e) { if (alive.current && e.name !== 'AbortError') setNotice(e.message || 'Export failed.'); }
        finally { if (alive.current) setExporting(false); exportAbort.current = null; }
    }

    const empty = tl.video.length + tl.audio.length === 0;
    return <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer rounded-full border border-vx-border px-5 py-3 text-sm font-bold focus-within:outline focus-within:outline-2 focus-within:outline-vx-accent">
                Add files from this computer
                <input aria-label="Add files from this computer" className="sr-only" type="file" multiple accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" disabled={busy || exporting} onChange={chooseFiles} />
            </label>
            <Button variant="ghost" size="md" disabled={busy || exporting} onClick={openLibrary}>Add from my Library</Button>
            <Button variant="ghost" size="md" disabled={!history.past.length || exporting} onClick={undo}>Undo</Button>
            {busy && <span role="status" className="text-sm text-vx-fg-muted">Reading file…</span>}
        </div>
        {notice && <p role="alert" className="rounded-xl border border-vx-border bg-vx-panel p-3 text-sm">{notice}</p>}
        {library && <section aria-label="My Library" className="rounded-2xl border border-vx-border p-4">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold">My Library</h2><Button variant="ghost" size="sm" onClick={() => setLibrary(null)}>Close</Button></div>
            {library.length === 0 ? <p className="text-sm text-vx-fg-muted">Looking for videos and sounds you made…</p> : <ul className="grid gap-2 sm:grid-cols-2">
                {library.map(item => <li key={item.jobId}><button type="button" disabled={busy} className={`${field} w-full text-left`} onClick={() => addFromLibrary(item)}>{item.kind === 'video' ? 'Video' : 'Sound'}: {item.label}</button></li>)}
            </ul>}
        </section>}
        {libraryError && <p role="alert" className="text-sm">{libraryError}</p>}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
                <div className="overflow-hidden rounded-2xl border border-vx-border bg-black">
                    <canvas ref={canvas} width={1280} height={720} className="block aspect-video w-full" role="img" aria-label="Preview of the frame at the playhead" />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" disabled={empty || exporting} onClick={() => { if (!playing && frame >= total - 1) setFrame(0); setPlaying(p => !p); }}>{playing ? 'Pause' : 'Play'}</Button>
                    <span className="font-vx-mono text-sm" aria-live="off">{formatTime(frame)} / {formatTime(total)}</span>
                    <input aria-label="Playhead" className={`${range} mt-0 flex-1`} type="range" min={0} max={Math.max(total - 1, 0)} value={Math.min(frame, Math.max(total - 1, 0))} disabled={empty} onChange={e => { setPlaying(false); setFrame(Number(e.target.value)); }} />
                </div>
                {empty ? <p className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">Add a video to start. Up to {LIMITS.maxSeconds} seconds, {LIMITS.maxVideoClips} video clips and {LIMITS.maxAudioClips} sounds.</p>
                    : <TimelineView tl={tl} frame={frame} selected={clip} ppf={PPF} onSelect={s => { setSelected(s); }} onSeek={f => { setPlaying(false); setFrame(f); }} />}
            </div>

            <aside className="space-y-5 rounded-2xl border border-vx-border bg-vx-panel p-5" aria-label="Clip and export">
                {clip ? <div className="space-y-3">
                    <h2 className="text-sm font-bold">{media?.name} <span className="font-normal text-vx-fg-muted">({selected.track})</span></h2>
                    <p className="font-vx-mono text-xs text-vx-fg-muted">Starts {formatTime(layoutStart)} · lasts {formatTime(clip.len)}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => edit((t, k, id) => splitClip(t, k, id, frame))}>Split at playhead</Button>
                        <Button size="sm" variant="ghost" onClick={() => { edit((t, k, id) => pruneMedia(removeClip(t, k, id))); setSelected(null); }}>Delete</Button>
                    </div>
                    <label className="block text-sm font-bold">Start of the clip <span className="float-right font-vx-mono text-vx-fg-muted">{formatTime(clip.in)}</span>
                        <input className={range} type="range" min={0} max={Math.max(media.frames - 1, 0)} value={clip.in} onChange={e => { const n = Number(e.target.value); edit((t, k, id) => trimClip(t, k, id, { in: n, len: Math.max(1, Math.min(clip.len, media.frames - n)) })); }} /></label>
                    <label className="block text-sm font-bold">Length <span className="float-right font-vx-mono text-vx-fg-muted">{formatTime(clip.len)}</span>
                        <input className={range} type="range" min={1} max={Math.max(media.frames - clip.in, 1)} value={clip.len} onChange={e => { const n = Number(e.target.value); edit((t, k, id) => trimClip(t, k, id, { len: n })); }} /></label>
                    <label className="block text-sm font-bold">Volume <span className="float-right font-vx-mono text-vx-fg-muted">{Math.round(clip.volume * 100)}%</span>
                        <input className={range} type="range" min={0} max={100} value={Math.round(clip.volume * 100)} onChange={e => { const v = Number(e.target.value) / 100; edit((t, k, id) => setVolume(t, k, id, v)); }} /></label>
                    {selected.track === 'video' ? <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => { const i = tl.video.findIndex(c => c.id === clip.id); edit((t, _k, id) => moveVideoClip(t, id, i - 1)); }}>Move earlier</Button>
                        <Button size="sm" variant="ghost" onClick={() => { const i = tl.video.findIndex(c => c.id === clip.id); edit((t, _k, id) => moveVideoClip(t, id, i + 1)); }}>Move later</Button>
                    </div> : <Button size="sm" variant="ghost" onClick={() => edit((t, _k, id) => moveAudioClip(t, id, frame))}>Start at playhead</Button>}
                    {selected.track === 'video' && media?.hasAudio && <Button size="sm" variant="ghost" onClick={() => apply(t => addAudioClip(t, clip.mediaId, { start: layoutStart, in: clip.in, len: clip.len }))}>Use its sound on the sound track</Button>}
                </div> : <p className="text-sm text-vx-fg-muted">Select a clip on the timeline to trim, split, move or change its volume.</p>}

                <div className="space-y-3 border-t border-vx-border pt-5">
                    <label className="block text-sm font-bold">Size
                        <select className={`${field} mt-2 w-full`} value={height} onChange={e => setHeight(Number(e.target.value))} disabled={exporting}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
                    {blocker && <p role="status" className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-relaxed">{blocker}</p>}
                    <Button className="w-full justify-center" disabled={empty || exporting || Boolean(blocker)} onClick={runExport}>Export MP4</Button>
                    {exporting && <><progress aria-label="Export progress" className="w-full accent-vx-accent" value={progress} max={1} /><Button size="sm" variant="ghost" onClick={() => exportAbort.current?.abort()}>Cancel export</Button></>}
                    {result && <div role="status"><a className="break-words text-sm font-bold text-vx-accent underline" href={result.url} download={result.name}>Download {result.name} ({(result.size / 1048576).toFixed(1)} MiB)</a></div>}
                    <p className="text-xs leading-relaxed text-vx-fg-muted">Everything stays in this browser and uses no credits. Keep this tab open during export. Sound is mixed when you export; the preview is silent.</p>
                </div>
            </aside>
        </div>
    </div>;
}

export default function EditorPage() {
    const enabled = useEditorPreview();
    return <><AppNav active="editor" readAccount={false} /><Main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="mb-2 font-vx-mono text-xs tracking-widest text-vx-accent">PREVIEW</p><h1 className="mb-3 text-3xl font-black sm:text-4xl">Video editor</h1>
        {enabled ? <Editor /> : <section className="mt-6 rounded-2xl border border-vx-border p-8"><h2 className="text-lg font-bold">Preview unavailable</h2><p className="mt-2 text-sm text-vx-fg-muted">This editor is not switched on for your browser yet.</p></section>}
    </Main></>;
}
