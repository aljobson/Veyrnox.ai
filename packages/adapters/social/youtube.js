// YouTube (Google) adapter — ADR-0061 §2.1 "adapters, not SDKs": plain
// fetch, no Google API client library on the SSR graph. Verified against
// developers.google.com (OAuth 2.0 Web Server flow, YouTube Data API v3
// channels.list) 2026-09-28.
//
// Connect flow only in this slice, by design (confirmed with the user
// beforehand, mirroring the TikTok precedent): YouTube has no API for a
// static image post — only video upload, which needs Google's resumable
// chunked-upload protocol. That is a materially different, larger
// adapter shape than every other network here's "create then publish"
// call, and needs its own scheduling-engine design pass (a video upload
// can run to many minutes, nothing like a single sweep tick). Publishing
// is not built here.
//
// Scope is deliberately read-only (youtube.readonly) for what this slice
// actually does — resolving the connected channel's identity — rather
// than pre-requesting youtube.upload for a capability that doesn't exist
// yet. Google, like LinkedIn and TikTok, requires re-consent on a scope
// change, so connecting again will be needed once a later slice adds
// upload access for real publishing.
//
// This is a separate OAuth client from Supabase's own Google Sign-In
// provider (AuthGate.jsx) — different product, different consent, no
// shared credentials.

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com';
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

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
