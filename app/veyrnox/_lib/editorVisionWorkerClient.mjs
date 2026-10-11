import { EDITOR_VISION_PATH, EDITOR_VISION_LIMITS } from './editorVisionRuntime.mjs';
import { checkMotionSignal, motionAbort } from './editorMotionAnalysis.mjs';
function validateMasks(result) {
    const { width, height } = result;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || Math.max(width, height) > EDITOR_VISION_LIMITS.maskEdge) throw new Error('The local processor returned invalid mask bounds.');
    if (!['background', 'body', 'face'].every(k => result[k] instanceof Float32Array && result[k].length === width * height) || !(result.categories instanceof Uint8Array) || result.categories.length !== width * height) throw new Error('The local processor returned incomplete masks.');
    for (const name of ['background', 'body', 'face']) for (const value of result[name]) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('The local processor returned invalid mask confidence.');
    return result;
}
/** One serial worker; terminating it cancels model inference and releases its WASM heap. */
export async function createVisionProcessor({ signal } = {}) {
    checkMotionSignal(signal);
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Local person tools require a browser with image decoding and Workers.');
    const worker = new Worker(`${EDITOR_VISION_PATH}/worker.mjs`, { type: 'module', name: 'Veyrnox local person processing' });
    let closed = false, sequence = 0, pending = null;
    const close = (reason = motionAbort()) => {
        if (closed) return; closed = true; worker.terminate(); signal?.removeEventListener('abort', abort);
        if (pending) { clearTimeout(pending.timeout); pending.reject(reason); pending = null; }
    };
    const abort = () => close(); signal?.addEventListener('abort', abort, { once: true });
    const request = (payload, transfer = [], milliseconds = 15000) => new Promise((resolve, reject) => {
        if (closed) { reject(motionAbort()); return; }
        if (pending) { reject(new Error('A local picture is already being processed.')); return; }
        const id = ++sequence;
        const timeout = setTimeout(() => close(new Error('The local person processor timed out. Choose a shorter or smaller source.')), milliseconds);
        pending = { id, resolve, reject, timeout };
        try { worker.postMessage({ ...payload, id }, transfer); } catch (error) { clearTimeout(timeout); pending = null; reject(error); }
    });
    worker.onmessage = event => {
        if (!pending || event.data?.id !== pending.id) return;
        const waiting = pending; pending = null; clearTimeout(waiting.timeout);
        if (event.data.error) waiting.reject(new Error(event.data.error)); else waiting.resolve(event.data);
    };
    worker.onerror = () => close(new Error('The isolated local person runtime could not load.'));
    try {
        const ready = await request({ op: 'init' }, [], 60000);
        if (!ready.ready || !Array.isArray(ready.labels) || ready.labels.length !== 6) throw new Error('The local person model did not initialize.');
        return {
            labels: ready.labels,
            async segment(picture, timestamp) {
                checkMotionSignal(signal); if (closed) throw motionAbort();
                const width = picture.width ?? picture.videoWidth, height = picture.height ?? picture.videoHeight;
                if (![width, height, timestamp].every(Number.isFinite) || width < 8 || height < 8 || Math.max(width, height) > 4096) throw new Error('Choose a supported picture.');
                const scale = Math.min(1, EDITOR_VISION_LIMITS.inputEdge / Math.max(width, height));
                const bitmap = await createImageBitmap(picture, { resizeWidth: Math.max(8, Math.round(width * scale)), resizeHeight: Math.max(8, Math.round(height * scale)), resizeQuality: 'high' });
                try { checkMotionSignal(signal); return validateMasks(await request({ op: 'segment', bitmap, timestamp }, [bitmap])); }
                finally { bitmap.close(); }
            },
            close,
        };
    } catch (error) { close(error); throw error; }
}
