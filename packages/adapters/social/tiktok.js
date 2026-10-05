// TikTok adapter — ADR-0061 §2.1 "adapters, not SDKs": plain fetch, no
// TikTok SDK on the SSR graph. Verified against developers.tiktok.com
// (Web OAuth, User Access Token Management, Get User Info) 2026-09-28.
//
// Publishing (ADR-0061 Phase 5) uses TikTok's Content Posting API's own
// async shape directly, via the sweep's claim→submit→poll→complete
// engine: the init call only returns a publish_id, and the actual outcome
// only appears later from a separate status-poll endpoint with no fixed
// timeline.
//
// Publish mode is MEDIA_UPLOAD, not DIRECT_POST, by deliberate choice
// (confirmed with the user, live docs verified 2026-09-29): this app's
// TikTok developer app hasn't passed TikTok's Content Posting API audit
// yet, and an unaudited app's DIRECT_POST is silently forced to
// SELF_ONLY (private) regardless of what privacy_level is requested.
// MEDIA_UPLOAD instead hands the content to the creator's own TikTok
// inbox as a draft they finish manually — the honest behavior for a
// "Publish" button pre-audit, since it never silently makes something
// private that looked like it published successfully. This needs
// video.upload scope, not video.publish (that's DIRECT_POST's scope,
// for a later upgrade once the app is audited).
//
// PULL_FROM_URL media requires TikTok to DNS-verify the domain a photo
// URL points at — our R2 presigned URLs live on a Cloudflare-owned host
// we can't verify, so publishPost is handed an already-proxied URL (see
// app/media/social/[token]/route.js) by the sweep, not a raw R2 link.
//
// Scope also keeps user.info.basic for identity resolution.

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API_BASE = 'https://open.tiktokapis.com';
export const TIKTOK_SCOPES = ['user.info.basic', 'video.upload'];
export const TIKTOK_ANALYTICS_SCOPES = ['user.info.stats', 'video.list'];

export function tiktokScopes(cfg) {
    return cfg?.analyticsScopeEnabled ? [...TIKTOK_SCOPES, ...TIKTOK_ANALYTICS_SCOPES] : [...TIKTOK_SCOPES];
}

function grantedScopes(scope) {
    return typeof scope === 'string' ? [...new Set(scope.split(',').map((s) => s.trim()))]
        .filter((s) => [...TIKTOK_SCOPES, ...TIKTOK_ANALYTICS_SCOPES].includes(s)) : [];
}

/** Loads and validates TikTok app config from Worker secrets. Returns
 * null on any misconfiguration — callers degrade to a clean 503, never a
 * throw. TikTok's own term is "client_key", not "client_id". */
export function tiktokConfig(env = process.env) {
    const clientKey = env.TIKTOK_CLIENT_KEY || '';
    const clientSecret = env.TIKTOK_CLIENT_SECRET || '';
    if (!/^[A-Za-z0-9]{6,40}$/.test(clientKey) || clientSecret.length < 8) return null;
    return { clientKey, clientSecret, ...(env.TIKTOK_ANALYTICS_SCOPE_ENABLED === 'true' ? { analyticsScopeEnabled: true } : {}) };
}

/** Builds TikTok's OAuth authorize URL. redirectUri must already be built
 * from PUBLIC_HOST by the caller — this function never constructs it
 * from request input. TikTok's own docs do not document PKCE support for
 * a web (confidential) client, so codeChallenge is accepted only for
 * contract parity with every other network's connect route and never
 * forwarded here (matches how the LinkedIn adapter handles the same
 * situation). Scope is comma-separated — TikTok's own convention, unlike
 * every other network here, which use a space. */
export function buildAuthorizeUrl(cfg, { redirectUri, state }) {
    if (!redirectUri || !redirectUri.startsWith('https://')) throw new Error('invalid_redirect_uri');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_key', cfg.clientKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', tiktokScopes(cfg).join(','));
    return url.toString();
}

