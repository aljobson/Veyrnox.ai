'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { createHistory, DEFAULTS } from '../../../../packages/live-edit/effects.js';
import { anchoredSticker } from '../../../../packages/live-edit/stickers.js';
import { Controls, control } from './Controls';
import { StickerHandles } from './StickerHandles';

export default function PhotoEditor() {
    const { t } = useI18n();
    const canvas = useRef(null), engine = useRef(null), history = useRef(createHistory()), epoch = useRef(0);
    const [source, setSource] = useState(null), [settings, setSettings] = useState(DEFAULTS);
    const [state, setState] = useState('empty'), [face, setFace] = useState(''), [hair, setHair] = useState('waiting'), [error, setFailure] = useState('');
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
        let instance, image;
        (async () => {
            try {
                const { createPhotoEngine, decodePhoto } = await import('../../_lib/liveEdit/engine.js');
                if (controller.signal.aborted || current !== epoch.current) return;
                image = await decodePhoto(source.file, controller.signal);
                if (controller.signal.aborted || current !== epoch.current) { image.close(); return; }
                setAspect(image.width / image.height);
                instance = createPhotoEngine(canvas.current, image, {
                    onHair: status => { if (!controller.signal.aborted && current === epoch.current) setHair(status); },
                    onFace: status => { if (!controller.signal.aborted && current === epoch.current) setFace(status); },
                    onError: message => { if (!controller.signal.aborted && current === epoch.current) { setFailure(message); setState('error'); } },
                });
                engine.current = instance; instance.setSettings(history.current.value); setState('ready');
            } catch (e) {
                if (!controller.signal.aborted && current === epoch.current) { setFailure(['invalid-photo', 'photo-too-large', 'photo-decode-failed', 'graphics-unavailable'].includes(e.message) ? e.message : 'photo-decode-failed'); setState('error'); }
            }
        })();
        return () => {
            controller.abort(); instance?.close(); image?.close();
            if (engine.current === instance) engine.current = null;
            epoch.current = current + 1;
        };
    }, [source]);
    function applyHistory() {
        const value = history.current.value; setSettings(value); setUndoState({ undo: history.current.canUndo, redo: history.current.canRedo }); engine.current?.setSettings(value); setResult(null);
    }
    function update(patch) { history.current.set({ ...history.current.value, ...patch }); applyHistory(); }
    function choose(event) {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 50 * 1024 * 1024) { setFailure('invalid-photo'); return; }
        epoch.current++; engine.current?.close(); engine.current = null;
        history.current = createHistory(); setUndoState({ undo: false, redo: false }); setSettings(history.current.value); setComparison(false); setResult(null); setFailure(''); setFace(''); setHair('waiting'); setState('loading'); setSource({ file });
    }
    function retry() {
        epoch.current++; engine.current?.close(); engine.current = null; setComparison(false); setFailure(''); setResult(null); setFace(''); setHair('waiting'); setState('loading'); setSource({ file: source.file });
    }
    function compare(value) { setComparison(value); engine.current?.compare(value); }
    async function exportPhoto() {
        if (!ready || !engine.current) return;
        const current = epoch.current, instance = engine.current;
        setState('exporting'); setFailure(''); setResult(null);
        try {
            const blob = await instance.export(format);
            if (current === epoch.current) setResult({ url: URL.createObjectURL(blob), extension: format === 'image/png' ? 'png' : 'jpg' });
        } catch { if (current === epoch.current) setFailure('export-failed'); }
        finally { if (current === epoch.current) setState('ready'); }
    }
    return <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm leading-relaxed text-vx-fg-body">{t('app.photoStudio.intro')}</p>
            <label className={`${control} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-vx-accent`}>
                {t(`app.photoStudio.${source ? 'change' : 'choose'}`)}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label={t('app.photoStudio.choose')} className="sr-only" disabled={state === 'exporting'} onChange={choose} />
            </label>
        </div>
        {offline && <p role="status" className="mb-4 text-sm text-vx-fg-muted">{t('app.photoStudio.offline')}</p>}
        {error && <div role="alert" className="mb-4 rounded-xl border border-vx-danger p-4 text-vx-danger"><p>{t(`app.photoStudio.${error}`)}</p>{source && <button className={`${control} mt-3`} onClick={retry} disabled={busy}>{t('app.photoStudio.retry')}</button>}</div>}
        <div className="grid items-start gap-8 lg:grid-cols-3">
            <section aria-label={t('app.photoStudio.preview')} className="min-w-0 lg:sticky lg:top-4 lg:col-span-2">
                <div className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel p-4">
                    {!source && <div className="flex aspect-[4/3] flex-col justify-center p-4 sm:p-8"><h2 className="font-vx text-3xl">{t('app.photoStudio.empty')}</h2><p className="mt-4 max-w-md text-sm text-vx-fg-muted">{t('app.photoStudio.limits')}</p></div>}
                    <div className={source ? 'relative flex aspect-[4/3] items-center justify-center overflow-hidden' : 'hidden'}>
                        <div className="relative shrink-0" style={{ width: `${Math.min(1, 0.75 * aspect) * 100}%` }}>
                            <canvas ref={canvas} aria-label={t('app.photoStudio.preview')} className={`block h-auto w-full ${state === 'loading' ? 'invisible' : ''}`} />
                            {!comparison && <StickerHandles stickers={settings.stickers} t={t} update={update} disabled={!ready} />}
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
                    <button className={`${control} min-h-13 border-vx-accent bg-vx-accent text-vx-accent-ink`} disabled={!ready} onClick={exportPhoto}>{t('app.photoStudio.export')}</button>
                </div>
                {format === 'image/jpeg' && <p className="mt-3 text-xs text-vx-fg-muted">{t('app.photoStudio.jpegHelp')}</p>}
                {state === 'exporting' && <p role="status" className="mt-4 text-sm">{t('app.photoStudio.exporting')}</p>}
                {result && <div role="status" className="mt-4"><p className="text-sm">{t('app.photoStudio.saved')}</p><a className={`${control} mt-3 inline-flex items-center text-vx-accent`} href={result.url} download={`photo-studio.${result.extension}`}>{t('app.photoStudio.download')}</a></div>}
            </section>
            <aside className="min-w-0 rounded-2xl border border-vx-border p-6"><Controls t={t} settings={settings} disabled={!ready} faceReady={face === 'one-face'} hairState={hair} retry={retry} update={update} addSticker={kind => { const sticker = anchoredSticker(kind, engine.current?.landmarks); if (sticker) update({ stickers: [...settings.stickers, sticker] }); }} /></aside>
        </div>
    </>;
}
