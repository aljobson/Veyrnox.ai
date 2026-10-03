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
// Reach, views, saves and shares (fetchAnalytics). Requested only when
// INSTAGRAM_INSIGHTS_SCOPE_ENABLED is "true": Meta has to approve the
// permission first, and asking for one it has not approved can break the
// consent screen for everyone. Accounts connected before the switch keep
// their old grant until they reconnect.
export const INSTAGRAM_INSIGHTS_SCOPE = 'instagram_business_manage_insights';

/** The scopes this deployment asks for, and so the ones a new connection is granted. */
export function instagramScopes(cfg) {
    return cfg && cfg.insights ? [...INSTAGRAM_SCOPES, INSTAGRAM_INSIGHTS_SCOPE] : INSTAGRAM_SCOPES;
}

/** Loads and validates Meta app config from Worker secrets. Returns null
 * on any misconfiguration — callers degrade to a clean 503, never a
 * throw. Same Meta App (and so the same META_APP_ID/META_APP_SECRET) as
 * the Facebook Login surface this adapter no longer uses. */
export function instagramConfig(env = process.env) {
    const appId = env.META_APP_ID || '';
    const appSecret = env.META_APP_SECRET || '';
    if (!/^[0-9]{6,20}$/.test(appId) || appSecret.length < 16) return null;
    return { appId, appSecret, insights: env.INSTAGRAM_INSIGHTS_SCOPE_ENABLED === 'true' };
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
    url.searchParams.set('scope', instagramScopes(cfg).join(','));
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

const ANALYTICS_MEDIA_LIMIT = 50;
// One insights call per post, so only the newest few are refreshed each
// round; older posts keep the numbers stored while they were recent (0188
// merges, it does not replace).
const ANALYTICS_INSIGHT_POSTS = 10;
const DAY_SECONDS = 24 * 60 * 60;
const MEDIA_TYPE_LABEL = { REELS: 'reel', STORY: 'story', CAROUSEL_ALBUM: 'carousel', VIDEO: 'video', IMAGE: 'image' };

/** Account totals and the latest posts (ADR-0061 §2.5), in the shape
 * record_social_analytics (0188) stores: { metrics, posts }.
 *
 * instagram_business_basic alone gives followers, following, the post
 * count, and likes and comments per post. With `insights` (the account
 * granted INSTAGRAM_INSIGHTS_SCOPE) it adds the account's reach and
 * accounts engaged over the last 24 hours, and reach, views, saves and
 * shares for the newest posts. Metric names verified against Meta's
 * insights references 2026-10-03. An insights call that fails costs only
 * its own numbers: the basic ones are still returned. */
export async function fetchAnalytics(accessToken, { insights = false, now = new Date() } = {}, fetcher = fetch) {
    const profileUrl = new URL(`${GRAPH_BASE}/me`);
    profileUrl.searchParams.set('fields', 'followers_count,follows_count,media_count');
    profileUrl.searchParams.set('access_token', accessToken);
    const profile = await getJson(profileUrl, fetcher);
    if (!profile || typeof profile !== 'object') throw new Error('profile_fetch_failed');

    const mediaUrl = new URL(`${GRAPH_BASE}/me/media`);
    mediaUrl.searchParams.set('fields', 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count');
    mediaUrl.searchParams.set('limit', String(ANALYTICS_MEDIA_LIMIT));
    mediaUrl.searchParams.set('access_token', accessToken);
    const media = await getJson(mediaUrl, fetcher);

    const posts = [];
    for (const item of (media && Array.isArray(media.data) ? media.data : [])) {
        const publishedMs = Date.parse(item && item.timestamp);
        if (!item || typeof item.id !== 'string' || Number.isNaN(publishedMs)) continue;
        const postInsights = insights && posts.length < ANALYTICS_INSIGHT_POSTS
            ? await fetchPostInsights(accessToken, item.id, fetcher) : {};
        posts.push({
            id: item.id,
            published_at: new Date(publishedMs).toISOString(),
            type: MEDIA_TYPE_LABEL[item.media_product_type] || MEDIA_TYPE_LABEL[item.media_type] || 'post',
            permalink: typeof item.permalink === 'string' ? item.permalink : null,
            caption: typeof item.caption === 'string' ? item.caption.slice(0, 500) : null,
            metrics: numbers({ likes: item.like_count, comments: item.comments_count, ...postInsights }),
        });
    }
    const accountInsights = insights ? await fetchAccountInsights(accessToken, now, fetcher) : {};
    return {
        metrics: numbers({
            followers: profile.followers_count, following: profile.follows_count, posts_count: profile.media_count,
            ...accountInsights,
        }),
        posts,
    };
}

/** Lifetime reach, views, saves and shares for one post, or {} if the call fails. */
async function fetchPostInsights(accessToken, mediaId, fetcher) {
    const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(mediaId)}/insights`);
    url.searchParams.set('metric', 'reach,views,saved,shares');
    url.searchParams.set('access_token', accessToken);
    try {
        const byName = insightValues(await getJson(url, fetcher), (entry) => entry.values && entry.values[0] && entry.values[0].value);
        return { reach: byName.reach, views: byName.views, saves: byName.saved, shares: byName.shares };
    } catch {
        return {};
    }
}

/** The account's reach and accounts engaged over the 24 hours to `now`, or {} if the call fails. */
async function fetchAccountInsights(accessToken, now, fetcher) {
    const until = Math.floor(now.getTime() / 1000);
    const url = new URL(`${GRAPH_BASE}/me/insights`);
    url.searchParams.set('metric', 'reach,accounts_engaged');
    url.searchParams.set('period', 'day');
    url.searchParams.set('metric_type', 'total_value');
    url.searchParams.set('since', String(until - DAY_SECONDS));
    url.searchParams.set('until', String(until));
    url.searchParams.set('access_token', accessToken);
    try {
        const byName = insightValues(await getJson(url, fetcher), (entry) => entry.total_value && entry.total_value.value);
        return { reach: byName.reach, accounts_engaged: byName.accounts_engaged };
    } catch {
        return {};
    }
}

function insightValues(body, read) {
    const entries = body && Array.isArray(body.data) ? body.data : [];
    return Object.fromEntries(entries.filter((e) => e && typeof e.name === 'string').map((e) => [e.name, read(e)]));
}

/** Drops anything the API did not return as a finite number. */
function numbers(fields) {
    return Object.fromEntries(Object.entries(fields).filter(([, v]) => Number.isFinite(v)));
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
