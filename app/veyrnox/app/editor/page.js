'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { Button } from '../../_components/Button';
import { TimelineView } from '../../_components/editor/TimelineView';
import { ProjectBar } from '../../_components/editor/ProjectBar';
import { MultitrackWorkspace } from '../../_components/editor/MultitrackWorkspace';
import { EditorCreditsDialog } from '../../_components/editor/EditorCreditsDialog';
import { useMultitrackEnabled } from '../../_components/editor/MultitrackFlag';
import { MediaBin } from '../../_components/editor/MediaBin';
import { importMedia, insertMedia, duplicateSelection, detachAudio, splitSelection, trimEdge, stepFrame, initialText, removeMedia } from '../../_lib/editorCommands.mjs';
import { createHistory, commitHistory, undoHistory, redoHistory, retainedMedia } from '../../_lib/editorHistory.mjs';
import { createAudioPlayer } from '../../_lib/editorPlayback.mjs';
import { gatewayFetch } from '../../_lib/gateway';
import {
    FPS, LIMITS, emptyTimeline, trimClip, removeClip, setVolume, moveVideoClip,
    moveAudioClip, totalFrames, videoLayout, formatTime as sourceTime, MAX_FRAMES, MAX_TRANSITION, ASPECTS, setAspect, setTransition,
    effectiveTransition, addText, updateText, removeText,
} from '../../_lib/editorTimeline.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
import { checkLocalFile, probeMedia, checkProbe, mediaFromProbe, libraryMediaId, localMediaId } from '../../_lib/editorMedia.mjs';
import { listLibraryMedia, loadLibraryBlob } from '../../_lib/editorLibrary.mjs';
import { createPreviewer } from '../../_lib/editorPreview.mjs';
import { exportBlocker, exportTimeline, exportFileName } from '../../_lib/editorExport.mjs';

const field = 'rounded-xl border border-vx-border bg-vx-base px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
const range = 'mt-2 w-full accent-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent';

