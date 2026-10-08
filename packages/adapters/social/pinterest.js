import { appConfig, authorizeUrl, bearer, formToken, jsonRequest, tokenResult, requireImage } from './common.js';
const BASE = 'https://api.pinterest.com/v5';
export const SCOPES = ['user_accounts:read', 'boards:read', 'pins:read', 'pins:write'];
export const config = (env = process.env) => appConfig(env, 'PINTEREST');
export const buildAuthorizeUrl = (cfg, input) => authorizeUrl('https://www.pinterest.com/oauth/', cfg, input, SCOPES, { scope: SCOPES.join(',') });
const basic = (cfg) => ({ Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}` });
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    return tokenResult(await formToken(`${BASE}/oauth/token`, { grant_type: 'authorization_code', code,
        redirect_uri: redirectUri, continuous_refresh: 'true' }, fetcher, basic(cfg)));
}
export async function refreshAccessToken(cfg, refreshToken, fetcher = fetch) {
    return tokenResult(await formToken(`${BASE}/oauth/token`, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher, basic(cfg)), refreshToken);
}
export async function fetchCandidates(token, fetcher = fetch) {
    const user = await jsonRequest(`${BASE}/user_account`, { headers: bearer(token) }, fetcher);
    const items = [];
    let bookmark;
    for (let page = 0; page < 10; page++) {
        const url = new URL(`${BASE}/boards`);
        url.searchParams.set('page_size', '100');
        if (bookmark) url.searchParams.set('bookmark', bookmark);
        const data = await jsonRequest(url, { headers: bearer(token) }, fetcher);
        items.push(...(data.items || []).filter((b) => b.id && b.owner?.username?.toLowerCase() === user.username?.toLowerCase())
            .map((b) => ({ externalAccountId: b.id, displayName: `${user.username} · ${b.name}`, avatarUrl: null })));
        bookmark = data.bookmark;
        if (!bookmark) return items;
    }
    throw new Error('too_many_boards');
}
export async function publishPost(token, { externalAccountId, caption, mediaType, mediaUrl }, fetcher = fetch) {
    requireImage(mediaType);
    if (!/^\d+$/.test(externalAccountId)) throw new Error('invalid_board');
    const data = await jsonRequest(`${BASE}/pins`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_id: externalAccountId, title: caption.slice(0, 100), description: caption,
            media_source: { source_type: 'image_url', url: mediaUrl } }) }, fetcher);
    if (!data.id) throw new Error('missing_post_id');
    return { platformPostId: data.id, platformPostUrl: `https://www.pinterest.com/pin/${data.id}/` };
}
