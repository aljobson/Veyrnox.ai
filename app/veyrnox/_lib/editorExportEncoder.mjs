const cancelled = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });

export const ENCODER_STALLED = 'video_encoder_stalled';
export const FINALIZE_STALLED = 'export_finalize_stalled';

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

/** Bound muxer finalization and make AbortController cancellation observable immediately. */
export async function finalizeExportWithTimeout(finalize, { signal, timeoutMs = 30000 } = {}) {
    if (signal?.aborted) throw cancelled();
    let timer, onAbort;
    try {
        return await Promise.race([
            Promise.resolve().then(finalize),
            new Promise((_, reject) => {
                onAbort = () => reject(cancelled());
                signal?.addEventListener('abort', onAbort, { once: true });
                timer = setTimeout(() => reject(Object.assign(
                    new Error('Export finalization stopped responding.'),
                    { code: FINALIZE_STALLED },
                )), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/** Cleanup must not keep the export dialog locked if a broken muxer never settles cancellation. */
export async function cancelExportWithTimeout(cancel, { timeoutMs = 2000 } = {}) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(cancel),
            new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
        ]);
    } finally {
        clearTimeout(timer);
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
