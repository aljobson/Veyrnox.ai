/** Read bytes with an enforced ceiling, independent of Content-Length. */
export async function readBoundedBody(body, maxBytes, signal) {
    if (!body) return new Uint8Array();
    const reader = body.getReader();
    let abort;
    const aborted = new Promise((_, reject) => {
        abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
    });
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw Object.assign(new Error('body_too_large'), { status: 413 });
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
    } catch (err) {
        // Cancellation of an uncooperative stream must not delay rejection.
        void reader.cancel(err).catch(() => {});
        throw err;
    } finally {
        signal?.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}
