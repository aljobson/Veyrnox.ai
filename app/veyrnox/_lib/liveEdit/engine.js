import { createVisionProcessor } from '../editorVisionWorkerClient.mjs';
import { createPhotoRenderer } from './renderer.js';
import { createFaceProcessor } from './faceClient.mjs';
import { DEFAULTS, normalize } from '../../../../packages/live-edit/effects.js';
import { createLandmarkFilter } from '../../../../packages/live-edit/smoothing.js';
import { selectFaceHair } from '../../../../packages/live-edit/hair.js';
export const PHOTO_LIMITS = Object.freeze({ bytes: 50 * 1024 * 1024, pixels: 24 * 1000 * 1000, edge: 8192 });
export function validatePhoto(file, width, height) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > PHOTO_LIMITS.bytes || file.size < 1) throw new Error('invalid-photo');
    if (width !== undefined && (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 8 || Math.max(width, height) > PHOTO_LIMITS.edge || width * height > PHOTO_LIMITS.pixels)) throw new Error('photo-too-large');
}
export function decodePhoto(file, signal) {
    validatePhoto(file);
    return new Promise((resolve, reject) => {
        const image = new Image(), url = URL.createObjectURL(file);
        let settled = false;
        const finish = (error, bitmap) => {
            if (settled) { bitmap?.close(); return; }
            settled = true;
            clearTimeout(timer); signal?.removeEventListener('abort', abort); URL.revokeObjectURL(url);
            image.onload = image.onerror = null; image.src = '';
            if (error) reject(error); else resolve(bitmap);
        };
        const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('photo-decode-failed')), 15000);
        image.onload = async () => {
            try {
                validatePhoto(file, image.naturalWidth, image.naturalHeight);
                // Freeze a still, including animated PNG/WebP, and make alpha handling explicit.
                const bitmap = await createImageBitmap(image, { premultiplyAlpha: 'none' });
                finish(null, bitmap);
            } catch (error) { finish(error); }
        };
        image.onerror = () => finish(new Error('photo-decode-failed'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort(); else image.src = url;
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
