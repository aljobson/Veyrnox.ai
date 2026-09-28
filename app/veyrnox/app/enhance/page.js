'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Button } from '../../_components/Button';
import { useVideoEnhancePreview } from '../../_lib/useVideoEnhancePreview';
import { VIDEO_LOOKS, validateVideo, downloadName } from '../../_lib/videoEnhance.mjs';
import { createSetupDeadline } from '../../_lib/videoEnhanceSetup.mjs';

const initialSettings = { smoothing: 30, look: 'natural', intensity: 100 };
const rangeStyle = 'mt-3 w-full accent-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent';

function Editor() {
    const video = useRef(null), canvas = useRef(null), engine = useRef(null), alive = useRef(true), failed = useRef(false);
    const [source, setSource] = useState(null), [duration, setDuration] = useState(0);
    const [aspect, setAspect] = useState(16 / 9);
    const [exportWarning, setExportWarning] = useState('');
    const [settings, setSettings] = useState(initialSettings), [frame, setFrame] = useState({ time: 0, faces: 0, playing: false });
    const [state, setState] = useState('empty'), [error, setError] = useState(''), [result, setResult] = useState(null);
    const exporting = state === 'exporting';
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
    useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
    useEffect(() => {
        if (!source) return;
        let instance;
        const element = video.current;
        const target = canvas.current;
        const deadline = createSetupDeadline(() => {
            element.removeEventListener('loadeddata', setup);
            element.pause();
            setError('Video setup timed out. Choose the video again to retry, or try another clip.'); setState('error');
        });
        const { signal } = deadline;
        async function setup() {
            if (signal.aborted) return;
            const invalid = validateVideo(source.file, { duration: element.duration, width: element.videoWidth, height: element.videoHeight });
            if (invalid) { deadline.finish(); setError(invalid); setState('error'); return; }
            setDuration(element.duration);
            setAspect(element.videoWidth / element.videoHeight);
            try {
                const { inspectVideoExport } = await import('../../_lib/videoEnhanceExport.mjs');
                if (signal.aborted) return;
                const warning = await inspectVideoExport(source.file, signal);
                if (signal.aborted) return;
                setExportWarning(warning || '');
                const { createVideoEnhanceEngine } = await import('../../_lib/videoEnhanceEngine');
                if (signal.aborted) return;
                instance = await createVideoEnhanceEngine(element, target,
                    next => { if (!signal.aborted) setFrame(next); },
                    message => { if (!signal.aborted) { failed.current = true; setError(message); setState('error'); } }, signal);
                if (signal.aborted) { instance.close(); instance = undefined; return; }
                engine.current = instance; setState(failed.current ? 'error' : 'ready');
            } catch { if (!signal.aborted) { setError('The face tracker could not load. Prepare the local preview assets and reload, or try desktop Chrome.'); setState('error'); } }
            finally { deadline.finish(); }
        }
        element.addEventListener('loadeddata', setup, { once: true });
        element.load();
        return () => {
            deadline.cancel(); element.removeEventListener('loadeddata', setup);
            instance?.close(); if (engine.current === instance) engine.current = null;
        };
    }, [source]);
    useEffect(() => { if (state === 'ready') engine.current?.setSettings(settings); }, [settings, state]);

    function choose(event) {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        const invalid = validateVideo(file);
        if (invalid) { setError(invalid); return; }
        engine.current?.pause(); failed.current = false; setError(''); setResult(null); setDuration(0); setState('loading');
        setExportWarning('');
        setFrame({ time: 0, faces: 0, playing: false }); setSettings(initialSettings);
        setSource({ file, url: URL.createObjectURL(file) });
    }
    function update(next) { setResult(null); setSettings(previous => ({ ...previous, ...next })); }
    async function play() {
        try {
            if (video.current.paused) await engine.current.play(); else engine.current.pause();
            setFrame(previous => ({ ...previous, playing: !video.current.paused }));
        } catch { setError('Playback could not start. Try a different clip.'); }
    }
    async function exportVideo() {
        if (exportWarning || state !== 'ready') return;
        setError(''); setResult(null); setState('exporting');
        try {
            const blob = await engine.current.export(source.file);
            if (alive.current) setResult({ url: URL.createObjectURL(blob), name: downloadName(source.file.name, blob.type), type: blob.type });
        } catch (e) { if (alive.current) setError(e.message); }
        finally { if (alive.current) { setState(failed.current ? 'error' : 'ready'); setFrame(previous => ({ ...previous, playing: false })); } }
    }
    return <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm leading-relaxed text-vx-fg-body">Choose a short clip, adjust the look, and download a copy. Your video stays in this browser. This experimental preview uses no credits.</p>
            <label className={`inline-flex shrink-0 cursor-pointer rounded-full border border-vx-border px-5 py-3 text-sm font-bold focus-within:outline focus-within:outline-2 focus-within:outline-vx-accent ${exporting ? 'opacity-40' : ''}`}>
                {source ? 'Choose another video' : 'Choose video'}<input aria-label="Choose video" className="sr-only" type="file" accept="video/mp4,video/webm,video/quicktime" disabled={exporting} onChange={choose} />
            </label>
        </div>
        {error && <p role="alert" className="mb-5 rounded-xl border border-vx-danger p-4 text-sm">{error}</p>}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section aria-label="Video comparison" className="min-w-0 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
                <div className="flex items-center justify-between gap-3 border-b border-vx-border px-5 py-4 text-xs text-vx-fg-muted"><span className="min-w-0 truncate">{source ? source.file.name : 'Your next edit starts here'}</span><span className="shrink-0">{duration && source ? `${duration.toFixed(1)}s` : 'UP TO 15 SECONDS'}</span></div>
                {!source ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center"><span aria-hidden="true" className="text-4xl text-vx-accent">▷</span><h2 className="text-xl font-bold">A natural finish. Still you.</h2><p className="max-w-sm text-sm leading-relaxed text-vx-fg-muted">Start with a single-person clip. MP4, WebM or MOV, up to 100 MiB and a longest edge of 1920 pixels.</p></div>
                    : <div className="grid gap-px bg-vx-border sm:grid-cols-2">
                        <figure className="min-w-0 bg-vx-base p-3"><figcaption className="mb-2 text-xs font-bold text-vx-fg-muted">ORIGINAL</figcaption><video key={source.url} ref={video} src={source.url} playsInline preload="auto" style={{ aspectRatio: aspect }} className="max-h-[460px] w-full bg-black object-contain" onError={() => { failed.current = true; setError('This browser could not decode that video. Try an MP4 clip.'); setState('error'); }} onEnded={() => setFrame(previous => ({ ...previous, playing: false }))} /></figure>
                        <figure className="min-w-0 bg-vx-base p-3"><figcaption className="mb-2 text-xs font-bold text-vx-accent">ENHANCED</figcaption><canvas key={source.url} ref={canvas} aria-label="Enhanced video preview" style={{ aspectRatio: aspect }} className="max-h-[460px] w-full bg-black object-contain" /></figure>
                    </div>}
                {source && <div className="space-y-3 border-t border-vx-border p-4">
                    <label className="block text-xs text-vx-fg-muted">Playback position <span className="float-right">{frame.time.toFixed(1)} / {duration.toFixed(1)}s</span>
                        <input className={rangeStyle} type="range" min="0" max={duration || 1} step="0.01" value={Math.min(frame.time,duration)} disabled={state !== 'ready'} onChange={event => { engine.current?.pause(); engine.current?.seek(Number(event.target.value)).catch(e => setError(e.message)); setFrame(previous => ({ ...previous, playing: false })); }} />
                    </label>
                    <Button size="sm" variant="ghost" disabled={state !== 'ready'} onClick={play}>{frame.playing ? 'Pause' : 'Play comparison'}</Button>
                    <p role="status" className="text-xs leading-relaxed text-vx-fg-muted">{state === 'loading' ? 'Preparing face tracking…' : settings.smoothing === 0 ? 'Skin smoothing is off.' : frame.faces === 1 ? 'One face tracked. Smoothing is applied to the face region.' : frame.faces > 1 ? 'Multiple faces detected. Smoothing is paused; colour settings still apply.' : 'No face tracked. Smoothing is paused; colour settings still apply.'}</p>
                </div>}
            </section>
            <aside aria-label="Adjustments" className="space-y-6 rounded-2xl border border-vx-border p-5">
                <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Adjustments</h2><button type="button" className="text-xs text-vx-accent underline disabled:opacity-40" disabled={state !== 'ready'} onClick={() => update(initialSettings)}>Reset</button></div>
                <label className="block text-sm font-bold">Skin smoothing <span className="float-right font-vx-mono text-vx-fg-muted">{settings.smoothing}%</span><input className={rangeStyle} type="range" min="0" max="100" value={settings.smoothing} disabled={state !== 'ready'} onChange={event => update({ smoothing: Number(event.target.value) })} /></label>
                <p className="text-xs leading-relaxed text-vx-fg-muted">Start low to retain texture. Smoothing can also affect hands or hair covering the face. Turn it off for those clips, and check eyes and head turns before keeping your export.</p>
                <fieldset disabled={state !== 'ready'}><legend className="mb-3 text-sm font-bold">Colour look</legend><div className="grid grid-cols-2 gap-2">{VIDEO_LOOKS.map(look => <button type="button" key={look.id} aria-pressed={settings.look === look.id} onClick={() => update({ look: look.id })} className={`rounded-xl border px-3 py-3 text-xs font-bold disabled:opacity-40 ${settings.look === look.id ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}>{look.label}</button>)}</div></fieldset>
                <label className="block text-sm font-bold">Look intensity <span className="float-right font-vx-mono text-vx-fg-muted">{settings.intensity}%</span><input className={rangeStyle} type="range" min="0" max="100" value={settings.intensity} disabled={state !== 'ready' || settings.look === 'natural'} onChange={event => update({ intensity: Number(event.target.value) })} /></label>
                <div className="space-y-3 border-t border-vx-border pt-5">
                    {exportWarning && <p id="export-warning" role="status" className="rounded-xl border border-vx-border bg-vx-panel p-3 text-xs leading-relaxed text-vx-fg-body"><strong className="block mb-1">Preview only</strong>{exportWarning} You can still preview and adjust this clip.</p>}
                    <Button className="w-full justify-center" aria-describedby={exportWarning ? 'export-warning' : undefined} disabled={state !== 'ready' || Boolean(exportWarning)} onClick={exportVideo}>{exporting ? 'Exporting…' : exportWarning ? 'Export unavailable' : 'Export video'}</Button>
                    {exporting && <><progress aria-label="Export progress" className="w-full accent-vx-accent" value={frame.time} max={duration} /><Button variant="ghost" size="sm" onClick={() => engine.current?.cancel()}>Cancel export</Button></>}
                    <p className="text-xs leading-relaxed text-vx-fg-muted">Keep this tab visible during export. Export supports MP4 input with one video track and up to one AAC audio track. Subtitles and descriptive metadata are not included. Output is H.264 MP4 when this browser supports it.</p>
                    {result && <div role="status"><a className="inline-block break-words text-sm font-bold text-vx-accent underline" href={result.url} download={result.name}>Download {result.type.startsWith('video/mp4') ? 'MP4' : 'WebM'}</a><p className="mt-2 text-xs text-vx-fg-muted">Saved locally when downloaded. Not added to Library.</p></div>}
                </div>
            </aside>
        </div>
    </>;
}

export default function VideoEnhance() {
    const enabled = useVideoEnhancePreview();
    return <><AppNav active="enhance" readAccount={false} /><main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="mb-2 font-vx-mono text-xs tracking-widest text-vx-accent">LOCAL PREVIEW</p><h1 className="mb-3 text-3xl font-black sm:text-4xl">Video Enhance</h1>
        {enabled ? <Editor /> : <section className="mt-6 rounded-2xl border border-vx-border p-8"><h2 className="text-lg font-bold">Preview unavailable</h2><p className="mt-2 text-sm text-vx-fg-muted">Video Enhance is available only in an enabled local development preview.</p>{process.env.NODE_ENV === 'development' && <Button className="mt-5 mr-5" onClick={() => { try { localStorage.setItem('veyrnox_video_enhance', '1'); window.dispatchEvent(new Event('storage')); } catch { /* Storage unavailable: keep the preview closed. */ } }}>Enable local preview</Button>}<Link className="mt-5 inline-block text-vx-accent underline" href="/app">Back to Explore</Link></section>}
    </main></>;
}
