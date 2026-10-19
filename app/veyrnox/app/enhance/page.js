'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { Button } from '../../_components/Button';
import { useVideoEnhancePreview } from '../../_lib/useVideoEnhancePreview';
import { VIDEO_LOOKS, validateVideo, downloadName } from '../../_lib/videoEnhance.mjs';
import { createSetupDeadline } from '../../_lib/videoEnhanceSetup.mjs';

const initialSettings = { smoothing: 30, look: 'natural', intensity: 100 };
const rangeStyle = 'mt-3 w-full accent-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent';

function Editor() {
  const { t, locale } = useI18n();
    const video = useRef(null), canvas = useRef(null), engine = useRef(null), alive = useRef(true), failed = useRef(false), sourceEpoch = useRef(0);
    const [source, setSource] = useState(null), [duration, setDuration] = useState(0);
    const [aspect, setAspect] = useState(16 / 9);
    const [exportWarning, setExportWarning] = useState('');
    const [settings, setSettings] = useState(initialSettings), [frame, setFrame] = useState({ time: 0, faces: 0, playing: false });
    const [state, setState] = useState('empty'), [error, setError] = useState(''), [result, setResult] = useState(null);
    const exporting = state === 'exporting';
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source, t]);
    useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
    useEffect(() => {
        if (!source) return;
        let instance;
        const element = video.current;
        const target = canvas.current;
        const deadline = createSetupDeadline(() => {
            element.removeEventListener('loadeddata', setup);
            element.pause();
            setError(t("app.enhance.timeout")); setState('error');
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
            } catch { if (!signal.aborted) { setError(t("app.enhance.trackerFailed")); setState('error'); } }
            finally { deadline.finish(); }
        }
        element.addEventListener('loadeddata', setup, { once: true });
        element.load();
        return () => {
            deadline.cancel(); element.removeEventListener('loadeddata', setup);
            instance?.close(); if (engine.current === instance) engine.current = null;
        };
    }, [source, t]);
    useEffect(() => { if (state === 'ready') engine.current?.setSettings(settings); }, [settings, state]);

    function choose(event) {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        const invalid = validateVideo(file);
        if (invalid) { setError(invalid); return; }
        sourceEpoch.current++;
        engine.current?.pause(); failed.current = false; setError(''); setResult(null); setDuration(0); setState('loading');
        setExportWarning('');
        setFrame({ time: 0, faces: 0, playing: false }); setSettings(initialSettings);
        setSource({ file, url: URL.createObjectURL(file) });
    }
    function update(next) { setResult(null); setSettings(previous => ({ ...previous, ...next })); }
    async function play() {
        const activeEngine = engine.current, element = video.current, epoch = sourceEpoch.current;
        const isCurrent = () => alive.current && sourceEpoch.current === epoch && !failed.current;
        try {
            if (element.paused) await activeEngine.play(); else activeEngine.pause();
            if (isCurrent()) setFrame(previous => ({ ...previous, playing: !element.paused }));
        } catch { if (isCurrent()) setError(t("app.enhance.playbackFailed")); }
    }
    function seek(seconds) {
        const epoch = sourceEpoch.current;
        engine.current?.pause();
        engine.current?.seek(seconds).catch(error => {
            if (alive.current && sourceEpoch.current === epoch && !failed.current && error.name !== 'AbortError') setError(error.message);
        });
        setFrame(previous => ({ ...previous, playing: false }));
    }
    async function exportVideo() {
        if (exportWarning || state !== 'ready') return;
        const exportingEngine = engine.current;
        const epoch = sourceEpoch.current;
        const isCurrent = () => alive.current && sourceEpoch.current === epoch && engine.current === exportingEngine;
        setError(''); setResult(null); setState('exporting');
        try {
            const blob = await exportingEngine.export(source.file);
            if (isCurrent() && !failed.current) setResult({ url: URL.createObjectURL(blob), name: downloadName(source.file.name, blob.type), type: blob.type });
        } catch (e) { if (isCurrent()) setError(e.message); }
        finally { if (isCurrent()) { setState(failed.current ? 'error' : 'ready'); setFrame(previous => ({ ...previous, playing: false })); } }
    }
    return <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm leading-relaxed text-vx-fg-body">{t("app.enhance.intro")}</p>
            <label className={`inline-flex shrink-0 cursor-pointer rounded-full border border-vx-border px-5 py-3 text-sm font-bold focus-within:outline focus-within:outline-2 focus-within:outline-vx-accent ${exporting ? 'opacity-40' : ''}`}>
                {source ? t("app.enhance.chooseAnother") : t("label.Choose video")}<input data-testid="enhance-upload" aria-label={t("label.Choose video")} className="sr-only" type="file" accept="video/mp4,video/webm,video/quicktime" disabled={exporting} onChange={choose} />
            </label>
        </div>
        {error && <p role="alert" className="mb-5 rounded-xl border border-vx-danger p-4 text-sm">{error}</p>}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section aria-label={t("app.enhance.comparison")} className="min-w-0 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
                <div className="flex items-center justify-between gap-3 border-b border-vx-border px-5 py-4 text-xs text-vx-fg-muted"><span className="min-w-0 truncate">{source ? source.file.name : t("app.enhance.empty")}</span><span className="shrink-0">{duration && source ? `${duration.toLocaleString(localeTag(locale, 'en-US'), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}s` : t("app.enhance.limit")}</span></div>
                {!source ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center"><span aria-hidden="true" className="text-4xl text-vx-accent">▷</span><h2 className="text-xl font-bold">{t("app.enhance.natural")}</h2><p className="max-w-sm text-sm leading-relaxed text-vx-fg-muted">{t("app.enhance.requirements")}</p></div>
                    : <div className="grid gap-px bg-vx-border sm:grid-cols-2">
                        <figure className="min-w-0 bg-vx-base p-3"><figcaption className="mb-2 text-xs font-bold text-vx-fg-muted">{t("app.enhance.original")}</figcaption><video key={source.url} ref={video} src={source.url} playsInline preload="auto" style={{ aspectRatio: aspect }} className="max-h-[460px] w-full bg-black object-contain" onError={() => { failed.current = true; setError(t("app.enhance.decodeFailed")); setState('error'); }} onEnded={() => setFrame(previous => ({ ...previous, playing: false }))} /></figure>
                        <figure className="min-w-0 bg-vx-base p-3"><figcaption className="mb-2 text-xs font-bold text-vx-accent">{t("app.enhance.enhanced")}</figcaption><canvas key={source.url} ref={canvas} aria-label={t("app.enhance.preview")} style={{ aspectRatio: aspect }} className="max-h-[460px] w-full bg-black object-contain" /></figure>
                    </div>}
                {source && <div className="space-y-3 border-t border-vx-border p-4">
                    <label className="block text-xs text-vx-fg-muted">{t("app.enhance.position")}{' '}<span className="float-end">{frame.time.toLocaleString(localeTag(locale, 'en-US'), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} / {duration.toLocaleString(localeTag(locale, 'en-US'), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}s</span>
                        <input className={rangeStyle} type="range" min="0" max={duration || 1} step="0.01" value={Math.min(frame.time,duration)} disabled={state !== 'ready'} onChange={event => seek(Number(event.target.value))} />
                    </label>
                    <Button size="sm" variant="ghost" disabled={state !== 'ready'} onClick={play}>{frame.playing ? t("cinema.videoUpload.pause") : t("app.enhance.play")}</Button>
                    <p role="status" className="text-xs leading-relaxed text-vx-fg-muted">{state === 'error' ? t("app.enhance.stopped") : state === 'loading' ? t("app.enhance.preparing") : settings.smoothing === 0 ? t("app.enhance.smoothingOff") : frame.faces === 1 ? t("app.enhance.oneFace") : frame.faces > 1 ? t("app.enhance.multipleFaces") : t("app.enhance.noFace")}</p>
                </div>}
            </section>
            <aside data-assistant-target="enhance.adjustments" aria-label={t("app.enhance.adjustments")} className="space-y-6 rounded-2xl border border-vx-border p-5">
                <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{t("app.enhance.adjustments")}</h2><button type="button" className="text-xs text-vx-accent underline disabled:opacity-40" disabled={state !== 'ready'} onClick={() => update(initialSettings)}>{t("app.enhance.reset")}</button></div>
                <label className="block text-sm font-bold">{t("app.enhance.smoothing")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{settings.smoothing.toLocaleString(localeTag(locale, 'en-US'))}%</span><input className={rangeStyle} type="range" min="0" max="100" value={settings.smoothing} disabled={state !== 'ready'} onChange={event => update({ smoothing: Number(event.target.value) })} /></label>
                <p className="text-xs leading-relaxed text-vx-fg-muted">{t("app.enhance.smoothingHelp")}</p>
                <fieldset disabled={state !== 'ready'}><legend className="mb-3 text-sm font-bold">{t("app.enhance.look")}</legend><div className="grid grid-cols-2 gap-2">{VIDEO_LOOKS.map(look => <button type="button" key={look.id} aria-pressed={settings.look === look.id} onClick={() => update({ look: look.id })} className={`rounded-xl border px-3 py-3 text-xs font-bold disabled:opacity-40 ${settings.look === look.id ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}>{tOr(t, `app.enhance.look.${look.id}`, look.label)}</button>)}</div></fieldset>
                <label className="block text-sm font-bold">{t("app.enhance.intensity")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{settings.intensity.toLocaleString(localeTag(locale, 'en-US'))}%</span><input className={rangeStyle} type="range" min="0" max="100" value={settings.intensity} disabled={state !== 'ready' || settings.look === 'natural'} onChange={event => update({ intensity: Number(event.target.value) })} /></label>
                <div className="space-y-3 border-t border-vx-border pt-5">
                    {exportWarning && <p id="export-warning" role="status" className="rounded-xl border border-vx-border bg-vx-panel p-3 text-xs leading-relaxed text-vx-fg-body"><strong className="block mb-1">{t("app.enhance.previewOnly")}</strong>{exportWarning}{' '}{t("app.enhance.previewHelp")}</p>}
                    <Button data-testid="enhance-export" className="w-full justify-center" aria-describedby={exportWarning ? 'export-warning' : undefined} disabled={state !== 'ready' || Boolean(exportWarning)} onClick={exportVideo}>{exporting ? t("app.enhance.exporting") : exportWarning ? t("app.enhance.exportUnavailable") : t("app.editor.workspace.exportVideo")}</Button>
                    {exporting && <><progress aria-label={t("app.editor.legacy.exportProgress")} className="w-full accent-vx-accent" value={frame.time} max={duration} /><Button variant="ghost" size="sm" onClick={() => engine.current?.cancel()}>{t("app.editor.legacy.cancelExport")}</Button></>}
                    <p className="text-xs leading-relaxed text-vx-fg-muted">{t("app.enhance.exportHelp")}</p>
                    {result && <div role="status"><a className="inline-block break-words text-sm font-bold text-vx-accent underline" href={result.url} download={result.name}>{t("label.Download")}{' '}{result.type.startsWith('video/mp4') ? t("app.enhance.format.mp4") : t("app.enhance.format.webm")}</a><p className="mt-2 text-xs text-vx-fg-muted">{t("app.enhance.localDownload")}</p></div>}
                </div>
            </aside>
        </div>
    </>;
}

export default function VideoEnhance() {
  const { t } = useI18n();
    const enabled = useVideoEnhancePreview();
    return <><AppNav active="enhance" readAccount={false} /><Main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="mb-2 font-vx-mono text-xs tracking-widest text-vx-accent">{t("app.enhance.localPreview")}</p><h1 data-testid="enhance-title" className="mb-3 text-3xl font-black sm:text-4xl">{t("app.enhance.title")}</h1>
        {enabled ? <Editor /> : <section className="mt-6 rounded-2xl border border-vx-border p-8"><h2 data-testid="enhance-unavailable" className="text-lg font-bold">{t("app.enhance.unavailable")}</h2><p data-testid="enhance-local-only" className="mt-2 text-sm text-vx-fg-muted">{t("app.enhance.localOnly")}</p>{process.env.NODE_ENV === 'development' && <Button className="mt-5 me-5" onClick={() => { try { localStorage.setItem('veyrnox_video_enhance', '1'); window.dispatchEvent(new Event('storage')); } catch { /* Storage unavailable: keep the preview closed. */ } }}>{t("app.enhance.enable")}</Button>}<Link className="mt-5 inline-block text-vx-accent underline" href="/app">{t("app.projects.backExplore")}</Link></section>}
    </Main></>;
}
