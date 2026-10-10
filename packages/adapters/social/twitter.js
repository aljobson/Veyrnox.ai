// X (Twitter) API v2 adapter — ADR-0061 §2.1 "adapters, not SDKs": plain
// fetch, no X SDK on the SSR graph. Verified against docs.x.com (OAuth 2.0
// Authorization Code with PKCE, the chunked media upload quickstart, and
// Create or Edit Post) 2026-09-28 — X migrated media upload off the old
// v1.1-style command=INIT/APPEND/FINALIZE protocol onto dedicated v2 REST
// paths this same month (docs.x.com/x-api/media/quickstart/media-upload-
// chunked); anything referencing upload.twitter.com or command= query
// params for media is stale.
//
// The DB's own network value is 'twitter' (packages/db/schema/supabase/
// 0154_social_publish_foundation.sql's CHECK), not 'x' — this file and
// every route under it use that value throughout, "X" only names the
// product in comments and UI copy.
//
// v1 scopes: tweet.read, tweet.write, users.read, offline.access,
// media.write. Unlike LinkedIn, X requires PKCE at its own authorize
// endpoint (code_challenge/code_challenge_method are mandatory query
// params, not just a Veyrnox-side contract), and a confidential client's
// token exchange authenticates with HTTP Basic (client_id:client_secret),
// not a client_secret body parameter.

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API_BASE = 'https://api.x.com';
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];
// docs.x.com: "Keep each segment at or below 5 MB (server max 8 MB)". A
// single social post image is always well under this, so this adapter
// only ever sends one append call (segment_index 0) and refuses anything
// that would need real chunking, rather than half-implementing it.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Loads and validates X app config from Worker secrets. Returns null on
 * any misconfiguration — callers degrade to a clean 503, never a throw. */
export function xConfig(env = process.env) {
    const clientId = env.X_CLIENT_ID || '';
    const clientSecret = env.X_CLIENT_SECRET || '';
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(clientId) || clientSecret.length < 8) return null;
    return { clientId, clientSecret };
}

/** Builds X's OAuth authorize URL. redirectUri must already be built from
 * PUBLIC_HOST by the caller — this function never constructs it from
 * request input. codeChallenge is the client-generated PKCE S256
 * challenge; X requires it (unlike LinkedIn), so it is forwarded here. */
export function buildAuthorizeUrl(cfg, { redirectUri, state, codeChallenge }) {
    if (!redirectUri || !redirectUri.startsWith('https://')) throw new Error('invalid_redirect_uri');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge || '')) throw new Error('invalid_code_challenge');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', X_SCOPES.join(' '));
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
}

/** Exchanges an authorization code (+ PKCE verifier) for an access token.
 * A confidential client authenticates with HTTP Basic auth, not a
 * client_secret body field (docs.x.com's own distinction between
 * confidential and public clients). */
export async function exchangeCodeForToken(cfg, { code, codeVerifier, redirectUri }, fetcher = fetch) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier,
    });
    const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
    const res = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.access_token !== 'string') {
        throw new Error((data && (data.error_description || data.error)) || `token_exchange_failed_${res.status}`);
    }
    const expiresInSec = Number.isFinite(data.expires_in) ? data.expires_in : 7200; // X's typical 2h access token
    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Refreshes an access token with the refresh grant (offline.access). X
 * rotates the refresh token on every use, so the caller must store the one
 * returned here, or the next refresh fails. Same Basic authentication as the
 * code exchange; X's access tokens last about two hours (audit 2026-10-09,
 * S-04: before this nothing refreshed them, so a post scheduled more than two
 * hours after connecting failed every attempt). */
