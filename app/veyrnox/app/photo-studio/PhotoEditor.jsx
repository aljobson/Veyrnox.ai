'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { createHistory, DEFAULTS } from '../../_lib/liveEdit/settings.js';
import { anchoredSticker } from '../../../../packages/live-edit/stickers.js';
import { Controls, control } from './Controls';
import { StickerHandles } from './StickerHandles';
import { CameraBar } from './CameraBar';
import { PHOTO_ACCEPT, validatePhoto } from '../../_lib/liveEdit/photoFormat.js';

export default function PhotoEditor() {
    const { t } = useI18n();
    const selectionEpoch = useRef(0);
    useEffect(() => () => { selectionEpoch.current++; }, []);
    const canvas = useRef(null), video = useRef(null), cameraDevice = useRef(''), engine = useRef(null), history = useRef(createHistory()), epoch = useRef(0);
    const [source, setSource] = useState(null), [settings, setSettings] = useState(DEFAULTS);
    const [state, setState] = useState('empty'), [face, setFace] = useState(''), [hair, setHair] = useState('waiting'), [wig, setWig] = useState('off'), [error, setFailure] = useState(''), [rejected, setRejected] = useState(false);
    const [notice, setNotice] = useState(''), [camera, setCamera] = useState('off'), [cameraNote, setCameraNote] = useState(''), [cameras, setCameras] = useState(0);
    const [format, setFormat] = useState('image/png'), [result, setResult] = useState(null), [offline, setOffline] = useState(false);
    const [aspect, setAspect] = useState(4 / 3);
    const [undoState, setUndoState] = useState({ undo: false, redo: false });
    const [comparison, setComparison] = useState(false);
    const busy = state === 'loading' || state === 'exporting', ready = state === 'ready';
    useEffect(() => {
        const sync = () => setOffline(!navigator.onLine); sync();
        window.addEventListener('online', sync); window.addEventListener('offline', sync);
        return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
    }, []);
    useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
    useEffect(() => {
        if (!source) return;
        const controller = new AbortController(), current = ++epoch.current;
        let instance, image, session, unwatch;
        const live = () => !controller.signal.aborted && current === epoch.current;
        (async () => {
            try {
                if (source.camera) {
                    const [{ createLiveEngine }, cam] = await Promise.all([import('../../_lib/liveEdit/liveEngine.js'), import('../../_lib/liveEdit/camera.js')]);
                    if (!live()) return;
                    // Failure is terminal for this source generation: abort first so no pending continuation can publish a live state.
                    const fail = code => { if (!live()) return; controller.abort(); instance?.close(); session?.stop(); if (engine.current === instance) engine.current = null; setFailure(code); setRejected(false); setCamera('off'); setState('error'); };
                    // Registered BEFORE the camera is requested, and it looks at the current visibility at once: a tab hidden while the
                    // permission prompt is open must never end up holding a live camera.
                    let hiddenWhileCurrent = false;
                    unwatch = cam.stopWhenHidden(() => { hiddenWhileCurrent = live(); controller.abort(); session?.stop(); },
                        () => { if (hiddenWhileCurrent) { epoch.current++; setCameraNote('hidden'); setCamera('off'); setSource(null); setState('empty'); setFace(''); } });
                    session = await cam.startCamera({ video: video.current, deviceId: source.deviceId, signal: controller.signal, onEnded: () => fail('camera-lost') });
                    if (!live()) { session.stop(); return; }
                    cameraDevice.current = session.settings.deviceId || '';
                    setAspect(video.current.videoWidth / video.current.videoHeight);
                    instance = createLiveEngine(canvas.current, video.current, {
                        onWig: status => { if (live()) setWig(status); },
                        onFace: status => { if (live()) setFace(status); },
                        onError: message => { if (live()) fail(message); },
                        onResize: (width, height) => { if (live()) setAspect(width / height); },
                    });
                    engine.current = instance; instance.setSettings(history.current.value);
                    await instance.ready;
                    if (!live() || engine.current !== instance) return;
                    setHair('live'); setCamera('live'); setState('ready');
                    cam.listCameras().then(list => { if (live()) setCameras(list.length); });
                    return;
                }
                const { createPhotoEngine, decodePhoto } = await import('../../_lib/liveEdit/engine.js');
                if (controller.signal.aborted || current !== epoch.current) return;
                image = await decodePhoto(source.file, controller.signal);
                if (controller.signal.aborted || current !== epoch.current) { image.close(); return; }
                setAspect(image.width / image.height);
                instance = createPhotoEngine(canvas.current, image, {
                    onWig: status => { if (!controller.signal.aborted && current === epoch.current) setWig(status); },
                    onHair: status => { if (!controller.signal.aborted && current === epoch.current) setHair(status); },
                    onFace: status => { if (!controller.signal.aborted && current === epoch.current) setFace(status); },
                    onError: message => { if (!controller.signal.aborted && current === epoch.current) { setFailure(message); setRejected(false); setState('error'); } },
                });
                engine.current = instance; instance.setSettings(history.current.value); setState('ready');
            } catch (e) {
                if (live() && source.camera) {
                    instance?.close(); session?.stop(); if (engine.current === instance) engine.current = null;
                    import('../../_lib/liveEdit/camera.js').then(({ cameraErrorCode }) => { if (live()) { setFailure(['photo-too-large', 'graphics-unavailable'].includes(e.message) ? e.message : cameraErrorCode(e)); setRejected(false); setCamera('off'); setState('error'); } });
                } else if (!controller.signal.aborted && current === epoch.current) { setFailure(['invalid-photo', 'photo-too-large', 'photo-decode-failed', 'graphics-unavailable', 'heic-unsupported', 'avif-unsupported'].includes(e.message) ? e.message : 'photo-decode-failed'); setRejected(false); setState('error'); }
            }
        })();
        return () => {
            controller.abort(); unwatch?.(); instance?.close(); image?.close(); session?.stop();
            if (engine.current === instance) engine.current = null;
            epoch.current = current + 1;
        };
    }, [source]);
    function applyHistory() {
        const value = history.current.value; setSettings(value); setUndoState({ undo: history.current.canUndo, redo: history.current.canRedo }); engine.current?.setSettings(value); setResult(null);
    }
    function update(patch) { history.current.set({ ...history.current.value, ...patch }); applyHistory(); }
    async function choose(event) {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        const selection = ++selectionEpoch.current;
        try { await validatePhoto(file); }
        catch (e) { if (selection === selectionEpoch.current) { setFailure(e.message === 'photo-too-large' ? 'photo-too-large' : 'invalid-photo'); setRejected(true); } return; }
        if (selection !== selectionEpoch.current) return;
        epoch.current++; engine.current?.close(); engine.current = null;
        history.current = createHistory(); setUndoState({ undo: false, redo: false }); setSettings(history.current.value); setComparison(false); setResult(null); setFailure(''); setRejected(false); setFace(''); setHair('waiting'); setWig('off'); setNotice(''); setCamera('off'); setCameraNote(''); setState('loading'); setSource({ file });
    }
    function retry() {
        epoch.current++; engine.current?.close(); engine.current = null; setComparison(false); setFailure(''); setRejected(false); setResult(null); setFace(''); setHair(source.camera ? 'live' : 'waiting'); setWig('off'); setCamera(source.camera ? 'starting' : 'off'); setState('loading'); setSource({ ...source });
    }
    function startCamera(deviceId) {
        epoch.current++; engine.current?.close(); engine.current = null; setComparison(false); setResult(null); setFailure(''); setRejected(false); setFace(''); setHair('live'); setWig('off'); setCameraNote('');
        setCamera('starting'); setState('loading'); setSource({ camera: true, deviceId });
    }
    function stopCamera() { epoch.current++; setCameraNote('stopped'); setCamera('off'); setSource(null); setState('empty'); setFace(''); setFailure(''); }
    async function switchCamera() {
        const generation = epoch.current; // Stop, hide, a chosen photo or Take photo all bump this; a stale switch must not restart the camera
        const { listCameras } = await import('../../_lib/liveEdit/camera.js');
        const list = await listCameras(); if (generation !== epoch.current || list.length < 2) return;
        const index = list.findIndex(device => device.deviceId === cameraDevice.current);
        startCamera(list[(index + 1) % list.length].deviceId);
    }
    async function takePhoto() {
        if (!ready || !engine.current?.capture) return;
        const generation = epoch.current, instance = engine.current;
        try {
            const blob = await instance.capture(), file = new File([blob], 'camera.png', { type: 'image/png' });
            if (generation !== epoch.current || engine.current !== instance) return; // stopped, switched or replaced while capturing
            // Same path as a chosen photo, but keep the look the user tuned: hair and wig coverage then work at full quality.
            epoch.current++; engine.current?.close(); engine.current = null; setComparison(false); setResult(null); setFailure(''); setRejected(false); setFace(''); setHair('waiting'); setWig('off'); setCamera('off'); setState('loading'); setSource({ file });
        } catch { if (generation === epoch.current) { setFailure('export-failed'); setRejected(false); } }
    }
    function compare(value) { setComparison(value); engine.current?.compare(value); }
    async function exportPhoto() {
        if (!ready || !engine.current) return;
        const current = epoch.current, instance = engine.current;
        setState('exporting'); setFailure(''); setResult(null); setNotice('');
        try {
            const blob = await instance.export(format, { onNotice: code => { if (current === epoch.current) setNotice(code); } });
            if (current === epoch.current) setResult({ url: URL.createObjectURL(blob), extension: format === 'image/png' ? 'png' : 'jpg' });
        } catch { if (current === epoch.current) { setFailure('export-failed'); setRejected(false); } }
        finally { if (current === epoch.current) setState('ready'); }
    }
    return <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm leading-relaxed text-vx-fg-body">{t('app.photoStudio.intro')}</p>
            <label className={`${control} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-vx-accent`}>
                {t(`app.photoStudio.${source ? 'change' : 'choose'}`)}<input type="file" accept={PHOTO_ACCEPT} aria-label={t('app.photoStudio.choose')} className="sr-only" disabled={state === 'exporting'} onChange={choose} />
            </label>
        </div>
 <video ref={video} playsInline muted aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute h-px w-px opacity-0" />
        <CameraBar t={t} control={control} camera={camera} note={cameraNote} ready={ready} canSwitch={cameras > 1} start={() => startCamera()} stop={stopCamera} take={takePhoto} switchCamera={switchCamera} />
        {offline && <p role="status" className="mb-4 text-sm text-vx-fg-muted">{t('app.photoStudio.offline')}</p>}
        {error && <div role="alert" className="mb-4 rounded-xl border border-vx-danger p-4 text-vx-danger"><p>{error === 'heic-unsupported' ? t('app.photoStudio.heic-unsupported') : error === 'avif-unsupported' ? t('app.photoStudio.avif-unsupported') : t(`app.photoStudio.${error}`)}</p>{source && !rejected && <button className={`${control} mt-3`} onClick={retry} disabled={busy}>{t('app.photoStudio.retry')}</button>}</div>}
        <div className="grid items-start gap-8 lg:grid-cols-3">
            <section aria-label={t('app.photoStudio.preview')} className="min-w-0 lg:sticky lg:top-4 lg:col-span-2">
                <div className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel p-4">
                    {!source && <div className="flex aspect-[4/3] flex-col justify-center p-4 sm:p-8"><h2 className="font-vx text-3xl">{t('app.photoStudio.empty')}</h2><p className="mt-4 max-w-md text-sm text-vx-fg-muted">{t('app.photoStudio.limits')}</p></div>}
                    <div className={source ? 'relative flex aspect-[4/3] items-center justify-center overflow-hidden' : 'hidden'}>
                        <div className="relative shrink-0" style={{ width: `${Math.min(1, 0.75 * aspect) * 100}%` }}>
                            <canvas ref={canvas} aria-label={t('app.photoStudio.preview')} style={camera === 'live' ? { transform: 'scaleX(-1)' } : undefined} className={`block h-auto w-full ${state === 'loading' ? 'invisible' : ''}`} />
                            {!comparison && camera !== 'live' && <StickerHandles stickers={settings.stickers} t={t} update={update} disabled={!ready} />}
                        </div>
                        {state === 'loading' && <p role="status" className="absolute inset-0 flex items-center justify-center p-8 text-sm">{t('app.photoStudio.loading')}</p>}
                    </div>
                </div>
                {source && <>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button className={control} disabled={!ready} aria-pressed={comparison}
                            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); compare(true); }} onPointerUp={() => compare(false)} onPointerCancel={() => compare(false)} onLostPointerCapture={() => compare(false)} onBlur={() => compare(false)}
                            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); compare(true); } }} onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); compare(false); } }}>{t('app.photoStudio.compare')}</button>
                        <button className={control} disabled={!ready || !undoState.undo} onClick={() => { history.current.undo(); applyHistory(); }}>{t('app.photoStudio.undo')}</button>
                        <button className={control} disabled={!ready || !undoState.redo} onClick={() => { history.current.redo(); applyHistory(); }}>{t('app.photoStudio.redo')}</button>
                        <button className={control} disabled={!ready} onClick={() => { history.current.set(DEFAULTS); applyHistory(); }}>{t('app.photoStudio.reset')}</button>
                    </div>
                    <p role="status" className="mt-4 min-h-12 text-sm leading-relaxed text-vx-fg-muted">{face && t(`app.photoStudio.${face}`)}</p>
                    {face === 'face-unavailable' && !error && <button className={control} onClick={retry} disabled={busy}>{t('app.photoStudio.retry')}</button>}
                </>}
                <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-vx-border pt-6">
                    <label className="text-sm">{t('app.photoStudio.format')}<select className={`${control} mt-2 block`} value={format} disabled={busy} onChange={e => { setFormat(e.target.value); setResult(null); }}><option value="image/png">{t('app.photoStudio.png')}</option><option value="image/jpeg">{t('app.photoStudio.jpeg')}</option></select></label>
                    <button className={`${control} min-h-13 border-vx-accent bg-vx-accent text-vx-accent-ink`} disabled={!ready || camera === 'live'} onClick={exportPhoto}>{t('app.photoStudio.export')}</button>
                </div>
                {format === 'image/jpeg' && <p className="mt-3 text-xs text-vx-fg-muted">{t('app.photoStudio.jpegHelp')}</p>}
                {state === 'exporting' && <p role="status" className="mt-4 text-sm">{t('app.photoStudio.exporting')}</p>}
                {notice === 'wig-omitted' && <p role="status" className="mt-4 text-sm text-vx-fg-muted">{t('app.photoStudio.wig-omitted')}</p>}
                {result && <div role="status" className="mt-4"><p className="text-sm">{t('app.photoStudio.saved')}</p><a className={`${control} mt-3 inline-flex items-center text-vx-accent`} href={result.url} download={`photo-studio.${result.extension}`}>{t('app.photoStudio.download')}</a></div>}
            </section>
            <aside className="min-w-0 rounded-2xl border border-vx-border p-6"><Controls t={t} settings={settings} disabled={!ready} faceReady={face === 'one-face'} hairState={hair} wigState={wig} stickersDisabled={camera === 'live'} retry={retry} update={update} addSticker={kind => { const sticker = anchoredSticker(kind, engine.current?.landmarks); if (sticker) update({ stickers: [...settings.stickers, sticker] }); }} /></aside>
        </div>
    </>;
}
