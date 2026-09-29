// Instagram adapter — Instagram API with Instagram Login ("Business Login
// for Instagram") — ADR-0061 §2.1 "adapters, not SDKs": plain fetch, no
// Meta SDK on the SSR graph. Verified against Meta's own docs
// (developers.facebook.com/documentation/instagram-platform/instagram-api-
// with-instagram-login/business-login) 2026-09-28, cross-checked against
// @opencoredev/social-sdk's independent implementation of the same flow.
//
// This replaces the earlier Facebook Login + Pages-resolution chain
// (client_id/client_secret are unchanged — the same Meta App works for
// both login surfaces). Instagram Login authorizes directly against a
// Business or Creator Instagram account with no linked Facebook Page
// required at all, which removes the whole Pages → linked-IG-account
// resolution step and its NO_LINKED_INSTAGRAM_ACCOUNT failure mode: a
// personal (non-Business/Creator) account simply cannot complete this
// flow, so that case now surfaces as an ordinary connect failure instead
// of a distinct, expected conflict.
//
// v1 scopes: instagram_business_basic, instagram_business_content_publish
// — the newer scope names Meta introduced for this login surface (the
// old instagram_basic/instagram_content_publish/pages_* scopes belonged
// to the Facebook Login chain this replaces). No PKCE: Meta's own
// documented parameters for this authorize endpoint are client_id,
// redirect_uri, response_type, scope, state — codeChallenge is still
// accepted and validated at the route layer purely so
// app/lib/socialConnectClient.js's connect/callback contract stays
// identical across every network (same reasoning as the LinkedIn adapter).

const GRAPH_API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;
const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const SHORT_LIVED_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_LIVED_TOKEN_URL = 'https://graph.instagram.com/access_token';
export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

/** Loads and validates Meta app config from Worker secrets. Returns null
 * on any misconfiguration — callers degrade to a clean 503, never a
 * throw. Same Meta App (and so the same META_APP_ID/META_APP_SECRET) as
 * the Facebook Login surface this adapter no longer uses. */
export function instagramConfig(env = process.env) {
    const appId = env.META_APP_ID || '';
    const appSecret = env.META_APP_SECRET || '';
    if (!/^[0-9]{6,20}$/.test(appId) || appSecret.length < 16) return null;
    return { appId, appSecret };
}

/** Builds Instagram's OAuth authorize URL. redirectUri must already be
 * built from PUBLIC_HOST by the caller — this function never constructs
 * it from request input. */
export function buildAuthorizeUrl(cfg, { redirectUri, state }) {
    if (!redirectUri || !redirectUri.startsWith('https://')) throw new Error('invalid_redirect_uri');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', cfg.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
    url.searchParams.set('state', state);
    return url.toString();
}

