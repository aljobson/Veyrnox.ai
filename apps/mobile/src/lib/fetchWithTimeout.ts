export const REQUEST_TIMEOUT_MS = 30_000;

export class RequestTimeout extends Error {}

// Race as well as abort: a transport that ignores its signal must still settle.
export async function fetchWithTimeout(doFetch: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const caller = init.signal;
    // RN 0.88 supports any(); caller cancellation still reaches a streamed body
    // after the header deadline and our race listener have been cleared.
    const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    const stopped = new Promise<never>((_, reject) => {
        onAbort = () => {
            const reason = caller?.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' });
            reject(reason);
            controller.abort(reason);
        };
        if (caller?.aborted) { onAbort(); return; }
        caller?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
            const reason = new RequestTimeout();
            reject(reason);
            controller.abort(reason);
        }, REQUEST_TIMEOUT_MS);
    });
    try {
        if (caller?.aborted) return await stopped;
        return await Promise.race([doFetch(url, { ...init, signal }), stopped]);
    } finally {
        clearTimeout(timer);
        caller?.removeEventListener('abort', onAbort);
    }
}
