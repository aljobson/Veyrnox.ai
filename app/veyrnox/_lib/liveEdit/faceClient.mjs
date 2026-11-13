import { FACE_VISION_PATH } from '../editorVisionRuntime.mjs';
const abortError = () => new DOMException('Photo processing cancelled.', 'AbortError');
export function validateLandmarks(result) {
    if (![0, 1, 2].includes(result.count) || !(result.landmarks instanceof Float32Array) || result.landmarks.length !== (result.count === 1 ? 478 * 3 : 0)) throw new Error('invalid-landmarks');
    for (let i = 0; i < result.landmarks.length; i++) {
        const value = result.landmarks[i];
        if (!Number.isFinite(value) || Math.abs(value) > 2) throw new Error('invalid-landmarks');
    }
    return result;
}
export async function createFaceProcessor({ signal, WorkerClass = globalThis.Worker, bitmapFactory = globalThis.createImageBitmap, timeoutMs = 15000 } = {}) {
    if (signal?.aborted) throw abortError();
    if (!WorkerClass || !bitmapFactory) throw new Error('face-inference-unavailable');
    const worker = new WorkerClass(`${FACE_VISION_PATH}/worker.mjs`, { type: 'module', name: 'Local photo touch-ups' });
    let closed = false, pending, sequence = 0;
    const abort = () => close(abortError());
    function close(reason = abortError()) {
        if (closed) return;
        closed = true; worker.terminate(); signal?.removeEventListener('abort', abort);
        if (pending) { clearTimeout(pending.timer); pending.reject(reason); pending = undefined; }
    }
    signal?.addEventListener('abort', abort, { once: true });
    function request(payload, transfer = [], timeout = timeoutMs) {
        return new Promise((resolve, reject) => {
            if (closed || signal?.aborted) { reject(abortError()); return; }
            if (pending) { reject(new Error('face-processor-busy')); return; }
            const id = ++sequence;
            const timer = setTimeout(() => close(new Error('face-inference-timeout')), timeout);
            pending = { id, resolve, reject, timer };
            try { worker.postMessage({ ...payload, id }, transfer); } catch (e) { close(e); }
        });
    }
    worker.onmessage = ({ data }) => {
        if (!pending || data?.id !== pending.id) return;
        const p = pending; pending = undefined; clearTimeout(p.timer);
        if (data.error) p.reject(new Error('face-inference-unavailable')); else p.resolve(data);
    };
    worker.onerror = worker.onmessageerror = () => close(new Error('face-inference-unavailable'));
    try {
        if (!(await request({ op: 'init' }, [], Math.max(timeoutMs, 60000))).ready) throw new Error('face-inference-unavailable');
        return {
            async detect(source) {
                if (closed || signal?.aborted) throw abortError();
                const width = source.videoWidth || (source.naturalWidth ?? source.width), height = source.videoHeight || (source.naturalHeight ?? source.height);
                if (!Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) < 8) throw new Error('invalid-photo');
                const scale = Math.min(1, 384 / Math.max(width, height));
                const bitmap = await bitmapFactory(source, { resizeWidth: Math.max(8, Math.round(width * scale)), resizeHeight: Math.max(8, Math.round(height * scale)), resizeQuality: 'high' });
                try { return validateLandmarks(await request({ op: 'detect', bitmap }, [bitmap])); }
                catch (error) { close(error); throw error; }
                finally { bitmap.close(); }
            }, close,
        };
    } catch (error) { close(error); throw error; }
}