export async function refreshAccessToken(cfg, refreshToken, fetcher = fetch) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId });
    const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
    const res = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.access_token !== 'string' || !data.access_token) {
        throw new Error((data && (data.error_description || data.error)) || `x_token_refresh_failed_${res.status}`);
    }
    const expiresInSec = Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 7200;
    return {
        accessToken: data.access_token,
        // Rotated on every refresh; a response without one keeps the old token usable.
        refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : refreshToken,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Resolves the connected account's identity (GET /2/users/me). The
 * numeric `id` is externalAccountId; `username` is kept separately since
 * publishPost needs it to build a real permalink (X's create-post
 * response carries only the tweet id, no URL). */
export async function fetchConnectedAccount(accessToken, fetcher = fetch) {
    const url = new URL(`${API_BASE}/2/users/me`);
    url.searchParams.set('user.fields', 'profile_image_url');
    const res = await fetcher(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    const data = body && body.data;
    if (!res.ok || !data || typeof data.id !== 'string') {
        throw new Error((body && body.title) || `users_me_failed_${res.status}`);
    }
    return {
        externalAccountId: data.id,
        username: data.username || null,
        displayName: data.username ? `@${data.username}` : data.name || null,
        avatarUrl: data.profile_image_url || null,
    };
}

/** Publishes a single-image post: the v2 chunked media upload flow
 * (initialize → one append → finalize, polling STATUS only if X reports
 * processing isn't already done), then POST /2/tweets referencing the
 * uploaded media. Image posts only, matching every other network's v1 MVP
 * scope. Throws UNSUPPORTED_MEDIA_TYPE for anything else so the caller
 * fails the target cleanly instead of silently dropping it. `username` is
 * required to build the permalink — pass the value fetchConnectedAccount
 * returned at connect time. */
export async function publishPost(accessToken, { username, caption, mediaType, mediaUrl }, fetcher = fetch) {
    if (mediaType !== 'image') {
        const err = new Error(`unsupported media type: ${mediaType}`);
        err.code = 'UNSUPPORTED_MEDIA_TYPE';
        throw err;
    }
    const auth = { Authorization: `Bearer ${accessToken}` };

    const sourceRes = await fetcher(mediaUrl, { signal: AbortSignal.timeout(20000) });
    if (!sourceRes.ok) throw new Error(`source_media_fetch_failed_${sourceRes.status}`);
    const bytes = new Uint8Array(await sourceRes.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('image_too_large_for_single_append');
    const contentType = sourceRes.headers.get('content-type') || 'image/jpeg';

    const initRes = await fetcher(`${API_BASE}/2/media/upload/initialize`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: contentType, total_bytes: bytes.byteLength, media_category: 'tweet_image' }),
        signal: AbortSignal.timeout(15000),
    });
    const init = await initRes.json().catch(() => null);
    const mediaId = init && init.data && init.data.id;
    if (!initRes.ok || !mediaId) throw new Error((init && init.title) || `media_init_failed_${initRes.status}`);

    const form = new FormData();
    form.set('segment_index', '0');
    form.set('media', new Blob([bytes], { type: contentType }));
    const appendRes = await fetcher(`${API_BASE}/2/media/upload/${mediaId}/append`, {
        method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(30000),
    });
    if (!appendRes.ok) throw new Error(`media_append_failed_${appendRes.status}`);

    const finalizeRes = await fetcher(`${API_BASE}/2/media/upload/${mediaId}/finalize`, {
        method: 'POST', headers: auth, signal: AbortSignal.timeout(15000),
    });
    const finalize = await finalizeRes.json().catch(() => null);
    if (!finalizeRes.ok) throw new Error((finalize && finalize.title) || `media_finalize_failed_${finalizeRes.status}`);

    // A tweet_image normally finalizes synchronously (no processing_info
    // at all). Only poll if X reports it isn't done yet, bounded so a
    // stuck upload can never hold a sweep tick open indefinitely.
    let state = finalize && finalize.data && finalize.data.processing_info && finalize.data.processing_info.state;
    for (let attempt = 0; state && state !== 'succeeded' && state !== 'failed' && attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const statusRes = await fetcher(`${API_BASE}/2/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`, {
            headers: auth, signal: AbortSignal.timeout(10000),
        });
        const status = await statusRes.json().catch(() => null);
        state = status && status.data && status.data.processing_info && status.data.processing_info.state;
    }
    if (state === 'failed') throw new Error('media_processing_failed');

    const postRes = await fetcher(`${API_BASE}/2/tweets`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: caption || '', media: { media_ids: [mediaId] } }),
        signal: AbortSignal.timeout(15000),
    });
    const posted = await postRes.json().catch(() => null);
    const postId = posted && posted.data && posted.data.id;
    if (!postRes.ok || !postId) throw new Error((posted && posted.title) || `post_create_failed_${postRes.status}`);

    return {
        platformPostId: postId,
        // /2/tweets returns no URL. i/web/status/ is X's own long-standing,
        // handle-agnostic permalink form (what share buttons use) — used
        // here only as a fallback; the real handle-qualified URL is built
        // when `username` is available.
        platformPostUrl: username ? `https://x.com/${username}/status/${postId}` : `https://x.com/i/web/status/${postId}`,
    };
}
