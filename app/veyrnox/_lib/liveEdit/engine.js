import { createVisionProcessor } from '../editorVisionWorkerClient.mjs';
import { createPhotoRenderer } from './renderer.js';
import { createFaceProcessor } from './faceClient.mjs';
import { DEFAULTS, normalize } from '../../../../packages/live-edit/effects.js';
import { createLandmarkFilter } from '../../../../packages/live-edit/smoothing.js';
import { selectFaceHair } from '../../../../packages/live-edit/hair.js';
import { validatePhoto, validatePhotoDimensions, decodeFailure } from './photoFormat.js';
export { PHOTO_LIMITS, validatePhoto } from './photoFormat.js';
export async function decodePhoto(file, signal, decoder = (blob, options) => createImageBitmap(blob, options)) {
    const type = await validatePhoto(file);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, bitmap) => {
            if (settled) { bitmap?.close(); return; }
            settled = true;
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(bitmap);
        };
        const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error(decodeFailure(type))), 15000);
        signal?.addEventListener('abort', abort, { once: true });
        // Blob decoding selects the default still, or first animation frame. Apply EXIF orientation
        // exactly once, before dimensions, inference, preview and export see the pixels.
        Promise.resolve().then(() => decoder(file.slice(0, file.size, type), { imageOrientation: 'from-image', premultiplyAlpha: 'none' })).then(bitmap => {
            if (settled) { bitmap.close(); return; }
            try { validatePhotoDimensions(bitmap.width, bitmap.height); }
            catch (error) { bitmap.close(); finish(error); return; }
            finish(null, bitmap);
        }, () => finish(new Error(decodeFailure(type))));
    });
}
/** Ownership is synchronous: caller can close while model initialization is pending. */
export function createPhotoEngine(canvas, source, { onFace = () => {}, onHair = () => {}, hairProcessorFactory = createVisionProcessor, onError = () => {}, rendererFactory = createPhotoRenderer, processorFactory = createFaceProcessor, createFlatCanvas = () => document.createElement('canvas') } = {}) {
    const controller = new AbortController(), renderer = rendererFactory(canvas, source), filter = createLandmarkFilter();
    let closed = false, processor, hairProcessor, frame = 0, settings = normalize(DEFAULTS), compare = false, landmarks = new Float32Array();
    function draw() { frame = 0; if (closed) return; try { renderer.draw(compare ? DEFAULTS : settings); } catch { onError('graphics-lost'); } }
    function schedule() { if (!closed && !frame) frame = requestAnimationFrame(draw); }
    function clearHair() {
        try { renderer.setHairMask?.(null); return true; }
        catch { onHair('invalid'); onError('graphics-lost'); return false; }
    }
    const ready = (async () => {
        let faceProcessorFailed = false;
        onFace('detecting'); onHair('waiting');
        try {
            processor = await processorFactory({ signal: controller.signal });
            if (closed) return;
            const result = await processor.detect(source);
            if (closed) return;
            landmarks = filter.update(result.count === 1 ? result.landmarks : null, performance.now());
            renderer.setLandmarks(landmarks); onFace(result.count === 1 ? 'one-face' : result.count === 2 ? 'multiple-faces' : 'no-face');
            schedule();
        } catch (error) {
            if (!closed && error.name !== 'AbortError') {
                faceProcessorFailed = true;
                landmarks = new Float32Array(); filter.reset(); onFace('face-unavailable');
                try { renderer.setLandmarks(null); schedule(); } catch { onError('graphics-lost'); }
            }
        } finally { processor?.close(); }
        if (closed) return;
        if (landmarks.length !== 1434) { if (clearHair()) onHair(faceProcessorFailed ? 'unavailable' : 'face-required'); return; }
        onHair('detecting');
        let masks;
        try {
            hairProcessor = await hairProcessorFactory({ signal: controller.signal, hair: true });
            if (closed) return;
            masks = await hairProcessor.segment(source, 1);
        } catch (error) {
            if (!closed && error.name !== 'AbortError' && clearHair()) { onHair('unavailable'); schedule(); }
            return;
        } finally { hairProcessor?.close(); }
        if (closed) return;
        // Processing/upload errors are not a failed model download. Do not offer
        // an inference Retry loop for a malformed internal mask or a lost GPU.
        try {
            const found = renderer.setHairMask(selectFaceHair(masks, landmarks));
            onHair(found ? 'ready' : 'no-hair'); schedule();
        } catch (error) {
            onHair('invalid');
            if (error.message === 'invalid-hair-mask') { if (clearHair()) schedule(); }
            else onError('graphics-lost');
        }
    })();
    schedule();
    return {
        ready,
        get landmarks() { return landmarks.slice(); },
        setSettings(next) { settings = normalize(next); schedule(); },
        compare(value) { compare = Boolean(value); schedule(); },
        async export(type = 'image/png') {
            if (closed) throw new Error('photo-closed');
            if (!['image/png', 'image/jpeg'].includes(type)) throw new Error('invalid-format');
            // toBlob snapshots this exact render; hold-to-compare never leaks into export.
            renderer.draw(settings);
            let source = canvas;
            if (type === 'image/jpeg') {
                // JPEG has no alpha: flatten onto white here, or transparent PNG/WebP areas would encode as black.
                source = createFlatCanvas(); source.width = canvas.width; source.height = canvas.height;
                const flat = source.getContext('2d'); flat.fillStyle = '#fff'; flat.fillRect(0, 0, source.width, source.height); flat.drawImage(canvas, 0, 0);
            }
            const result = new Promise((resolve, reject) => source.toBlob(blob => blob ? resolve(blob) : reject(new Error('export-failed')), type, 0.95));
            schedule();
            const blob = await result;
            if (closed) throw new DOMException('Cancelled', 'AbortError');
            return blob;
        },
        close() { if (closed) return; closed = true; controller.abort(); processor?.close(); hairProcessor?.close(); cancelAnimationFrame(frame); filter.reset(); landmarks = new Float32Array(); renderer.close(); },
    };
}
