// TikTok adapter — ADR-0061 §2.1 "adapters, not SDKs": plain fetch, no
// TikTok SDK on the SSR graph. Verified against developers.tiktok.com
// (Web OAuth, User Access Token Management, Get User Info) 2026-09-28.
//
// Connect flow only in this slice — no publishPost. TikTok's Content
// Posting API is confirmed asynchronous even for photo posts: the init
// call only returns a publish_id, and the actual outcome (PUBLISH_COMPLETE
// or FAILED) only appears from a separate status-poll endpoint with no
// fixed timeline (video posts alone commonly take 30s-2min). That doesn't
// fit this app's current single-tick claim/dispatch/complete sweep — a
// bounded in-call poll risks marking a slow-but-real success as failed,
// which the retry path would then resubmit, posting the same content
// twice to the user's real TikTok. Publishing needs its own slice adding
// a real two-phase dispatch state to social_post_targets, not built here.
//
// Scope is deliberately minimal for what this slice actually does
// (user.info.basic only) rather than pre-requesting video.publish for a
// capability that doesn't exist yet — TikTok, like LinkedIn, requires
// re-authentication on any scope change, so connecting again will be
// needed once a later slice adds video.publish for real publishing.

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API_BASE = 'https://open.tiktokapis.com';
export const TIKTOK_SCOPES = ['user.info.basic'];

/** Loads and validates TikTok app config from Worker secrets. Returns
 * null on any misconfiguration — callers degrade to a clean 503, never a
 * throw. TikTok's own term is "client_key", not "client_id". */
export function tiktokConfig(env = process.env) {
    const clientKey = env.TIKTOK_CLIENT_KEY || '';
    const clientSecret = env.TIKTOK_CLIENT_SECRET || '';
    if (!/^[A-Za-z0-9]{6,40}$/.test(clientKey) || clientSecret.length < 8) return null;
    return { clientKey, clientSecret };
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
    url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
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
