import { authorizeUrl, bearer, formToken, jsonRequest, requireImage } from './common.js';

const BASE = 'https://graph.facebook.com/v23.0';
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
export function config(env = process.env) {
    const clientId = env.FACEBOOK_CLIENT_ID || env.META_APP_ID, clientSecret = env.FACEBOOK_CLIENT_SECRET || env.META_APP_SECRET;
    return /^\d{5,32}$/.test(clientId || '') && clientSecret?.length >= 8 ? { clientId, clientSecret } : null;
}
export const buildAuthorizeUrl = (cfg, input) => authorizeUrl('https://www.facebook.com/v23.0/dialog/oauth', cfg, input, SCOPES);
async function exchangeFacebookToken(stage, endpoint, params, fetcher) {
    try {
        const url = new URL(endpoint);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        const result = await jsonRequest(url, {}, fetcher);
        if (typeof result.access_token !== 'string' || !result.access_token) throw new Error(`facebook_${stage}_token_missing`);
        return result;
    } catch (error) {
        if (error?.message === `facebook_${stage}_token_missing`) throw error;
        const status = /^provider_request_failed_([0-9]{3})$/.exec(error?.message || '')?.[1];
        throw new Error(`facebook_${stage}_token_failed${status ? `_${status}` : ''}`);
    }
}
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const short = await exchangeFacebookToken('short', `${BASE}/oauth/access_token`, { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uri: redirectUri, code }, fetcher);
    const long = await exchangeFacebookToken('long', `${BASE}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: cfg.clientId,
        client_secret: cfg.clientSecret, fb_exchange_token: short.access_token }, fetcher);
    return { accessToken: long.access_token, refreshToken: null, expiresAt: null };
}
// Each candidate is a Page and carries its own Page token, never a personal
// profile token. Selection happens server-side after the user chooses a Page.
export async function fetchCandidates(token, fetcher = fetch) {
    const items = [];
    let after;
    for (let page = 0; page < 10; page++) {
        const url = new URL(`${BASE}/me/accounts`);
        url.searchParams.set('fields', 'id,name,access_token,tasks');
        url.searchParams.set('limit', '100');
        if (after) url.searchParams.set('after', after);
        const data = await jsonRequest(url, { headers: bearer(token) }, fetcher);
        items.push(...(data.data || []).filter((p) => p.id && p.access_token && p.tasks?.some((t) => ['CREATE_CONTENT', 'MANAGE'].includes(t)))
            .map((p) => ({ externalAccountId: p.id, displayName: p.name, avatarUrl: null, accessToken: p.access_token, expiresAt: null })));
        if (!data.paging?.next) return items;
        after = data.paging.cursors?.after;
        if (!after) break;
    }
    throw new Error('too_many_pages');
}
export async function publishPost(token, { externalAccountId, caption, mediaType, mediaUrl }, fetcher = fetch, beforePublish = async () => {}) {
    requireImage(mediaType);
    if (!/^\d+$/.test(externalAccountId)) throw new Error('invalid_page');
    await beforePublish();
    const result = await formToken(`${BASE}/${externalAccountId}/photos`, { url: mediaUrl, message: caption, published: 'true' }, fetcher, bearer(token));
    if (!result.post_id) throw new Error('missing_post_id');
    return { platformPostId: result.post_id, platformPostUrl: `https://www.facebook.com/${result.post_id}` };
}
