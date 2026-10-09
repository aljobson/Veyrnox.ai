import { bearer, jsonBody, jsonRequest, readImage, requireImage } from './common.js';
export const SCOPES = ['app-password'];
export const config = () => ({});
// Initial tester support is limited to Bluesky-hosted PDSs. Never fetch an
// arbitrary discovery URL or send a credential to a user-supplied service.
function hostedPds(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || !(url.hostname === 'bsky.social' || /^[a-z0-9-]+\.[a-z0-9-]+\.host\.bsky\.network$/.test(url.hostname))) throw new Error('unsupported_bluesky_host');
    return url.origin;
}
function session(data, pds) {
    if (!/^did:(plc|web):[A-Za-z0-9._:%-]+$/.test(data.did || '') || !data.accessJwt || !data.refreshJwt) throw new Error('invalid_session');
    return { externalAccountId: data.did, displayName: data.handle || data.did, avatarUrl: null,
        accessToken: JSON.stringify({ jwt: data.accessJwt, pds }), refreshToken: JSON.stringify({ jwt: data.refreshJwt, pds }),
        expiresAt: new Date(Date.now() + 90 * 60 * 1000).toISOString() };
}
function unpack(token) {
    const data = JSON.parse(token);
    if (typeof data.jwt !== 'string' || !data.jwt) throw new Error('invalid_session');
    return { jwt: data.jwt, pds: hostedPds(data.pds) };
}
export async function connect({ identifier, appPassword }, fetcher = fetch) {
    const data = await jsonRequest('https://bsky.social/xrpc/com.atproto.server.createSession', jsonBody({ identifier, password: appPassword }), fetcher);
    if (data.didDoc?.id !== data.did) throw new Error('invalid_session');
    const endpoint = data.didDoc.service?.find((s) => s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
    return session(data, hostedPds(endpoint));
}
export async function refreshAccessToken(_cfg, token, fetcher = fetch) {
    const { jwt, pds } = unpack(token);
    return session(await jsonRequest(`${pds}/xrpc/com.atproto.server.refreshSession`, { method: 'POST', headers: bearer(jwt) }, fetcher), pds);
}
export async function publishPost(token, { externalAccountId, caption, mediaType, mediaUrl, targetId }, fetcher = fetch) {
    requireImage(mediaType);
    if ([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(caption)].length > 300) throw new Error('caption_too_long');
    const { jwt, pds } = unpack(token);
    // A deterministic record key makes a retry after a lost provider response
    // overwrite the same record, rather than creating another public post.
    if (!/^[0-9a-f-]{36}$/i.test(targetId || '')) throw new Error('invalid_target');
    const rkey = targetId.replaceAll('-', '');
    const { bytes, mime } = await readImage(mediaUrl, 1000000, fetcher);
    const blob = await jsonRequest(`${pds}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...bearer(jwt), 'Content-Type': mime }, body: bytes }, fetcher);
    if (!blob.blob) throw new Error('missing_blob');
    const data = await jsonRequest(`${pds}/xrpc/com.atproto.repo.putRecord`, { ...jsonBody({ repo: externalAccountId, collection: 'app.bsky.feed.post', rkey,
        record: { $type: 'app.bsky.feed.post', text: caption, createdAt: new Date().toISOString(),
            embed: { $type: 'app.bsky.embed.images', images: [{ alt: caption, image: blob.blob }] } } }),
        headers: { ...bearer(jwt), 'Content-Type': 'application/json' } }, fetcher);
    if (!data.uri) throw new Error('missing_post_id');
    return { platformPostId: data.uri, platformPostUrl: `https://bsky.app/profile/${encodeURIComponent(externalAccountId)}/post/${rkey}` };
}
