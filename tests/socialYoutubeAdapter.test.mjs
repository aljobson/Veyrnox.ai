import test from 'node:test';
import assert from 'node:assert/strict';
import {
    youtubeConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, YOUTUBE_SCOPES,
    refreshAccessToken, initResumableUpload, probeUploadOffset, uploadChunk, checkProcessingStatus,
} from '../packages/adapters/social/youtube.js';

const cfg = { clientId: '123456789012-abcdefghijklmnop.apps.googleusercontent.com', clientSecret: 'a'.repeat(20) };

test('youtubeConfig rejects malformed or missing env', () => {
    assert.equal(youtubeConfig({}), null);
    assert.equal(youtubeConfig({ YOUTUBE_CLIENT_ID: 'not-a-real-shape', YOUTUBE_CLIENT_SECRET: 'a'.repeat(20) }), null);
    assert.equal(youtubeConfig({ YOUTUBE_CLIENT_ID: cfg.clientId, YOUTUBE_CLIENT_SECRET: 'short' }), null);
    assert.deepEqual(youtubeConfig({ YOUTUBE_CLIENT_ID: cfg.clientId, YOUTUBE_CLIENT_SECRET: 'a'.repeat(20) }), cfg);
});

test('buildAuthorizeUrl requests offline access with forced consent, and the minimal read-only scope', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback/youtube', state: 'signed-state-token',
    }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), cfg.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/youtube');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload');
    assert.equal(url.searchParams.get('code_challenge'), null);
    assert.deepEqual(YOUTUBE_SCOPES, [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.upload',
    ]);
});

test('buildAuthorizeUrl refuses a non-https redirect', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's' }));
});

test('exchangeCodeForToken posts form-urlencoded with the client secret in the body and captures the refresh token', async () => {
    let sentUrl = null, sentBody = null, sentHeaders = null;
    const fetcher = async (url, init) => {
        sentUrl = url; sentBody = init.body; sentHeaders = init.headers;
        return jsonRes({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3920, scope: YOUTUBE_SCOPES[0], token_type: 'Bearer' });
    };
    const result = await exchangeCodeForToken(cfg, { code: 'auth-code', redirectUri: 'https://veyrnox.ai/social/connect/callback/youtube' }, fetcher);
    assert.equal(result.accessToken, 'access-1');
    assert.equal(result.refreshToken, 'refresh-1');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(sentUrl, 'https://oauth2.googleapis.com/token');
    assert.equal(sentHeaders['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'auth-code');
    assert.equal(params.get('client_id'), cfg.clientId);
    assert.equal(params.get('client_secret'), cfg.clientSecret);
    assert.equal(params.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/youtube');
});

test('exchangeCodeForToken surfaces Google\'s error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /Malformed auth code/,
    );
});

test('fetchConnectedAccount resolves the caller\'s own channel', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ items: [{ id: 'UC-channel-1', snippet: { title: 'Creator Channel', thumbnails: { default: { url: 'https://example.com/a.jpg' } } } }] });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, { externalAccountId: 'UC-channel-1', displayName: 'Creator Channel', avatarUrl: 'https://example.com/a.jpg' });
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, '/youtube/v3/channels');
    assert.equal(u.searchParams.get('part'), 'snippet');
    assert.equal(u.searchParams.get('mine'), 'true');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('fetchConnectedAccount reports NO_YOUTUBE_CHANNEL as an expected conflict, not a crash', async () => {
    const fetcher = async () => jsonRes({ items: [] });
    await assert.rejects(fetchConnectedAccount('user-token', fetcher), (err) => err.code === 'NO_YOUTUBE_CHANNEL');
});

test('fetchConnectedAccount surfaces an upstream failure rather than crashing', async () => {
    const fetcher = async () => jsonRes({ error: { message: 'invalid credentials' } }, 401);
    await assert.rejects(fetchConnectedAccount('bad-token', fetcher), /invalid credentials/);
});

test('refreshAccessToken exchanges the refresh token for a fresh access token', async () => {
    let sentBody;
    const fetcher = async (url, init) => {
        sentBody = new URLSearchParams(init.body);
        return jsonRes({ access_token: 'fresh-access-token', expires_in: 3600 });
    };
    const result = await refreshAccessToken(cfg, 'refresh-1', fetcher);
    assert.equal(result.accessToken, 'fresh-access-token');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(sentBody.get('grant_type'), 'refresh_token');
    assert.equal(sentBody.get('refresh_token'), 'refresh-1');
    assert.equal(sentBody.get('client_id'), cfg.clientId);
});

