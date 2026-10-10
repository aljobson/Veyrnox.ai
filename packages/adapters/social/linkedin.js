// LinkedIn adapter (OAuth2 + OpenID Connect + Posts/Images REST APIs) —
// ADR-0061 §2.1 "adapters, not SDKs": plain fetch, no LinkedIn SDK on the
// SSR graph. Verified against learn.microsoft.com/en-us/linkedin (the
// LinkedIn 3-Legged OAuth Flow, Sign In with LinkedIn using OpenID Connect,
// and Image API pages) 2026-09-28.
//
// v1 scopes: openid, profile, w_member_social — the least scopes needed for
// an OIDC identity plus posting on the member's own behalf. LinkedIn's
// authorize endpoint has no documented PKCE support (its own parameter
// table lists only response_type/client_id/redirect_uri/state/scope), so
// this adapter never forwards code_challenge/code_verifier to LinkedIn
// itself — codeChallenge is still accepted and validated at the route
// layer purely so app/lib/socialConnectClient.js's connect/callback
// contract stays identical across every network.
//
// redirect_uri must be registered with LinkedIn exactly, with no query
// string — LinkedIn's own docs: "Parameters are ignored" on a redirect
// URI. That's why every network here is told apart by a distinct PATH
// (/social/connect/callback/{network}), never a query param.

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API_BASE = 'https://api.linkedin.com';
// YYYYMM per LinkedIn's versioned-API convention; bump alongside their
// published deprecation schedule.
// Current supported version checked 2026-10-10:
// https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes
// 202509 was sunset on 2026-09-15.
const LINKEDIN_VERSION = '202609';
export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'];

/** Loads and validates LinkedIn app config from Worker secrets. Returns
 * null on any misconfiguration — callers degrade to a clean 503, never a
 * throw. */
export function linkedinConfig(env = process.env) {
    const clientId = env.LINKEDIN_CLIENT_ID || '';
    const clientSecret = env.LINKEDIN_CLIENT_SECRET || '';
    if (!/^[A-Za-z0-9]{6,40}$/.test(clientId) || clientSecret.length < 8) return null;
    return { clientId, clientSecret };
}

/** Builds LinkedIn's OAuth authorize URL. redirectUri must already be
 * built from PUBLIC_HOST by the caller — this function never constructs
 * it from request input. */
export function buildAuthorizeUrl(cfg, { redirectUri, state }) {
    if (!redirectUri || !redirectUri.startsWith('https://')) throw new Error('invalid_redirect_uri');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', LINKEDIN_SCOPES.join(' '));
    return url.toString();
}

/** Exchanges an authorization code for an access token. A refresh token
 * is optional and depends on the app's LinkedIn access; ordinary member
 * connections may need reauthorization after the access token expires. */
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
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
        throw new Error((data && (data.error_description || data.error)) || `token_exchange_failed_${res.status}`);
    }
    const expiresInSec = Number.isFinite(data.expires_in) ? data.expires_in : 60 * 24 * 3600;
    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}

/** Resolves the connected member's OIDC identity (GET /v2/userinfo). `sub`
 * is the stable per-app member id, used as externalAccountId and as the
 * `urn:li:person:{sub}` author on every post. */
export async function fetchConnectedAccount(accessToken, fetcher = fetch) {
    const res = await fetcher(`${API_BASE}/v2/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.sub !== 'string') {
        throw new Error((data && data.message) || `userinfo_failed_${res.status}`);
    }
    return {
        externalAccountId: data.sub,
        displayName: data.name || null,
        avatarUrl: data.picture || null,
    };
}

/** Publishes a single-image post on the member's own behalf: initialize an
 * image upload, PUT the bytes (LinkedIn's Images API has no "pull from
 * URL" mode the way Instagram's or TikTok's do, so this fetches the
 * source itself and streams it straight through), then create the post
 * referencing the uploaded image. Image posts only, matching every other
 * network's v1 MVP scope. Throws UNSUPPORTED_MEDIA_TYPE for anything else
 * so the caller fails the target cleanly instead of silently dropping it. */
export async function publishPost(accessToken, { externalAccountId, caption, mediaType, mediaUrl }, fetcher = fetch) {
    if (mediaType !== 'image') {
        const err = new Error(`unsupported media type: ${mediaType}`);
        err.code = 'UNSUPPORTED_MEDIA_TYPE';
        throw err;
    }
    const author = `urn:li:person:${externalAccountId}`;
    const apiHeaders = (extra = {}) => ({
        Authorization: `Bearer ${accessToken}`,
        'Linkedin-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        ...extra,
    });

    const initRes = await fetcher(`${API_BASE}/rest/images?action=initializeUpload`, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
        signal: AbortSignal.timeout(15000),
    });
    const init = await initRes.json().catch(() => null);
    const uploadUrl = init && init.value && init.value.uploadUrl;
    const imageUrn = init && init.value && init.value.image;
    if (!initRes.ok || !uploadUrl || !imageUrn) {
        throw new Error((init && init.message) || `image_init_failed_${initRes.status}`);
    }

    const sourceRes = await fetcher(mediaUrl, { signal: AbortSignal.timeout(20000) });
    if (!sourceRes.ok) throw new Error(`source_media_fetch_failed_${sourceRes.status}`);
    const bytes = await sourceRes.arrayBuffer();
    const contentType = sourceRes.headers.get('content-type') || 'application/octet-stream';

    // LinkedIn's own docs: this PUT does require the OAuth token (unlike
    // the equivalent video upload call, which must not carry one).
    const uploadRes = await fetcher(uploadUrl, {
        method: 'PUT',
        headers: apiHeaders({ 'Content-Type': contentType }),
        body: bytes,
        signal: AbortSignal.timeout(30000),
    });
    if (!uploadRes.ok) throw new Error(`image_upload_failed_${uploadRes.status}`);

    const postRes = await fetcher(`${API_BASE}/rest/posts`, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            author,
            commentary: caption || '',
            visibility: 'PUBLIC',
            distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
            content: { media: { id: imageUrn } },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (!postRes.ok) {
        const body = await postRes.json().catch(() => null);
        throw new Error((body && body.message) || `post_create_failed_${postRes.status}`);
    }
    // The Posts API returns 201 with no body; the created id is only in
    // the x-restli-id response header.
    const postId = postRes.headers.get('x-restli-id');
    if (!postId) throw new Error('post_create_missing_id');

    return {
        platformPostId: postId,
        // The Posts API returns no permalink — this is LinkedIn's documented,
        // stable convention for a share's public URL (literal colons, not
        // percent-encoded, matching how LinkedIn itself emits these links).
        platformPostUrl: `https://www.linkedin.com/feed/update/${postId}/`,
    };
}
