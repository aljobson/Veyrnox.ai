import { bearer, formToken, jsonRequest } from './common.js';

export function imageItems(media, mediaType, mediaUrl, max) {
    const items = media === undefined ? [{ mediaType, mediaUrl }] : media;
    if (!Array.isArray(items) || !items.length || items.length > max
        || items.some(item => item?.mediaType !== 'image' || typeof item.mediaUrl !== 'string' || !item.mediaUrl)) {
        throw new Error('unsupported_media_type');
    }
    return items;
}

// Persist within the claim; ambiguous creation intents require reconciliation.
export async function metaCarouselStep(network, token, { externalAccountId, caption, media, state = {},
    checkpoint, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }, fetcher, beforePublish) {
    const instagram = network === 'instagram';
    const base = instagram ? 'https://graph.instagram.com/v25.0' : 'https://graph.threads.net/v1.0';
    const path = instagram ? 'media' : 'threads';
    const statusField = instagram ? 'status_code' : 'status';
    if (typeof checkpoint !== 'function') throw new Error('carousel_checkpoint_required');
    if (!/^\d+$/.test(externalAccountId) || !Array.isArray(media) || media.length < 2 || media.length > 10
        || media.some(item => !item || typeof item.mediaUrl !== 'string' || !item.mediaUrl
            || !(instagram ? ['image', 'video'] : ['image']).includes(item.mediaType))) throw new Error('invalid_carousel');
    const read = (id, fields) => jsonRequest(`${base}/${encodeURIComponent(id)}?fields=${fields}`, { headers: bearer(token) }, fetcher);
    const create = fields => formToken(`${base}/${externalAccountId}/${path}`, fields, fetcher, bearer(token));
    const finish = async id => ({ ok: true, platformPostId: id, platformPostUrl: (await read(id, 'permalink')).permalink || null });
    if (state.post_id) return finish(state.post_id);
    if (state.submission_started) throw new Error('provider_result_unknown_reconcile_before_retry');
    if (state.creating) throw new Error('container_result_unknown_reconcile_before_retry');
    const next = { ...state, started_at: state.started_at || new Date().toISOString(), children: structuredClone(state.children || []) };
    if (!Number.isFinite(Date.parse(next.started_at)) || Date.now() - Date.parse(next.started_at) > 2 * 3600000) throw new Error('poll_timeout');
    const save = () => checkpoint(structuredClone(next));
    const progress = () => ({ inProgress: true, providerState: next, nextCheckAt: new Date(Date.now() + 30000).toISOString() });
    while (next.children.length < media.length) {
        const item = media[next.children.length];
        next.creating = `child:${next.children.length}`;
        await save();
        const fields = { is_carousel_item: 'true', [item.mediaType === 'video' ? 'video_url' : 'image_url']: item.mediaUrl };
        if (!instagram || item.mediaType === 'video') fields.media_type = item.mediaType.toUpperCase();
        const child = await create(fields);
        if (!child.id) throw new Error('missing_container_id');
        next.children.push({ id: child.id, ready: false });
        delete next.creating;
        await save();
    }
    // All pending containers per round; at most four seconds of sleep per stage.
    const poll = async containers => {
        for (let round = 0; round < 3; round++) {
            await Promise.all(containers.filter(child => !child.ready).map(async child => {
                const status = (await read(child.id, statusField))[statusField];
                if (['ERROR', 'EXPIRED'].includes(status)) throw new Error('container_failed');
                if (status === 'PUBLISHED') throw new Error('published_container_requires_reconciliation');
                child.ready = status === 'FINISHED';
            }));
            if (containers.every(child => child.ready)) return true;
            if (round < 2) await wait(2000);
        }
        return false;
    };
    const ready = await poll(next.children);
    await save();
    if (!ready) return progress();
    if (!next.container_id) {
        next.creating = 'parent';
        await save();
        const parent = await create({ media_type: 'CAROUSEL', children: next.children.map(child => child.id).join(','), [instagram ? 'caption' : 'text']: caption || '' });
        if (!parent.id) throw new Error('missing_container_id');
        next.container_id = parent.id;
        delete next.creating;
        await save();
    }
    if (!await poll([{ id: next.container_id, ready: false }])) return progress();
    await beforePublish();
    const post = await formToken(`${base}/${externalAccountId}/${path}_publish`, { creation_id: next.container_id }, fetcher, bearer(token));
    if (!post.id) throw new Error('missing_post_id');
    next.post_id = post.id;
    next.submission_started = true;
    await save();
    return finish(next.post_id);
}
