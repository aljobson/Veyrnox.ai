// YouTube (Google) adapter — ADR-0061 §2.1 "adapters, not SDKs": plain
// fetch, no Google API client library on the SSR graph. Verified against
// developers.google.com (OAuth 2.0 Web Server flow, YouTube Data API v3
// channels.list, resumable upload protocol) 2026-09-28/29.
//
// Publishing (ADR-0061 Phase 5) uses Google's resumable upload protocol:
// initResumableUpload gets a session URI, then uploadChunk is called
// repeatedly — once per sweep tick, not all at once — with a fresh
// mediaUrl (the R2 presign the sweep mints fresh every tick, since one
// upload can span many 5-minute ticks and outlive any single presigned
// URL). The session URI plus the last-confirmed byte offset is the only
// state that needs to survive between ticks (persisted in
// social_post_targets.provider_state) — confirmed against live docs that
// this genuinely works from separate, later HTTP requests, not just
// retries on one held-open connection.
//
// No PULL_FROM_URL-style server-side fetch exists on this API (confirmed
// against live docs) — unlike TikTok, we always proxy the bytes ourselves.
//
// Scope adds youtube.upload alongside the original youtube.readonly.
// Google, like LinkedIn and TikTok, requires re-consent on a scope
// change, so already-connected accounts need to reconnect before they
// can actually publish.
//
// This is a separate OAuth client from Supabase's own Google Sign-In
// provider (AuthGate.jsx) — different product, different consent, no
// shared credentials.

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com';
const UPLOAD_INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
export const YOUTUBE_SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
];
// Resumable-upload chunks must be a multiple of 256 KiB except the final
// one (confirmed current rule). 8 MiB keeps each sweep tick's chunk
// transfer well inside a Worker cron invocation's time budget.
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;

/** Loads and validates the YouTube OAuth client config from Worker
 * secrets. Returns null on any misconfiguration — callers degrade to a
 * clean 503, never a throw. Google client ids have their own recognizable
 * shape (numeric prefix + .apps.googleusercontent.com suffix). */
export function youtubeConfig(env = process.env) {
    const clientId = env.YOUTUBE_CLIENT_ID || '';
    const clientSecret = env.YOUTUBE_CLIENT_SECRET || '';
    if (!/^[0-9]+-[A-Za-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId) || clientSecret.length < 8) return null;
    return { clientId, clientSecret };
}

/** Builds Google's OAuth authorize URL. redirectUri must already be built
 * from PUBLIC_HOST by the caller — this function never constructs it
 * from request input. access_type=offline + prompt=consent are required
 * to get a refresh token on every grant, not just the member's first
 * authorization (Google's own documented behavior) — every other
 * network here that issues a refresh token gets one by default; Google
 * is the one that needs these two extra params for the same result. */
export function buildAuthorizeUrl(cfg, { redirectUri, state }) {
    if (!redirectUri || !redirectUri.startsWith('https://')) throw new Error('invalid_redirect_uri');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
}

/** Exchanges an authorization code for an access token. Google issues a
 * refresh token only because access_type=offline + prompt=consent were
 * requested above. */
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const body = new URLSearchParams({
        code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    const res = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.access_token !== 'string') {
        throw new Error((data && (data.error_description || data.error)) || `token_exchange_failed_${res.status}`);
    }
    const expiresInSec = Number.isFinite(data.expires_in) ? data.expires_in : 3600; // Google's typical 1h access token
    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Resolves the connected account's own channel (GET /youtube/v3/channels
 * ?mine=true). The channel id is externalAccountId — YouTube publishing
 * (when it exists) happens per-channel, not per-Google-account. Throws
 * NO_YOUTUBE_CHANNEL if the connected Google account has no channel at
 * all — a real, expected case (a personal Google account is not
 * automatically a YouTube creator), not a system fault. */
export async function fetchConnectedAccount(accessToken, fetcher = fetch) {
    const url = new URL(`${API_BASE}/youtube/v3/channels`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    const res = await fetcher(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error((body && body.error && body.error.message) || `channels_list_failed_${res.status}`);
    }
    const channel = body && Array.isArray(body.items) && body.items[0];
    if (!channel || typeof channel.id !== 'string') {
        const err = new Error('no_youtube_channel');
        err.code = 'NO_YOUTUBE_CHANNEL';
        throw err;
    }
    const thumbnails = (channel.snippet && channel.snippet.thumbnails) || {};
    return {
        externalAccountId: channel.id,
        displayName: (channel.snippet && channel.snippet.title) || null,
        avatarUrl: (thumbnails.default && thumbnails.default.url) || null,
    };
}

/** Refreshes an expired/expiring access token. Google issues no new
 * refresh token on this grant — the original one keeps working. */
export async function refreshAccessToken(cfg, refreshToken, fetcher = fetch) {
    const body = new URLSearchParams({
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
    });
    const res = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.access_token !== 'string') {
        throw new Error((data && (data.error_description || data.error)) || `token_refresh_failed_${res.status}`);
    }
    const expiresInSec = Number.isFinite(data.expires_in) ? data.expires_in : 3600;
    return { accessToken: data.access_token, expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString() };
}

