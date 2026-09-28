// One deadline covers media readiness, imports, inspection and tracker creation.
export function createSetupDeadline(onTimeout, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
        onTimeout();
    }, timeoutMs);
    return {
        signal: controller.signal,
        finish() { clearTimeout(timer); },
        cancel() { clearTimeout(timer); controller.abort(); },
    };
}

// MediaPipe initialization cannot be interrupted. Dispose a late tracker before
// attaching a renderer or starting callbacks against a replaced video/canvas.
export async function acquireSetupTracker(create, signal) {
    signal?.throwIfAborted();
    const tracker = await create();
    if (signal?.aborted) {
        tracker.close();
        signal.throwIfAborted();
    }
    return tracker;
}
