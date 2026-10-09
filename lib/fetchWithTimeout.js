import { readBoundedBody } from './boundedBody.js';

/**
 * Fetch a small API response, enforcing the deadline through the LAST byte.
 * Media streaming uses the R2 adapter instead. Default response cap: 2 MiB.
 * Caller cancellation and timeout both abort transport and body consumption.
 */
export async function fetchWithTimeout(input, init = {}, timeoutMs = 8000, maxBytes = 2 * 1024 * 1024) {
    const controller = new AbortController();
    const cancel = () => controller.abort(init.signal.reason);
    if (init.signal?.aborted) cancel();
    else init.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'AbortError')), timeoutMs);
    try {
        const res = await fetch(input, { ...init, signal: controller.signal });
        const bytes = await readBoundedBody(res.body, maxBytes, controller.signal);
        return new Response(res.body === null ? null : bytes, {
            status: res.status, statusText: res.statusText, headers: res.headers,
        });
    } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', cancel);
    }
}

/**
 * Fetch and read a body one chunk at a time, handing each to `onChunk` and
 * keeping none: for a large media body that is scanned in passing, not held.
 * The byte ceiling and the deadline through the last byte are the same as
 * fetchWithTimeout's; `onChunk` returning false stops the read early. Returns
 * the response status and the number of bytes delivered.
 */
export async function streamWithTimeout(input, init = {}, timeoutMs = 8000, maxBytes = 2 * 1024 * 1024, onChunk = () => {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) cancel();
    else init.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'AbortError')), timeoutMs);
    try {
        const res = await fetch(input, { ...init, signal: controller.signal });
        let delivered = 0;
        if (res.body) {
            const reader = res.body.getReader();
            let abort;
            const aborted = new Promise((_, reject) => {
                abort = () => reject(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
                if (controller.signal.aborted) abort();
                else controller.signal.addEventListener('abort', abort, { once: true });
            });
            let stop = false;
            try {
                while (true) {
                    const { done, value } = await Promise.race([reader.read(), aborted]);
                    if (done) break;
                    delivered += value.byteLength;
                    if (delivered > maxBytes) throw Object.assign(new Error('body_too_large'), { status: 413 });
                    if (onChunk(value) === false) { stop = true; break; }
                }
            } catch (err) {
                void reader.cancel(err).catch(() => {});
                throw err;
            } finally {
                controller.signal.removeEventListener('abort', abort);
                if (stop) { try { await reader.cancel(); } catch { /* already gone */ } }
                reader.releaseLock();
            }
        }
        return { status: res.status, statusText: res.statusText, bytes: delivered };
    } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', cancel);
    }
}
