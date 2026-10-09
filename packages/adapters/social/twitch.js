import { appConfig, authorizeUrl, bearer, formToken, jsonRequest, tokenResult } from './common.js';
export const SCOPES = []; // Public channel/video stats need no privileged scopes.
export const config = (env = process.env) => appConfig(env, 'TWITCH');
export const buildAuthorizeUrl = (cfg, input) => authorizeUrl('https://id.twitch.tv/oauth2/authorize', cfg, input, SCOPES);
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    return tokenResult(await formToken('https://id.twitch.tv/oauth2/token', { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        grant_type: 'authorization_code', code, redirect_uri: redirectUri }, fetcher));
}
export async function refreshAccessToken(cfg, refreshToken, fetcher = fetch) {
    return tokenResult(await formToken('https://id.twitch.tv/oauth2/token', { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher), refreshToken);
}
export async function fetchCandidates(token, fetcher = fetch, cfg = config()) {
    if (!cfg) throw new Error('twitch_not_configured');
    const valid = await jsonRequest('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } }, fetcher);
    if (valid.client_id !== cfg.clientId || !valid.user_id) throw new Error('twitch_account_mismatch');
    const data = await jsonRequest('https://api.twitch.tv/helix/users', { headers: { ...bearer(token), 'Client-Id': cfg.clientId } }, fetcher);
    const user = data.data?.[0];
    if (!user || user.id !== valid.user_id) throw new Error('twitch_account_mismatch');
    return [{ externalAccountId: user.id, displayName: user.display_name, avatarUrl: user.profile_image_url || null }];
}
export async function fetchAnalytics(token, { externalAccountId }, fetcher = fetch, cfg = config()) {
    const [identity] = await fetchCandidates(token, fetcher, cfg);
    if (identity.externalAccountId !== externalAccountId) throw new Error('twitch_account_mismatch');
    const data = await jsonRequest(`https://api.twitch.tv/helix/videos?user_id=${encodeURIComponent(externalAccountId)}&first=20`,
        { headers: { ...bearer(token), 'Client-Id': cfg.clientId } }, fetcher);
    return { metrics: {}, posts: (data.data || []).filter((v) => v.id && Number.isFinite(Date.parse(v.created_at)))
        .map((v) => ({ id: v.id, permalink: v.url, type: 'video', published_at: new Date(v.created_at).toISOString(),
            caption: (v.title || '').slice(0, 500), metrics: { views: v.view_count } })) };
}
