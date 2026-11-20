// What happens when the person's session ends while the Pro editor may be open (sign-out in this
// or another tab, token expiry, account change). ADR-0358: identity and the editor frame go
// first and synchronously; the storage wipe is bounded and never blocks the sign-out.

/**
 * deps: invalidate() (drop identity and private caches), removeFrame() (remove the editor iframe,
 *       which destroys the engine and its writers), purge() -> Promise<{ok, reason}> (purge page),
 *       onResult({ok, reason}) (record an incomplete wipe), timeoutMs
 * Returns a promise for the wipe result; callers must NOT await it before completing sign-out.
 */
export function handleSessionLoss(deps) {
    // 1 and 2 are synchronous and independent: a failure in one never skips the other.
    try { deps.invalidate(); } catch { /* identity loss must proceed */ }
    try { deps.removeFrame(); } catch { /* the frame may already be gone */ }
    const bounded = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), deps.timeoutMs ?? 6000);
        Promise.resolve()
            .then(() => deps.purge())
            .then((result) => resolve(result || { ok: false, reason: 'no-result' }), () => resolve({ ok: false, reason: 'error' }))
            .finally(() => clearTimeout(timer));
    });
    return bounded.then((result) => {
        try { deps.onResult?.(result); } catch { /* recording only */ }
        return result;
    });
}
