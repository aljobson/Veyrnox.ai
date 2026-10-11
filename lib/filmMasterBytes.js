import { FILM_MASTER_MAX_BYTES } from './filmMasterInspection.js';

// Allocate the declared, capped size once; never retain a second full set of
// chunks. A stage plus its immutable readback fit within the Worker budget.
export async function readFilmMasterBytes(body, size, signal) {
    if (!body || !Number.isSafeInteger(size) || size < 1 || size > FILM_MASTER_MAX_BYTES) throw new Error('invalid_size');
    const bytes = new Uint8Array(size), reader = body.getReader();
    let offset = 0, onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
        while (true) {
            const { done, value } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            if (offset + value.byteLength > size) throw new Error('size_mismatch');
            bytes.set(value, offset); offset += value.byteLength;
        }
        if (offset !== size) throw new Error('size_mismatch');
        return bytes;
    } catch (e) { void reader.cancel(e).catch(() => {}); throw e; }
    finally { signal?.removeEventListener('abort', onAbort); reader.releaseLock(); }
}
