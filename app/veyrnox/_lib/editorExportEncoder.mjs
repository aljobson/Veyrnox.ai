const cancelled = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });

export const ENCODER_STALLED = 'video_encoder_stalled';

/** Bound one WebCodecs write so a broken encoder cannot leave the export dialog spinning forever. */
export async function addVideoFrameWithTimeout(add, { signal, timeoutMs = 30000 } = {}) {
    if (signal?.aborted) throw cancelled();
    let timer, onAbort;
    try {
        return await Promise.race([
            Promise.resolve().then(add),
            new Promise((_, reject) => {
                onAbort = () => reject(cancelled());
                signal?.addEventListener('abort', onAbort, { once: true });
                timer = setTimeout(() => reject(Object.assign(
                    new Error('Video encoding stopped responding.'),
                    { code: ENCODER_STALLED },
                )), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/** Prefer the qualified software encoder, then retry the whole clean export once with the browser default. */
export async function exportWithEncoderFallback(run, onRetry = () => {}) {
    try { return await run('prefer-software'); }
    catch (error) {
        if (error?.code !== ENCODER_STALLED) throw error;
        onRetry();
        return run('no-preference');
    }
}
