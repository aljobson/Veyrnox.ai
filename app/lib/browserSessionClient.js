'use client';

// Refresh credentials are only accepted from existing flows or a one-time
// legacy migration. They are never written to browser-readable persistence.
let queue = Promise.resolve();
export function browserSessionRequest(body, { beforeRequest = () => {}, onResponse = data => data } = {}) {
    const run = async () => {
        beforeRequest();
        const res = await fetch('/api/auth/session', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Session-Request': '1' },
            body: JSON.stringify(body), cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error('Unable to restore your session. Please try again.'),
            { status: res.status, code: data.error });
        // State adoption is part of the serialized operation: a later queued
        // establishment must see the epoch changed by this response.
        return onResponse(data);
    };
    const locked = () => typeof navigator !== 'undefined' && navigator.locks?.request
        ? navigator.locks.request('veyrnox-browser-session', run) : run();
    const pending = queue.then(locked, locked);
    queue = pending.catch(() => {});
    return pending;
}
