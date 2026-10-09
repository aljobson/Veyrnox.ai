import { authorizeUrl, bearer, formToken, jsonRequest, requireImage } from './common.js';

const BASE = 'https://graph.facebook.com/v23.0';
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
export function config(env = process.env) {
    const clientId = env.FACEBOOK_CLIENT_ID || env.META_APP_ID, clientSecret = env.FACEBOOK_CLIENT_SECRET || env.META_APP_SECRET;
    return /^\d{5,32}$/.test(clientId || '') && clientSecret?.length >= 8 ? { clientId, clientSecret } : null;
}
export const buildAuthorizeUrl = (cfg, input) => authorizeUrl('https://www.facebook.com/v23.0/dialog/oauth', cfg, input, SCOPES);
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const short = await formToken(`${BASE}/oauth/access_token`, { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uri: redirectUri, code }, fetcher);
    const long = await formToken(`${BASE}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: cfg.clientId,
        client_secret: cfg.clientSecret, fb_exchange_token: short.access_token }, fetcher);
    if (!long.access_token) throw new Error('invalid_access_token');
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
export async function publishPost(token, { externalAccountId, caption, mediaType, mediaUrl }, fetcher = fetch) {
    requireImage(mediaType);
    if (!/^\d+$/.test(externalAccountId)) throw new Error('invalid_page');
    const result = await formToken(`${BASE}/${externalAccountId}/photos`, { url: mediaUrl, message: caption, published: 'true' }, fetcher, bearer(token));
    if (!result.post_id) throw new Error('missing_post_id');
    return { platformPostId: result.post_id, platformPostUrl: `https://www.facebook.com/${result.post_id}` };
}