/** Exchanges an authorization code for a short-lived user access token,
 * then immediately swaps it for a long-lived one (~60 days) — Instagram
 * Login's own two-step requirement for durable server-side tokens, same
 * shape as before, different endpoints. The short-lived response is
 * `{ data: [{ access_token, user_id, permissions }] }` — Meta's own
 * array-wrapped shape for this specific endpoint, not the plain object
 * every other token endpoint here returns. */
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const shortLived = await postForm(SHORT_LIVED_TOKEN_URL, {
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
    }, fetcher);
    const first = shortLived && Array.isArray(shortLived.data) ? shortLived.data[0] : null;
    if (!first || typeof first.access_token !== 'string') throw new Error('token_exchange_failed');

    const longLivedUrl = new URL(LONG_LIVED_TOKEN_URL);
    longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longLivedUrl.searchParams.set('client_secret', cfg.appSecret);
    longLivedUrl.searchParams.set('access_token', first.access_token);
    const longLived = await getJson(longLivedUrl, fetcher);
    if (!longLived || typeof longLived.access_token !== 'string') throw new Error('token_exchange_failed');

    const expiresInSec = Number.isFinite(longLived.expires_in) ? longLived.expires_in : 60 * 24 * 3600; // ~60 days is Meta's typical long-lived TTL
    return {
        accessToken: longLived.access_token,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Resolves the connected Instagram Business/Creator account directly —
 * no Facebook Page or business-discovery chain to walk, unlike the
 * Facebook Login surface this adapter replaces. A personal (non-
 * Business/Creator) account cannot complete authorization on this login
 * surface at all (Meta's own documented constraint), so that case never
 * reaches this function as a distinct error to handle here. */
export async function fetchConnectedAccount(accessToken, fetcher = fetch) {
    const url = new URL(`${GRAPH_BASE}/me`);
    url.searchParams.set('fields', 'id,username,profile_picture_url');
    url.searchParams.set('access_token', accessToken);
    const profile = await getJson(url, fetcher);
    if (!profile || typeof profile.id !== 'string') throw new Error('profile_fetch_failed');

    return {
        externalAccountId: profile.id,
        displayName: profile.username ? `@${profile.username}` : null,
        avatarUrl: profile.profile_picture_url || null,
    };
}

/** Publishes a single-image post to the connected Instagram account
 * (Content Publishing API: create a media container, then publish it).
 * Image posts only — Instagram requires polling a container's
 * status_code to FINISHED before a video/Reel container can be published,
 * which needs to survive across sweep runs (not a single cron tick); that
 * two-step flow is a follow-up, not built here. Throws
 * UNSUPPORTED_MEDIA_TYPE for anything else so the caller fails the target
 * cleanly instead of silently dropping it. */
export async function publishPost(accessToken, { externalAccountId, caption, mediaType, mediaUrl }, fetcher = fetch) {
    if (mediaType !== 'image') {
        const err = new Error(`unsupported media type: ${mediaType}`);
        err.code = 'UNSUPPORTED_MEDIA_TYPE';
        throw err;
    }
    const containerUrl = new URL(`${GRAPH_BASE}/${externalAccountId}/media`);
    containerUrl.searchParams.set('image_url', mediaUrl);
    if (caption) containerUrl.searchParams.set('caption', caption);
    containerUrl.searchParams.set('access_token', accessToken);
    const container = await postJson(containerUrl, fetcher);
    if (!container || typeof container.id !== 'string') throw new Error('media_container_failed');

    const publishUrl = new URL(`${GRAPH_BASE}/${externalAccountId}/media_publish`);
    publishUrl.searchParams.set('creation_id', container.id);
    publishUrl.searchParams.set('access_token', accessToken);
    const published = await postJson(publishUrl, fetcher);
    if (!published || typeof published.id !== 'string') throw new Error('media_publish_failed');

    // The publish response carries only the media id, not its public
    // shortcode URL — a permalink lookup is the only correct source for
    // that. A failure here still means the post itself went out.
    const permalinkUrl = new URL(`${GRAPH_BASE}/${published.id}`);
    permalinkUrl.searchParams.set('fields', 'permalink');
    permalinkUrl.searchParams.set('access_token', accessToken);
    const permalink = await getJson(permalinkUrl, fetcher).catch(() => null);

    return {
        platformPostId: published.id,
        platformPostUrl: (permalink && permalink.permalink) || null,
    };
}

async function postForm(url, params, fetcher) {
    const res = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        const message = (body && body.error_message) || (body && body.error && body.error.message) || `graph_api_error_${res.status}`;
        throw new Error(message);
    }
    return body;
}

async function postJson(url, fetcher) {
    const res = await fetcher(url.toString(), { method: 'POST', signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        const message = (body && body.error && body.error.message) || `graph_api_error_${res.status}`;
        throw new Error(message);
    }
    return body;
}

async function getJson(url, fetcher) {
    const res = await fetcher(url.toString(), { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        const message = (body && body.error && body.error.message) || `graph_api_error_${res.status}`;
        throw new Error(message);
    }
    return body;
}
