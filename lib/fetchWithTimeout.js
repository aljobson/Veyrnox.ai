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
