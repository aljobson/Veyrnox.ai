import { appConfig, authorizeUrl, bearer, formToken, jsonRequest, tokenResult, requireImage } from './common.js';
const BASE = 'https://graph.threads.net/v1.0';
export const SCOPES = ['threads_basic', 'threads_content_publish'];
export const config = (env = process.env) => appConfig(env, 'THREADS');
export const buildAuthorizeUrl = (cfg, input) => authorizeUrl('https://threads.net/oauth/authorize', cfg, input, SCOPES);
export async function exchangeCodeForToken(cfg, { code, redirectUri }, fetcher = fetch) {
    const short = await formToken(`${BASE}/oauth/access_token`, { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        grant_type: 'authorization_code', redirect_uri: redirectUri, code }, fetcher);
    const url = new URL(`${BASE}/access_token`);
    Object.entries({ grant_type: 'th_exchange_token', client_secret: cfg.clientSecret, access_token: short.access_token })
        .forEach(([k, v]) => url.searchParams.set(k, v));
    return tokenResult(await jsonRequest(url, {}, fetcher));
}
export async function refreshAccessToken(_cfg, accessToken, fetcher = fetch) {
    const url = new URL(`${BASE}/refresh_access_token`);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', accessToken);
    return tokenResult(await jsonRequest(url, {}, fetcher));
}
export async function fetchCandidates(token, fetcher = fetch) {
    const data = await jsonRequest(`${BASE}/me?fields=id,username,threads_profile_picture_url`, { headers: bearer(token) }, fetcher);
    if (!data.id) throw new Error('missing_account_id');
    return [{ externalAccountId: data.id, displayName: data.username, avatarUrl: data.threads_profile_picture_url || null }];
}
// Persist the container before polling, so routine processing never retries
// creation. Media must remain accessible at our signed proxy while it processes.
export async function publishStep(token, { externalAccountId, caption, mediaType, mediaUrl, state = {} }, fetcher = fetch, beforePublish = async () => {}) {
    requireImage(mediaType);
    if (!/^\d+$/.test(externalAccountId)) throw new Error('invalid_account');
    if (state.post_id) {
        const data = await jsonRequest(`${BASE}/${state.post_id}?fields=permalink`, { headers: bearer(token) }, fetcher);
        return { ok: true, platformPostId: state.post_id, platformPostUrl: data.permalink || null };
    }
    if (state.submission_started) throw new Error('provider_result_unknown_reconcile_before_retry');
    if (!state.container_id) {
        const data = await formToken(`${BASE}/${externalAccountId}/threads`, { media_type: 'IMAGE', image_url: mediaUrl, text: caption }, fetcher, bearer(token));
        if (!data.id) throw new Error('missing_container_id');
        return { inProgress: true, providerState: { container_id: data.id, started_at: new Date().toISOString() }, nextCheckAt: new Date(Date.now() + 30000).toISOString() };
    }
    if (Date.now() - Date.parse(state.started_at) > 2 * 60 * 60 * 1000) throw new Error('poll_timeout');
    const status = await jsonRequest(`${BASE}/${state.container_id}?fields=status,error_message`, { headers: bearer(token) }, fetcher);
    if (['ERROR', 'EXPIRED'].includes(status.status)) throw new Error('container_failed');
    if (status.status === 'PUBLISHED') throw new Error('published_container_requires_reconciliation');
    if (status.status !== 'FINISHED') return { inProgress: true, providerState: state, nextCheckAt: new Date(Date.now() + 30000).toISOString() };
    await beforePublish();
    const data = await formToken(`${BASE}/${externalAccountId}/threads_publish`, { creation_id: state.container_id }, fetcher, bearer(token));
    if (!data.id) throw new Error('missing_post_id');
    return { inProgress: true, providerState: { ...state, post_id: data.id }, nextCheckAt: new Date(Date.now() + 5000).toISOString() };
}
