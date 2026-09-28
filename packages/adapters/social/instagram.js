// Instagram Graph API adapter (via Facebook Login) — ADR-0061 §2.1
// "adapters, not SDKs": plain fetch, no Meta SDK on the SSR graph.
//
// v1 scopes (OAuth review runbook §6.2): instagram_basic,
// instagram_content_publish, pages_show_list, pages_read_engagement.
// Publishing requires the connected Instagram account to be a
// Business/Creator account linked to a Facebook Page — this adapter
// resolves that chain (Pages → linked IG Business Account) rather than
// assuming a direct Instagram login.

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;
export const INSTAGRAM_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'];

/** Loads and validates Meta app config from Worker secrets. Returns null
 * on any misconfiguration — callers degrade to a clean 503, never a
 * throw. */
export function instagramConfig(env = process.env) {
    const appId = env.META_APP_ID || '';
    const appSecret = env.META_APP_SECRET || '';
    if (!/^[0-9]{6,20}$/.test(appId) || appSecret.length < 16) return null;
    return { appId, appSecret };
}

/** Builds the Facebook OAuth authorize URL. redirectUri must already be
 * built from PUBLIC_HOST by the caller — this function never constructs
 * it from request input. codeChallenge is the client-generated PKCE
 * S256 challenge (technical spec §2.7); the verifier never reaches this
 * adapter or leaves the browser. */
export function buildAuthorizeUrl(cfg, { redirectUri, state, codeChallenge }) {
    if (!redirectUri || !redirectUri.startsWith('https://')) throw new Error('invalid_redirect_uri');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge || '')) throw new Error('invalid_code_challenge');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', cfg.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('response_type', 'code');
    return url.toString();
}

/** Exchanges an authorization code (+ PKCE verifier) for a short-lived
 * user access token, then immediately swaps it for a long-lived one
 * (Meta requires this second step for durable server-side tokens). */
export async function exchangeCodeForToken(cfg, { code, codeVerifier, redirectUri }, fetcher = fetch) {
    const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', cfg.appId);
    tokenUrl.searchParams.set('client_secret', cfg.appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('code_verifier', codeVerifier);
    const shortLived = await getJson(tokenUrl, fetcher);
    if (!shortLived || typeof shortLived.access_token !== 'string') throw new Error('token_exchange_failed');

    const longLivedUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', cfg.appId);
    longLivedUrl.searchParams.set('client_secret', cfg.appSecret);
    longLivedUrl.searchParams.set('fb_exchange_token', shortLived.access_token);
    const longLived = await getJson(longLivedUrl, fetcher);
    if (!longLived || typeof longLived.access_token !== 'string') throw new Error('token_exchange_failed');

    const expiresInSec = Number.isFinite(longLived.expires_in) ? longLived.expires_in : 60 * 24 * 3600; // ~60 days is Meta's typical long-lived TTL
    return {
        accessToken: longLived.access_token,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Resolves the connected user's Facebook Pages and returns the first
 * one with a linked Instagram Business Account (v1: single-account
 * selection; a picker across multiple linked accounts is a later UX
 * slice, not a foundation concern). Throws NO_LINKED_INSTAGRAM_ACCOUNT
 * if none of the user's Pages have one — this is a real, expected user
 * error (personal IG accounts can't be connected), not a system fault. */
export async function fetchConnectedAccount(accessToken, fetcher = fetch) {
    const pagesUrl = new URL(`${GRAPH_BASE}/me/accounts`);
    pagesUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account');
    pagesUrl.searchParams.set('access_token', accessToken);
    const pages = await getJson(pagesUrl, fetcher);
    const withInstagram = (pages && pages.data || []).find((p) => p.instagram_business_account && p.instagram_business_account.id);
    if (!withInstagram) {
        const err = new Error('no_linked_instagram_account');
        err.code = 'NO_LINKED_INSTAGRAM_ACCOUNT';
        throw err;
    }

    const igId = withInstagram.instagram_business_account.id;
    const profileUrl = new URL(`${GRAPH_BASE}/${igId}`);
    profileUrl.searchParams.set('fields', 'username,profile_picture_url');
    profileUrl.searchParams.set('access_token', withInstagram.access_token);
    const profile = await getJson(profileUrl, fetcher);

    return {
        externalAccountId: igId,
        displayName: profile && profile.username ? `@${profile.username}` : withInstagram.name,
        avatarUrl: (profile && profile.profile_picture_url) || null,
        // The Page's own access token is what Instagram content-publish
        // calls actually use, not the user token exchanged above — Meta's
        // own API shape, not a choice made here.
        pageAccessToken: withInstagram.access_token,
    };
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