/** Exchanges an authorization code for an access token. TikTok issues a
 * refresh token (365-day lifespan) alongside the 24h access token. */
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const body = new URLSearchParams({
        client_key: cfg.clientKey,
        client_secret: cfg.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    });
    const res = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.access_token !== 'string') {
        throw new Error((data && data.error_description) || `token_exchange_failed_${res.status}`);
    }
    const expiresInSec = Number.isFinite(data.expires_in) ? data.expires_in : 86400; // TikTok's documented 24h access token
    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
        scopes: grantedScopes(data.scope),
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Resolves the connected account's identity (GET /v2/user/info/).
 * `open_id` is externalAccountId — a per-app stable id, TikTok's own
 * documented identifier for this purpose. */
export async function fetchConnectedAccount(accessToken, fetcher = fetch) {
    const url = new URL(`${API_BASE}/v2/user/info/`);
    url.searchParams.set('fields', 'open_id,display_name,avatar_url');
    const res = await fetcher(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    const user = body && body.data && body.data.user;
    if (!res.ok || (body && body.error && body.error.code && body.error.code !== 'ok') || !user || typeof user.open_id !== 'string') {
        throw new Error((body && body.error && body.error.message) || `user_info_failed_${res.status}`);
    }
    return {
        externalAccountId: user.open_id,
        displayName: user.display_name || null,
        avatarUrl: user.avatar_url || null,
    };
}

/** Submits a photo post via MEDIA_UPLOAD (POST /v2/post/publish/content/init/)
 * — draft-to-inbox mode, not an automated publish (see this file's own
 * header for why). `photoUrl` must already be served from our own
 * DNS-verified domain (never a raw R2 URL) — see
 * app/media/social/[token]/route.js. Returns { publishId } immediately;
 * the actual outcome is only known from checkPublishStatus later.
 * `isAigc: true` is deliberate, not a placeholder default — every image
 * this platform publishes is AI-generated, and TikTok's content policy
 * requires that disclosure. */
export async function submitMediaUploadPost(accessToken, { photoUrl, caption }, fetcher = fetch) {
    const res = await fetcher(`${API_BASE}/v2/post/publish/content/init/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            media_type: 'PHOTO',
            post_mode: 'MEDIA_UPLOAD',
            post_info: {
                title: (caption || '').slice(0, 90),
                description: (caption || '').slice(0, 4000),
                disable_comment: false,
                auto_add_music: false,
                brand_content_toggle: false,
                brand_organic_toggle: false,
            },
            source_info: {
                source: 'PULL_FROM_URL',
                photo_images: [photoUrl],
                photo_cover_index: 0,
            },
            is_aigc: true,
        }),
        signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    const publishId = body && body.data && body.data.publish_id;
    if (!res.ok || (body && body.error && body.error.code && body.error.code !== 'ok') || typeof publishId !== 'string') {
        throw new Error((body && body.error && body.error.message) || `publish_init_failed_${res.status}`);
    }
    return { publishId };
}

/** Polls a publish attempt's outcome (POST /v2/post/publish/status/fetch/).
 * Rate-limited by TikTok to 30 requests/minute per access token — well
 * within what one sweep tick needs. */
export async function checkPublishStatus(accessToken, publishId, fetcher = fetch) {
    const res = await fetcher(`${API_BASE}/v2/post/publish/status/fetch/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    const data = body && body.data;
    if (!res.ok || (body && body.error && body.error.code && body.error.code !== 'ok') || !data || typeof data.status !== 'string') {
        throw new Error((body && body.error && body.error.message) || `status_fetch_failed_${res.status}`);
    }
    return {
        status: data.status,
        failReason: data.fail_reason || null,
        // TikTok's own field name — verbatim, not a typo we introduced.
        publicPostIds: Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [],
    };
}


/** TikTok may rotate refresh tokens. Persist both tokens before using the
 * replacement access token. Verified 2026-10-03 against TikTok's User
 * Access Token Management reference. Errors never include vendor payloads. */
export async function refreshAccessToken(cfg, refreshToken, fetcher = fetch) {
    const res = await fetcher(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret,
            grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`tiktok_token_refresh_failed_${res.status}`);
    if (data?.error || typeof data?.access_token !== 'string' || !data.access_token ||
        typeof data.refresh_token !== 'string' || !data.refresh_token ||
        typeof data.open_id !== 'string' || !data.open_id || typeof data.scope !== 'string' ||
        !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) {
        throw new Error('tiktok_token_refresh_invalid_response');
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        externalAccountId: data.open_id, scopes: grantedScopes(data.scope) };
}

// Display API public video statistics. One identity/statistics read, then
// up to three pages (20 + 20 + 10) for the latest 50 public videos.
// References: TikTok Get User Info, List Videos, Video Object, 2026-10-03.
export async function fetchAnalytics(accessToken, { externalAccountId, scopes = [] } = {}, fetcher = fetch) {
    const stats = scopes.includes('user.info.stats');
    const videos = scopes.includes('video.list');
    if (!stats && !videos) throw new Error('tiktok_analytics_permission_required');
    const profileUrl = new URL(`${API_BASE}/v2/user/info/`);
    profileUrl.searchParams.set('fields', stats ? 'open_id,follower_count,following_count,likes_count,video_count' : 'open_id');
    const profile = await analyticsRequest(profileUrl, accessToken, {}, fetcher);
    const user = profile?.user;
    if (!externalAccountId || user?.open_id !== externalAccountId) throw new Error('tiktok_account_mismatch');
    const metrics = stats ? analyticsNumbers({ followers: user.follower_count, following: user.following_count,
        likes: user.likes_count, posts_count: user.video_count }) : {};
    const posts = [];
    if (!videos) return { metrics, posts };
    const videoUrl = new URL(`${API_BASE}/v2/video/list/`);
    videoUrl.searchParams.set('fields', 'id,create_time,title,video_description,share_url,view_count,like_count,comment_count,share_count');
    let cursor;
    const cursors = new Set();
    const seen = new Set();
    for (let page = 0; page < 3; page++) {
        const data = await analyticsRequest(videoUrl, accessToken, { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_count: page === 2 ? 10 : 20, ...(cursor === undefined ? {} : { cursor }) }),
        }, fetcher);
        if (!Array.isArray(data?.videos)) throw new Error('tiktok_analytics_invalid_response');
        for (const video of data.videos.slice(0, page === 2 ? 10 : 20)) {
            if (typeof video?.id !== 'string' || !/^\d{1,30}$/.test(video.id) || seen.has(video.id) ||
                !Number.isSafeInteger(video.create_time) || video.create_time <= 0 || video.create_time > 253402300799) continue;
            seen.add(video.id);
            posts.push({ id: video.id, published_at: new Date(video.create_time * 1000).toISOString(), type: 'video',
                caption: typeof video.video_description === 'string' ? video.video_description.slice(0, 500)
                    : typeof video.title === 'string' ? video.title.slice(0, 500) : null,
                permalink: analyticsLink(video.share_url),
                metrics: analyticsNumbers({ views: video.view_count, likes: video.like_count,
                    comments: video.comment_count, shares: video.share_count }),
            });
        }
        if (data.has_more !== true || page === 2) break;
        if (!Number.isSafeInteger(data.cursor) || data.cursor < 0 || cursors.has(data.cursor)) {
            throw new Error('tiktok_analytics_invalid_cursor');
        }
        cursor = data.cursor;
        cursors.add(cursor);
    }
    return { metrics, posts };
}

async function analyticsRequest(url, accessToken, init, fetcher) {
    const res = await fetcher(url.toString(), { ...init,
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`tiktok_analytics_failed_${res.status}`);
    if (body?.error?.code !== 'ok' || !body?.data) throw new Error('tiktok_analytics_invalid_response');
    return body.data;
}

function analyticsNumbers(fields) {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => Number.isSafeInteger(value) && value >= 0));
}

function analyticsLink(value) {
    if (typeof value !== 'string' || value.length > 500) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'www.tiktok.com' || url.hostname === 'tiktok.com')
            && !url.username && !url.password ? url.toString() : null;
    } catch { return null; }
}
