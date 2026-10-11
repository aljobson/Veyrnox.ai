// Native video-only steps; existing image adapters keep their contracts.
// See ADR-0093 for provider references, review requirements and rollout.
import { bearer, formToken, jsonRequest } from './common.js';

// Workers supports manual redirects; reject them before any credential can
// leave the fixed provider host. common.jsonRequest's error mode is Node-only.
export const videoProviderFetch = fetcher => async (url, init) => {
    const response = await fetcher(url, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        throw new Error('provider_redirect_rejected');
    }
    return response;
};

const IG = 'https://graph.instagram.com/v25.0';
const FB = 'https://graph.facebook.com/v23.0';
const TT = 'https://open.tiktokapis.com';
const ID = /^\d{3,32}$/;
const POLL_MS = 60000, MAX_POLL_MS = 2 * 60 * 60 * 1000;
const validateId = value => { if (typeof value !== 'string' || !ID.test(value)) throw new Error('invalid_provider_id'); return value; };
function videoInput(mediaType, mediaUrl) {
    if (mediaType !== 'video') throw new Error('unsupported_media_type');
    let url;
    try { url = new URL(mediaUrl); } catch { throw new Error('invalid_media_url'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('invalid_media_url');
}
function continuation(state, now, wait = POLL_MS) {
    const start = Date.parse(state.started_at || '');
    if (!Number.isFinite(start) || start > now + 60000 || now - start > MAX_POLL_MS) throw new Error('poll_timeout');
    return { inProgress: true, providerState: state, nextCheckAt: new Date(now + wait).toISOString() };
}
function safePermalink(value, host) {
    try { const url = new URL(value); return url.protocol === 'https:' && ['www.' + host, host].includes(url.hostname) && !url.username && !url.password && !url.port ? url.toString() : null; }
    catch { return null; }
}
const uncertain = () => { throw new Error('provider_result_unknown_reconcile_before_retry'); };

/** Create/checkpoint, poll, then mark immediately before the public publish. */
export async function instagramVideoStep(token, { externalAccountId, caption = '', mediaType, mediaUrl, state = {}, now = Date.now() }, fetcher = fetch, beforePublish = async () => {}) {
    videoInput(mediaType, mediaUrl); validateId(externalAccountId); fetcher = videoProviderFetch(fetcher);
    if (state.post_id) {
        const id = validateId(state.post_id);
        const data = await jsonRequest(`${IG}/${id}?fields=permalink`, { headers: bearer(token) }, fetcher).catch(() => null);
        return { ok: true, platformPostId: id, platformPostUrl: safePermalink(data?.permalink, 'instagram.com') };
    }
    if (state.submission_started) uncertain();
    if (!state.container_id) {
        const data = await formToken(`${IG}/${externalAccountId}/media`, { media_type: 'REELS', video_url: mediaUrl, caption }, fetcher, bearer(token));
        return continuation({ container_id: validateId(data.id), started_at: new Date(now).toISOString() }, now);
    }
    const id = validateId(state.container_id);
    continuation(state, now);
    const status = await jsonRequest(`${IG}/${id}?fields=status_code`, { headers: bearer(token) }, fetcher);
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) throw new Error('instagram_container_failed');
    if (status.status_code === 'PUBLISHED') throw new Error('published_container_requires_reconciliation');
    if (status.status_code === 'IN_PROGRESS') return continuation(state, now);
    if (status.status_code !== 'FINISHED') throw new Error('invalid_container_status');
    await beforePublish();
    const data = await formToken(`${IG}/${externalAccountId}/media_publish`, { creation_id: id }, fetcher, bearer(token));
    return continuation({ ...state, submission_started: true, post_id: validateId(data.id) }, now, 5000);
}

/** Page video upload accepts a public post, so mark BEFORE sending file_url. */
export async function facebookVideoStep(token, { externalAccountId, caption = '', mediaType, mediaUrl, state = {}, now = Date.now() }, fetcher = fetch, beforePublish = async () => {}) {
    videoInput(mediaType, mediaUrl); validateId(externalAccountId); fetcher = videoProviderFetch(fetcher);
    if (!state.video_id) {
        if (state.submission_started) uncertain();
        await beforePublish();
        const data = await formToken(`${FB}/${externalAccountId}/videos`, { file_url: mediaUrl, description: caption, published: 'true' }, fetcher, bearer(token));
        return continuation({ video_id: validateId(data.id), submission_started: true, started_at: new Date(now).toISOString() }, now);
    }
    const id = validateId(state.video_id);
    continuation(state, now);
    const data = await jsonRequest(`${FB}/${id}?fields=status,permalink_url`, { headers: bearer(token) }, fetcher);
    const status = data.status;
    if (status?.video_status === 'error') throw new Error('facebook_video_failed');
    if (status?.video_status === 'ready') {
        return { ok: true, platformPostId: id, platformPostUrl: safePermalink(data.permalink_url, 'facebook.com') || `https://www.facebook.com/${externalAccountId}/videos/${id}/` };
    }
    if (!['processing', 'ready'].includes(status?.video_status)) throw new Error('invalid_video_status');
    return continuation(state, now);
}

/** video.upload inbox API; no caption/privacy payload or claim of live posting. */
export async function submitTiktokVideo(token, { mediaType, mediaUrl }, fetcher = fetch) {
    videoInput(mediaType, mediaUrl);
    const response = await videoProviderFetch(fetcher)(`${TT}/v2/post/publish/inbox/video/init/`, {
        method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, redirect: 'manual',
        body: JSON.stringify({ source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl } }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || (data?.error?.code && data.error.code !== 'ok') || typeof data?.data?.publish_id !== 'string' || !/^[A-Za-z0-9_:.\-/]{1,200}$/.test(data.data.publish_id)) throw new Error(`tiktok_video_init_failed_${response.status}`);
    return { publishId: data.data.publish_id };
}
