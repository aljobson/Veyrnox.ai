// Deliberately no imports: the entry uses this before modules may read stored state.
// Never export the token or hand it to AuthProvider/sessionStore. No persistence or retry.
let refreshToken: string | null = null;
let accessToken: string | null = null;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let expired: Promise<void> = Promise.resolve();
let finishExpiry: (() => void) | undefined;
function discard(): void {
    refreshToken = null;
    accessToken = null;
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    finishExpiry?.();
    finishExpiry = undefined;
}
export function retainDiscardedSession(token: string): void {
    discard();
    refreshToken = token;
    expired = new Promise(resolve => { finishExpiry = resolve; });
    timer = setTimeout(discard, 30_000);
}

// Invoked after startup. The anonymous connectivity probe never receives the discarded token.
export async function revokeDiscardedSession(): Promise<void> {
    if (started || !refreshToken) return;
    started = true;
    controller = new AbortController();
    const signal = controller.signal;
    try { await Promise.race([revoke(signal), expired]); }
    finally { discard(); }
}

async function revoke(signal: AbortSignal): Promise<void> {
    try {
        const { defaultProbe } = require('../network') as typeof import('../network');
        if (!await defaultProbe() || signal.aborted || !refreshToken) return;
        const { config } = require('../config') as typeof import('../config');
        const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        refreshToken = null;
        if (!response.ok || signal.aborted) return;
        // Ignore the rotated refresh token: this response must never become an app session.
        accessToken = await response.json().then((body: { access_token?: unknown }) =>
            typeof body.access_token === 'string' ? body.access_token : null);
        if (signal.aborted) { accessToken = null; return; }
        if (!accessToken) return;
        await fetch(`${config.supabaseUrl}/auth/v1/logout?scope=local`, {
            method: 'POST', signal,
            headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
        });
    } catch { /* Best effort; failure discards the token, just like success or the 30 s cap. */ }
    finally { discard(); }
}