test('initResumableUpload sends the required upload headers and returns the session URI from Location', async () => {
    let sentHeaders, sentBody;
    const fetcher = async (url, init) => {
        sentHeaders = init.headers; sentBody = JSON.parse(init.body);
        return headerRes({ location: 'https://upload.example/session-1' }, 200);
    };
    const result = await initResumableUpload('access-1', {
        title: 'My video', description: 'desc', privacyStatus: 'unlisted', mimeType: 'video/mp4', totalBytes: 5000,
    }, fetcher);
    assert.equal(result.sessionUri, 'https://upload.example/session-1');
    assert.equal(sentHeaders['X-Upload-Content-Type'], 'video/mp4');
    assert.equal(sentHeaders['X-Upload-Content-Length'], '5000');
    assert.equal(sentHeaders.Authorization, 'Bearer access-1');
    assert.equal(sentBody.snippet.title, 'My video');
    assert.equal(sentBody.status.privacyStatus, 'unlisted');
});

test('initResumableUpload throws if the response carries no session URI', async () => {
    const fetcher = async () => headerRes({}, 200);
    await assert.rejects(initResumableUpload('access-1', { totalBytes: 100 }, fetcher), /missing_session_uri/);
});

test('probeUploadOffset reads the confirmed byte count off a 308\'s Range header, or zero if absent', async () => {
    const withRange = async () => headerRes({ range: 'bytes=0-999' }, 308);
    assert.deepEqual(await probeUploadOffset('https://upload.example/s', 5000, withRange), { done: false, bytesConfirmed: 1000 });
    const withoutRange = async () => headerRes({}, 308);
    assert.deepEqual(await probeUploadOffset('https://upload.example/s', 5000, withoutRange), { done: false, bytesConfirmed: 0 });
});

test('probeUploadOffset treats a completed session (200/201 with a video body) as done', async () => {
    const fetcher = async () => ({ ok: true, status: 201, headers: headerGet({}), json: async () => ({ id: 'video-9' }) });
    assert.deepEqual(await probeUploadOffset('https://upload.example/s', 5000, fetcher), { done: true, bytesConfirmed: 5000, videoId: 'video-9' });
});

test('probeUploadOffset reports an expired session distinctly, not as a generic failure', async () => {
    const fetcher = async () => headerRes({}, 404);
    await assert.rejects(probeUploadOffset('https://upload.example/s', 5000, fetcher), (err) => err.code === 'UPLOAD_SESSION_EXPIRED');
});

test('uploadChunk fetches the byte range from mediaUrl and PUTs it with the right Content-Range', async () => {
    let sentRangeHeader, sentContentRange;
    const fetcher = async (url, init) => {
        if (url === 'https://r2.example/media') {
            sentRangeHeader = init.headers.Range;
            return { ok: true, status: 206, headers: headerGet({}), arrayBuffer: async () => new Uint8Array(1000).buffer };
        }
        sentContentRange = init.headers['Content-Range'];
        return headerRes({ range: 'bytes=0-999' }, 308);
    };
    const result = await uploadChunk('https://upload.example/s', {
        mediaUrl: 'https://r2.example/media', startByte: 0, endByte: 999, totalBytes: 5000, mimeType: 'video/mp4',
    }, fetcher);
    assert.deepEqual(result, { done: false, bytesConfirmed: 1000 });
    assert.equal(sentRangeHeader, 'bytes=0-999');
    assert.equal(sentContentRange, 'bytes 0-999/5000');
});

test('checkProcessingStatus reads status and processingDetails by exact field name', async () => {
    const fetcher = async () => jsonRes({
        items: [{ status: { uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }],
    });
    assert.deepEqual(await checkProcessingStatus('access-1', 'video-1', fetcher), {
        uploadStatus: 'processed', processingStatus: 'succeeded', failureReason: null, rejectionReason: null,
    });
});

function headerGet(values) {
    return { get: (k) => values[k.toLowerCase()] ?? null };
}
function headerRes(headerValues, status = 200) {
    return { ok: status < 400, status, headers: headerGet(headerValues), text: async () => '' };
}

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
