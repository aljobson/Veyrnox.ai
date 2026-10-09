import { appConfig, authorizeUrl, bearer, formToken, jsonRequest, tokenResult, requireImage } from './common.js';
export const SCOPES = ['https://www.googleapis.com/auth/business.manage'];
export const config = (env = process.env) => appConfig(env, 'GMB');
export const buildAuthorizeUrl = (cfg, input) => authorizeUrl('https://accounts.google.com/o/oauth2/v2/auth', cfg, input, SCOPES,
    { access_type: 'offline', prompt: 'consent' });
export async function exchangeCodeForToken(cfg, { code, redirectUri, codeVerifier }, fetcher = fetch) {
    return tokenResult(await formToken('https://oauth2.googleapis.com/token', { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier }, fetcher));
}
export async function refreshAccessToken(cfg, refreshToken, fetcher = fetch) {
    return tokenResult(await formToken('https://oauth2.googleapis.com/token', { client_id: cfg.clientId, client_secret: cfg.clientSecret,
        grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher), refreshToken);
}
export async function fetchCandidates(token, fetcher = fetch) {
    const accounts = await jsonRequest('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', { headers: bearer(token) }, fetcher);
    if (accounts.nextPageToken) throw new Error('too_many_business_accounts');
    const items = [];
    for (const account of accounts.accounts || []) {
        if (!/^accounts\/\d+$/.test(account.name)) continue;
        let pageToken;
        for (let page = 0; page < 5; page++) {
            const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
            url.searchParams.set('readMask', 'name,title');
            url.searchParams.set('pageSize', '100');
            if (pageToken) url.searchParams.set('pageToken', pageToken);
            const data = await jsonRequest(url, { headers: bearer(token) }, fetcher);
            items.push(...(data.locations || []).filter((l) => /^locations\/\d+$/.test(l.name))
                .map((l) => ({ externalAccountId: `${account.name}/${l.name}`, displayName: l.title, avatarUrl: null })));
            pageToken = data.nextPageToken;
            if (!pageToken) break;
        }
        if (pageToken) throw new Error('too_many_locations');
        if (items.length > 200) throw new Error('too_many_locations');
    }
    return items;
}
export async function publishPost(token, { externalAccountId, caption, mediaType, mediaUrl }, fetcher = fetch) {
    requireImage(mediaType);
    if (!/^accounts\/\d+\/locations\/\d+$/.test(externalAccountId)) throw new Error('invalid_location');
    const data = await jsonRequest(`https://mybusiness.googleapis.com/v4/${externalAccountId}/localPosts`, {
        method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageCode: 'en', summary: caption, topicType: 'STANDARD', media: [{ mediaFormat: 'PHOTO', sourceUrl: mediaUrl }] }),
    }, fetcher);
    if (!data.name?.startsWith(`${externalAccountId}/localPosts/`)) throw new Error('missing_post_id');
    return { platformPostId: data.name, platformPostUrl: data.searchUrl || null, processing: data.state !== 'LIVE' };
}
export async function checkPost(token, name, fetcher = fetch) {
    if (!/^accounts\/\d+\/locations\/\d+\/localPosts\/[A-Za-z0-9_-]+$/.test(name)) throw new Error('invalid_post_id');
    const data = await jsonRequest(`https://mybusiness.googleapis.com/v4/${name}`, { headers: bearer(token) }, fetcher);
    if (data.state === 'REJECTED') return { ok: false, error: 'google_post_rejected' };
    if (data.state !== 'LIVE') return { processing: true };
    return { ok: true, platformPostId: name, platformPostUrl: data.searchUrl || null };
}
