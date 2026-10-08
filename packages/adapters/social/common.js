// Shared transport for the additional native adapters. Errors never contain
// provider payloads (which can include credentials or signed media URLs).
export async function jsonRequest(url, init = {}, fetcher = fetch) {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) throw new Error(`provider_request_failed_${response.status}`);
    return data;
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
export const jsonBody = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export function appConfig(env, prefix) {
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    return typeof clientId === 'string' && /^[A-Za-z0-9_.-]{5,160}$/.test(clientId)
        && typeof clientSecret === 'string' && clientSecret.length >= 8 ? { clientId, clientSecret } : null;
}
export function authorizeUrl(endpoint, cfg, { redirectUri, state }, scopes, extra = {}) {
    if (!cfg || new URL(redirectUri).protocol !== 'https:') throw new Error('invalid_oauth_config');
    const url = new URL(endpoint);
    Object.entries({ response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri,
        state, scope: scopes.join(' '), ...extra }).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
}
export async function formToken(endpoint, params, fetcher = fetch, headers = {}) {
    return jsonRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(params).toString() }, fetcher);
}
export function tokenResult(data, fallbackRefresh = null) {
    if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('invalid_access_token');
    const seconds = Number(data.expires_in);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('invalid_token_expiry');
    return { accessToken: data.access_token, refreshToken: data.refresh_token || fallbackRefresh,
        expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
}
export function requireImage(mediaType) {
    if (mediaType !== 'image') throw new Error('unsupported_media_type');
}

// Bound image buffering before upload, including responses without Content-Length.
export async function readImage(url, maxBytes, fetcher = fetch) {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('unsupported_image');
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('image_too_large');
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) throw new Error('image_too_large');
            chunks.push(value);
        }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, mime };
}