/** Starts a resumable upload session (one videos.insert call — the only
 * step that costs YouTube Data API quota; every later chunk PUT and
 * status poll is free). Returns the session URI from the Location header
 * — that URI, not anything we construct, is what every later PUT targets. */
export async function initResumableUpload(accessToken, { title, description, privacyStatus, mimeType, totalBytes }, fetcher = fetch) {
    const res = await fetcher(UPLOAD_INIT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType || 'application/octet-stream',
            'X-Upload-Content-Length': String(totalBytes),
        },
        body: JSON.stringify({
            snippet: {
                title: (title || 'Veyrnox video').slice(0, 100),
                description: (description || '').slice(0, 5000),
                categoryId: '22', // People & Blogs — a reasonable default, no user-facing category picker yet
            },
            status: { privacyStatus: privacyStatus || 'public' },
        }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`upload_init_failed_${res.status}: ${text.slice(0, 200)}`);
    }
    const sessionUri = res.headers.get('location');
    if (!sessionUri) throw new Error('upload_init_missing_session_uri');
    return { sessionUri };
}

async function interpretUploadResponse(res, totalBytes) {
    if (res.status === 308) {
        const range = res.headers.get('range'); // e.g. "bytes=0-8388607"; absent means zero bytes received so far
        const bytesConfirmed = range ? Number(range.split('-')[1]) + 1 : 0;
        return { done: false, bytesConfirmed };
    }
    if (res.status === 200 || res.status === 201) {
        const body = await res.json().catch(() => null);
        if (!body || typeof body.id !== 'string') throw new Error('upload_complete_missing_video_id');
        return { done: true, bytesConfirmed: totalBytes, videoId: body.id };
    }
    if (res.status === 404 || res.status === 410) {
        const err = new Error('upload_session_expired');
        err.code = 'UPLOAD_SESSION_EXPIRED';
        throw err;
    }
    const text = await res.text().catch(() => '');
    throw new Error(`upload_chunk_failed_${res.status}: ${text.slice(0, 200)}`);
}

/** Asks the session what it actually has, without sending any bytes —
 * always call this before deciding what to upload next: a previous
 * tick's PUT may have succeeded even if the Worker died before recording
 * it, and this is the documented way to reconcile that safely. */
export async function probeUploadOffset(sessionUri, totalBytes, fetcher = fetch) {
    const res = await fetcher(sessionUri, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${totalBytes}` },
        signal: AbortSignal.timeout(10000),
    });
    return interpretUploadResponse(res, totalBytes);
}

/** Uploads one chunk — the source bytes come from `mediaUrl` (a fresh R2
 * presign the caller mints each tick) via an HTTP Range request, never
 * held in Worker memory ahead of time. `endByte` is inclusive. */
export async function uploadChunk(sessionUri, { mediaUrl, startByte, endByte, totalBytes, mimeType }, fetcher = fetch) {
    const rangeRes = await fetcher(mediaUrl, {
        headers: { Range: `bytes=${startByte}-${endByte}` },
        signal: AbortSignal.timeout(20000),
    });
    if (!rangeRes.ok) throw new Error(`source_fetch_failed_${rangeRes.status}`);
    const chunkBytes = new Uint8Array(await rangeRes.arrayBuffer());

    const res = await fetcher(sessionUri, {
        method: 'PUT',
        headers: {
            'Content-Length': String(chunkBytes.length),
            'Content-Range': `bytes ${startByte}-${endByte}/${totalBytes}`,
            'Content-Type': mimeType || 'application/octet-stream',
        },
        body: chunkBytes,
        signal: AbortSignal.timeout(30000),
    });
    return interpretUploadResponse(res, totalBytes);
}

/** Polls whether an uploaded video has finished YouTube's own server-side
 * processing — a completed byte upload is not yet necessarily live. */
export async function checkProcessingStatus(accessToken, videoId, fetcher = fetch) {
    const url = new URL(`${API_BASE}/youtube/v3/videos`);
    url.searchParams.set('part', 'status,processingDetails');
    url.searchParams.set('id', videoId);
    const res = await fetcher(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error && body.error.message) || `videos_list_failed_${res.status}`);
    const video = body && Array.isArray(body.items) && body.items[0];
    if (!video) throw new Error('video_not_found');
    return {
        uploadStatus: (video.status && video.status.uploadStatus) || null,
        processingStatus: (video.processingDetails && video.processingDetails.processingStatus) || null,
        failureReason: (video.processingDetails && video.processingDetails.processingFailureReason) || null,
        rejectionReason: (video.status && video.status.rejectionReason) || null,
    };
}