function Editor() {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));
  const formatTime = value => locale === 'en' ? sourceTime(value) : sourceTime(value).replace(/\d+/g, digits => Number(digits).toLocaleString(localeTag(locale), { useGrouping: false, minimumIntegerDigits: digits.length }));
    const canvas = useRef(null), blobs = useRef(new Map()), previewer = useRef(null), exportAbort = useRef(null), alive = useRef(true);
    const [history, setHistory] = useState(() => createHistory(emptyTimeline()));
    const historyRef = useRef(history), player = useRef(null), playRequest = useRef(0);
    const [ppf, setPpf] = useState(2), [preparing, setPreparing] = useState(false);
    const tl = history.now;
    const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [selected, setSelected] = useState(null);
    const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const [library, setLibrary] = useState(null), [libraryError, setLibraryError] = useState('');
    const [blocker, setBlocker] = useState(''), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
    const [result, setResult] = useState(null), [height, setHeight] = useState(720);
    const [draft, setDraft] = useState({ forId: null, base: '', value: '' }); // the words being typed for one text item, until committed
    const [tick, setTick] = useState(0); // bumped when a reopened project's files arrive, so the preview repaints
    const total = totalFrames(tl);
    const size = useMemo(() => timelineSize(tl, 720), [tl]);
    // A project opened (or a version restored) replaces the timeline; undo history starts again from there.
    const replaceHistory = useCallback(next => { historyRef.current = next; setHistory(next); }, []);
    const pause = useCallback(() => { playRequest.current++; player.current?.stop(); setPlaying(false); setPreparing(false); }, []);
    const loadTimeline = useCallback(next => { exportAbort.current?.abort(); pause(); previewer.current?.dispose(); previewer.current = null; replaceHistory(createHistory(next)); setSelected(null); setFrame(0); setResult(null); }, [pause, replaceHistory]);
    const relinked = useCallback(() => { pause(); previewer.current?.dispose(); previewer.current = null; setTick(timeline => timeline + 1); }, [pause]);

    useEffect(() => { alive.current = true; return () => { alive.current = false; exportAbort.current?.abort(); }; }, []);
    useEffect(() => { exportBlocker().then(text => alive.current && setBlocker(text || '')); }, []);
    useEffect(() => () => { previewer.current?.dispose(); previewer.current = null; player.current?.dispose(); player.current = null; }, []);
    useEffect(() => {
        const keep = retainedMedia(history);
        for (const id of blobs.current.keys()) if (!keep.has(id)) blobs.current.delete(id);
        previewer.current?.retain(keep);
    }, [history]);
    useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

    // Apply an edit. A model refusal ({ error }) is shown and nothing changes; a success is one undo step.
    const apply = useCallback(fn => {
        const next = fn(historyRef.current.now);
        if (next?.error) { setNotice(next.error); return null; }
        pause(); setNotice(''); setResult(null);
        replaceHistory(commitHistory(historyRef.current, next));
        return next;
    }, [pause, replaceHistory]);
    const travel = operation => {
        const next = operation(historyRef.current);
        pause(); setResult(null); setNotice(''); replaceHistory(next);
        setSelected(current => current && next.now[current.track]?.some(item => item.id === current.id) ? current : null);
    };
    const undo = () => travel(undoHistory);
    const redo = () => travel(redoHistory);
    const duplicate = () => { const next = apply(timeline => duplicateSelection(timeline, selected)); if (next) setSelected({ track: selected.track, id: `${selected.track[0]}${next.seq}` }); };

    // Draw the frame under the playhead. A new previewer is made whenever files change, so decoders never outlive their blobs.
    useEffect(() => {
        if (!canvas.current) return;
        if (!previewer.current) previewer.current = createPreviewer(blobs.current);
        previewer.current.draw(tl, Math.min(frame, Math.max(total - 1, 0)), canvas.current).catch(() => {});
    }, [tl, frame, total, tick]);

    useEffect(() => {
        if (!playing) return undefined;
        let raf = 0;
        const tick = () => {
            const next = player.current.frame();
            setFrame(Math.min(next, Math.max(total - 1, 0)));
            if (next >= total) { pause(); return; }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing, total, pause]);

    async function togglePlayback() {
        if (playing || preparing) { pause(); return; }
        player.current ||= createAudioPlayer();
        const ticket = ++playRequest.current;
        const start = frame >= total - 1 ? 0 : frame;
        setFrame(start); setPreparing(true); setNotice('');
        try { if (await player.current.start(tl, blobs.current, start) && alive.current && ticket === playRequest.current) setPlaying(true); }
        catch (error) { if (alive.current && ticket === playRequest.current && error.name !== 'AbortError') setNotice(error.message || t("app.editor.legacy.playbackFailed")); }
        finally { if (alive.current && ticket === playRequest.current) setPreparing(false); }
    }

    async function ingest(id, name, blob) {
        const probe = await probeMedia(blob);
        const bad = checkProbe(probe);
        if (bad) throw new Error(bad);
        const media = mediaFromProbe(id, name, probe);
        const next = apply(timeline => importMedia(timeline, media));
        if (!next) return;
        blobs.current.set(id, blob); setTick(timeline => timeline + 1);
        const inserted = [...next.video, ...next.audio].filter(x => x.mediaId === id).at(-1);
        if (!inserted) setNotice(t("app.editor.legacy.imported"));
        else if (inserted.len < media.frames) setNotice(t('app.editor.legacy.importedPart',{time:formatTime(inserted.len)}));
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
        catch { if (alive.current) { setLibrary(null); setLibraryError(t("app.editor.legacy.libraryFailed")); } }
    }
    async function addFromLibrary(item) {
        setBusy(true); setNotice('');
        try { const { blob } = await loadLibraryBlob(gatewayFetch, item.jobId); await ingest(libraryMediaId(item.jobId), item.label, blob); }
        catch (e) { setNotice(e.message); }
        if (alive.current) setBusy(false);
    }

    const clip = selected && selected.track !== 'text' ? tl[selected.track].find(c => c.id === selected.id) : null;
    const textItem = selected?.track === 'text' ? tl.text.find(x => x.id === selected.id) : null;
    const videoIndex = selected?.track === 'video' ? tl.video.findIndex(c => c.id === selected.id) : -1;
    // The draft counts only while it belongs to this item and the item has not changed under it; otherwise the input shows the item.
    const draftValue = textItem && draft.forId === textItem.id && draft.base === textItem.text ? draft.value : (textItem?.text ?? '');
    const commitDraft = () => {
        const current = textItem && historyRef.current.now.text.find(item => item.id === textItem.id);
        if (current && draftValue.trim() !== current.text) return apply(timeline => updateText(timeline, current.id, { text: draftValue }));
    };
    const media = clip ? tl.media[clip.mediaId] : null;
    const layoutStart = clip && selected.track === 'video' ? videoLayout(tl).find(l => l.clip.id === clip.id)?.start : clip?.start;
    const edit = fn => selected && apply(timeline => fn(timeline, selected.track, selected.id));

    async function runExport() {
        if (commitDraft() === null) return;
        const exportTimelineSnapshot = historyRef.current.now;
        const abort = new AbortController(); exportAbort.current = abort;
        pause(); setNotice(''); setResult(null); setProgress(0); setExporting(true);
        try {
            const blob = await exportTimeline(exportTimelineSnapshot, blobs.current, { signal: abort.signal, height, onProgress: p => alive.current && setProgress(p.total > 0 ? p.done / p.total : 0) });
            if (alive.current) setResult({ url: URL.createObjectURL(blob), name: exportFileName(), size: blob.size });
        } catch (e) { if (alive.current && e.name !== 'AbortError') setNotice(e.message || t("app.editor.workspace.exportFailed")); }
        finally { if (alive.current) setExporting(false); exportAbort.current = null; }
    }

    const empty = tl.video.length + tl.audio.length + tl.text.length === 0;
    const seek = f => { pause(); setFrame(Math.max(0, Math.min(f, Math.max(total - 1, 0)))); };
    const deleteSelected = () => { if (!selected) return; apply(timeline => selected.track === 'text' ? removeText(timeline, selected.id) : removeClip(timeline, selected.track, selected.id)); setSelected(null); };
    function keyboard(event) {
        if (exporting || busy || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const key = event.key.toLowerCase(), mod = event.metaKey || event.ctrlKey;
        if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
        else if (mod && key === 'd' && selected) { event.preventDefault(); duplicate(); }
        else if (!mod && !event.altKey) {
            if (key === ' ' && !empty && !event.target.closest('button, a')) { event.preventDefault(); void togglePlayback(); }
            else if (key === 's' && selected) { event.preventDefault(); apply(timeline => splitSelection(timeline, selected, frame)); }
            else if (['delete', 'backspace'].includes(key) && selected) { event.preventDefault(); deleteSelected(); }
            else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); seek(stepFrame(frame, (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? FPS : 1), total)); }
            else if (key === 'home' || key === 'end') { event.preventDefault(); seek(key === 'home' ? 0 : total - 1); }
        }
    }
    return <div className="space-y-6 outline-none" role="region" data-testid="editor-legacy" aria-label={t("app.editor.legacy.workspace")} tabIndex={0} onKeyDown={keyboard}>
        <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer rounded-full border border-vx-border px-5 py-3 text-sm font-bold focus-within:outline focus-within:outline-2 focus-within:outline-vx-accent">
                {t("app.editor.legacy.addFiles")}<input aria-label={t("app.editor.legacy.addFiles")} className="sr-only" type="file" multiple accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" disabled={busy || exporting} onChange={chooseFiles} />
            </label>
            <Button variant="ghost" size="md" disabled={busy || exporting} onClick={openLibrary}>{t("app.editor.legacy.addLibrary")}</Button>
            <Button variant="ghost" size="md" disabled={exporting} onClick={() => { const next = apply(timeline => addText(timeline, initialText(frame))); if (next) setSelected({ track: 'text', id: `t${next.seq}` }); }}>{t("app.editor.workspace.addText")}</Button>
            <Button variant="ghost" size="md" disabled={!history.past.length || exporting} onClick={undo}>{t("app.editor.workspace.undo")}</Button>
            <Button variant="ghost" size="md" disabled={!history.future.length || exporting} onClick={redo}>{t("app.editor.workspace.redo")}</Button>
            <Button variant="ghost" size="md" disabled={!selected || exporting} onClick={duplicate}>{t("app.editor.workspace.duplicate")}</Button>
            {busy && <span role="status" className="text-sm text-vx-fg-muted">{t("app.editor.legacy.reading")}</span>}
        </div>
        {notice && <p role="alert" className="rounded-xl border border-vx-border bg-vx-panel p-3 text-sm">{notice}</p>}
        <ProjectBar tl={tl} blobs={blobs} onLoadTimeline={loadTimeline} onRelinked={relinked} />
        {library && <section aria-label={t("app.editor.legacy.myLibrary")} className="rounded-2xl border border-vx-border p-4">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold">{t("app.editor.legacy.myLibrary")}</h2><Button variant="ghost" size="sm" onClick={() => setLibrary(null)}>{t("app.editor.workspace.close")}</Button></div>
            {library.length === 0 ? <p className="text-sm text-vx-fg-muted">{t("app.editor.legacy.finding")}</p> : <ul className="grid gap-2 sm:grid-cols-2">
                {library.map(item => <li key={item.jobId}><button type="button" disabled={busy} className={`${field} w-full text-start`} onClick={() => addFromLibrary(item)}>{item.kind === 'video' ? t("app.library.kind.video") : t("app.editor.legacy.sound")}: {item.label}</button></li>)}
            </ul>}
        </section>}
        {libraryError && <p role="alert" className="text-sm">{libraryError}</p>}
        <MediaBin tl={tl} disabled={busy || exporting} onAdd={id => apply(timeline => insertMedia(timeline, id))} onRemove={id => { apply(timeline => removeMedia(timeline, id)); setSelected(null); }} />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
                <div className="overflow-hidden rounded-2xl border border-vx-border bg-black">
                    <canvas ref={canvas} width={size.width} height={size.height} className="mx-auto block h-auto max-h-[60vh] w-auto max-w-full" role="img" aria-label={t("app.editor.legacy.preview")} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" disabled={empty || exporting} onClick={togglePlayback}>{playing || preparing ? t("cinema.videoUpload.pause") : t("cinema.titlePage.play")}</Button>
                    {preparing && <span role="status" className="text-xs text-vx-fg-muted">{t("cinema.player.preparingPlayback")}</span>}
                    <span className="font-vx-mono text-sm" aria-live="off">{formatTime(frame)} / {formatTime(total)}</span>
                    <input aria-label={t("app.editor.legacy.playhead")} className={`${range} mt-0 flex-1`} type="range" min={0} max={Math.max(total - 1, 0)} value={Math.min(frame, Math.max(total - 1, 0))} disabled={empty} onChange={e => seek(Number(e.target.value))} />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-vx-fg-muted">
                    <label className="flex items-center gap-2">{t("app.editor.workspace.zoom")}{' '}<input aria-label={t("app.editor.workspace.zoom")} className="accent-vx-accent" type="range" min={0.5} max={8} step={0.5} value={ppf} onChange={e => setPpf(Number(e.target.value))} /></label>
                    <span>{t("app.editor.legacy.shortcuts")}</span>
                </div>
                {empty ? <p className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">{t('app.editor.legacy.empty',{seconds:number(LIMITS.maxSeconds),videos:number(LIMITS.maxVideoClips),audio:number(LIMITS.maxAudioClips)})}</p>
                    : <TimelineView tl={tl} frame={frame} selected={clip || textItem} ppf={ppf} disabled={exporting} onSelect={s => { setSelected(s); }} onSeek={seek}
                        onTrim={(track, id, edge, delta) => apply(timeline => trimEdge(timeline, track, id, edge, delta))}
                        onMove={(track, id, to) => apply(timeline => track === 'video' ? moveVideoClip(timeline, id, to) : track === 'text' ? updateText(timeline, id, { start: to }) : moveAudioClip(timeline, id, to))} />}
            </div>

            <aside className="space-y-5 rounded-2xl border border-vx-border bg-vx-panel p-5" aria-label={t("app.editor.legacy.clipExport")}>
                <fieldset disabled={exporting} className="min-w-0">
                {clip ? <div className="space-y-3">
                    <h2 className="text-sm font-bold">{media?.name} <span className="font-normal text-vx-fg-muted">({tOr(t, `app.editor.media.kind.${selected.track}`, selected.track)})</span></h2>
                    <p className="font-vx-mono text-xs text-vx-fg-muted">{t('app.editor.legacy.starts',{start:formatTime(layoutStart),duration:formatTime(clip.len)})}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => apply(timeline => splitSelection(timeline, selected, frame))}>{t("app.editor.legacy.split")}</Button>
                        <Button size="sm" variant="ghost" onClick={() => { edit((timeline, k, id) => removeClip(timeline, k, id)); setSelected(null); }}>{t("app.publish.composer.delete")}</Button>
                    </div>
                    <label className="block text-sm font-bold">{t("app.editor.legacy.clipStart")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{formatTime(clip.in)}</span>
                        <input className={range} type="range" min={0} max={Math.max(media.frames - 1, 0)} value={clip.in} onChange={e => { const n = Number(e.target.value); edit((timeline, k, id) => trimClip(timeline, k, id, { in: n, len: Math.max(1, Math.min(clip.len, media.frames - n)) })); }} /></label>
                    <label className="block text-sm font-bold">{t("slip.length")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{formatTime(clip.len)}</span>
                        <input className={range} type="range" min={1} max={Math.max(media.frames - clip.in, 1)} value={clip.len} onChange={e => { const n = Number(e.target.value); edit((timeline, k, id) => trimClip(timeline, k, id, { len: n })); }} /></label>
                    <label className="block text-sm font-bold">{t("app.editor.legacy.volume")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{number(Math.round(clip.volume * 100))}%</span>
                        <input className={range} type="range" min={0} max={100} value={Math.round(clip.volume * 100)} onChange={e => { const v = Number(e.target.value) / 100; edit((timeline, k, id) => setVolume(timeline, k, id, v)); }} /></label>
                    {selected.track === 'video' ? <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => { const i = tl.video.findIndex(c => c.id === clip.id); edit((timeline, _k, id) => moveVideoClip(timeline, id, i - 1)); }}>{t("app.editor.legacy.earlier")}</Button>
                        <Button size="sm" variant="ghost" onClick={() => { const i = tl.video.findIndex(c => c.id === clip.id); edit((timeline, _k, id) => moveVideoClip(timeline, id, i + 1)); }}>{t("app.editor.legacy.later")}</Button>
                    </div> : <Button size="sm" variant="ghost" onClick={() => edit((timeline, _k, id) => moveAudioClip(timeline, id, frame))}>{t("app.editor.legacy.startPlayhead")}</Button>}
                    {videoIndex > 0 && <label className="block text-sm font-bold">{t("app.editor.legacy.dissolve")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{formatTime(effectiveTransition(tl, videoIndex))}</span>
                        <input className={range} type="range" min={0} max={Math.min(MAX_TRANSITION, clip.len, tl.video[videoIndex - 1].len)} value={effectiveTransition(tl, videoIndex)} onChange={e => { const n = Number(e.target.value); edit((timeline, _k, id) => setTransition(timeline, id, n)); }} /></label>}
                    {selected.track === 'video' && media?.hasAudio && <Button size="sm" variant="ghost" onClick={() => apply(timeline => detachAudio(timeline, clip.id))}>{t("app.editor.legacy.extractAudio")}</Button>}
                </div> : textItem ? <div className="space-y-3">
                    <h2 className="text-sm font-bold">{t("app.editor.workspace.text")}</h2>
                    <p className="font-vx-mono text-xs text-vx-fg-muted">{t('app.editor.legacy.shows',{start:formatTime(textItem.start),duration:formatTime(textItem.len)})}</p>
                    <label className="block text-sm font-bold">{t("app.editor.workspace.words")}<input className={`${field} mt-2 w-full`} type="text" maxLength={LIMITS.maxTextChars} value={draftValue} onChange={e => setDraft({ forId: textItem.id, base: textItem.text, value: e.target.value })} onBlur={commitDraft} onKeyDown={e => { if (e.key === 'Enter') commitDraft(); }} /></label>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => apply(timeline => updateText(timeline, textItem.id, { start: Math.min(frame, MAX_FRAMES - textItem.len) }))}>{t("app.editor.legacy.startPlayhead")}</Button>
                        <Button size="sm" variant="ghost" onClick={() => { apply(timeline => removeText(timeline, textItem.id)); setSelected(null); }}>{t("app.publish.composer.delete")}</Button>
                    </div>
                    <label className="block text-sm font-bold">{t("app.editor.legacy.showsFor")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{formatTime(textItem.len)}</span>
                        <input className={range} type="range" min={1} max={Math.max(1, Math.min(MAX_FRAMES - textItem.start, 60 * FPS))} value={textItem.len} onChange={e => { const n = Number(e.target.value); apply(timeline => updateText(timeline, textItem.id, { len: n })); }} /></label>
                    <label className="block text-sm font-bold">{t("app.editor.legacy.size")}{' '}<span className="float-end font-vx-mono text-vx-fg-muted">{number(textItem.size)}</span>
                        <input className={range} type="range" min={LIMITS.minTextSize} max={LIMITS.maxTextSize} value={textItem.size} onChange={e => { const n = Number(e.target.value); apply(timeline => updateText(timeline, textItem.id, { size: n })); }} /></label>
                    <label className="block text-sm font-bold">{t("app.editor.legacy.position")}<select className={`${field} mt-2 w-full`} value={textItem.y <= 0.3 ? 'top' : textItem.y >= 0.7 ? 'bottom' : 'middle'} onChange={e => { const y = { top: 0.12, middle: 0.5, bottom: 0.85 }[e.target.value]; apply(timeline => updateText(timeline, textItem.id, { y })); }}><option value="top">{t("app.editor.legacy.top")}</option><option value="middle">{t("app.editor.legacy.middle")}</option><option value="bottom">{t("app.editor.legacy.bottom")}</option></select></label>
                </div> : <p className="text-sm text-vx-fg-muted">{t("app.editor.legacy.selectClip")}</p>}
                </fieldset>

                <div className="space-y-3 border-t border-vx-border pt-5">
                    <label className="block text-sm font-bold">{t("app.editor.workspace.shape")}<select className={`${field} mt-2 w-full`} value={tl.aspect} onChange={e => { const a = e.target.value; apply(timeline => setAspect(timeline, a)); }} disabled={exporting}>{ASPECTS.map(a => <option key={a} value={a}>{a === 'source' ? t("app.editor.legacy.sourceAspect") : a === '16:9' ? t("app.editor.legacy.landscape") : a === '9:16' ? t("app.editor.legacy.portrait") : t("app.editor.legacy.square")}</option>)}</select></label>
                    <label className="block text-sm font-bold">{t("app.editor.legacy.size")}<select className={`${field} mt-2 w-full`} value={height} onChange={e => setHeight(Number(e.target.value))} disabled={exporting}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
                    {blocker && <p role="status" className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-relaxed">{blocker}</p>}
                    <Button className="w-full justify-center" disabled={empty || exporting || Boolean(blocker)} onClick={runExport}>{t("app.editor.legacy.export")}</Button>
                    {exporting && <><progress aria-label={t("app.editor.legacy.exportProgress")} className="w-full accent-vx-accent" value={progress} max={1} /><Button size="sm" variant="ghost" onClick={() => exportAbort.current?.abort()}>{t("app.editor.legacy.cancelExport")}</Button></>}
                    {result && <div role="status"><a className="break-words text-sm font-bold text-vx-accent underline" href={result.url} download={result.name}>{t("label.Download")}{' '}{result.name}{t('app.editor.legacy.resultSize',{size:locale==='en'?(result.size / 1048576).toFixed(1):(result.size / 1048576).toLocaleString(localeTag(locale),{minimumFractionDigits:1,maximumFractionDigits:1})})}</a></div>}
                    <p className="text-xs leading-relaxed text-vx-fg-muted">{t("app.editor.legacy.policy")}</p>
                </div>
            </aside>
        </div>
    </div>;
}

export default function EditorPage() {
  const { t } = useI18n();
    const multitrack = useMultitrackEnabled();
    const [creditsOpen, setCreditsOpen] = useState(false);
    return <><AppNav active="editor" readAccount={false} /><Main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-black">{t("label.Video editor")}</h1>
            {!multitrack && <Button size="sm" variant="money" onClick={() => setCreditsOpen(true)}>Credits</Button>}
        </div>
        {multitrack ? <MultitrackWorkspace onCredits={() => setCreditsOpen(true)} /> : <Editor />}
    </Main>{creditsOpen && <EditorCreditsDialog open onClose={() => setCreditsOpen(false)} />}</>;
}
