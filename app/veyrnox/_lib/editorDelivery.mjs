import { SOCIAL_CATALOGUE } from '../../../lib/social/networks.js';

export const EDITOR_RENDER_MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, message) => Object.assign(new Error(message), { code });

/** An export stays local until its owner explicitly chooses a save or upload. */
export async function localExportFile(result, { origin, signal, fetchBytes = fetch } = {}) {
    if (!result || typeof result.name !== 'string' || !/\.mp4$/i.test(result.name)) throw fail('mp4_required', 'Export an MP4 before saving or preparing a post.');
    let blob = result.blob;
    if (!(blob instanceof Blob)) {
        let url;
        try { url = new URL(result.url); } catch { throw fail('export_unavailable', 'Export this edit again.'); }
        if (url.protocol !== 'blob:' || url.origin !== origin) throw fail('export_unavailable', 'Export this edit again.');
        signal?.throwIfAborted();
        const response = await fetchBytes(url.href, { signal, credentials: 'omit', redirect: 'error' });
        if (!response.ok) throw fail('export_unavailable', 'Export this edit again.');
        blob = await response.blob();
    }
    signal?.throwIfAborted();
    if (!blob.size || blob.size > 100 * 1024 * 1024 || blob.type !== 'video/mp4') throw fail('invalid_export', 'Choose a non-empty MP4 export no larger than 100 MiB.');
    return new File([blob], result.name.slice(0, 180), { type: 'video/mp4' });
}

/** Every request, including cleanup, remains tied to the actor who began it. */
export function accountBoundCall(call, actor, getActor, signal) {
    return async (path, init = {}) => {
        signal?.throwIfAborted();
        if (!actor || actor !== getActor()) throw fail('account_changed', 'Your account changed. Reopen delivery options in your current account.');
        const result = await call(path, { ...init, signal: init.signal || signal });
        signal?.throwIfAborted();
        if (actor !== getActor()) throw fail('account_changed', 'Your account changed. Reopen delivery options in your current account.');
        return result;
    };
}

export async function saveEditorRender(file, { idempotencyKey, consent, call, transfer = fetch, signal, onProgress = () => {} }) {
    if (!consent) throw fail('rights_required', 'Confirm your rights before saving.');
    if (!file?.size || file.type !== 'video/mp4' || file.size > EDITOR_RENDER_MAX_BYTES) throw fail('render_too_large', 'Library renders can be up to 25 MiB. Choose Compact quality or shorten the edit.');
    signal?.throwIfAborted(); onProgress('Checking export…');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
    signal?.throwIfAborted();
    const reservation = await call('/library/editor-renders', { method: 'POST', signal, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ label: file.name.slice(0, 160), size_bytes: file.size, sha256, rights_confirmed: true }) });
    if (!UUID.test(reservation?.id || '')) throw fail('save_unavailable', 'The save could not be started. Try again.');
    if (reservation.state !== 'stored') {
        if (!reservation.upload_url || !reservation.headers) throw fail('save_unavailable', 'The save could not be started. Try again.');
        onProgress('Uploading to your private Library…');
        const uploaded = await transfer(reservation.upload_url, { method: 'PUT', credentials: 'omit', signal, headers: reservation.headers, body: file });
        if (!uploaded.ok && uploaded.status !== 412) throw fail('upload_failed', 'The upload did not complete. Retry Save to Library.');
        signal?.throwIfAborted(); onProgress('Inspecting and saving…');
        const inspected = await call(`/library/editor-renders/${reservation.id}/inspect`, { method: 'POST', signal });
        if (inspected.state !== 'stored') throw fail('invalid_render', 'The MP4 did not pass inspection. Export it again.');
    }
    return { id: reservation.id, url: `/app/library#render-${reservation.id}` };
}

export async function ownedPublishUpload(call, id) {
    if (!UUID.test(id || '')) throw fail('invalid_upload', 'Choose a saved upload from your account.');
    const page = await call('/social/uploads');
    const upload = page?.uploads?.find(item => item.id === id && item.mime_type === 'video/mp4');
    if (!upload || typeof upload.url !== 'string' || !upload.url.startsWith('https://')) throw fail('upload_unavailable', 'This upload is unavailable. Choose media from your current account.');
    return { uploadId: upload.id, mediaType: 'video', thumbUrl: upload.url };
}

/** Ready means both deployed capability and an active, released connected account. */
export function editorDestinations(data) {
    return SOCIAL_CATALOGUE.map(network => {
        const readiness = data?.networks?.find(n => n.key === network.key);
        const connected = data?.accounts?.filter(a => a.network === network.key && a.status === 'active' && a.publishingEnabled === true) || [];
        const supportsVideo = (readiness?.media || (network.key === 'youtube' ? ['video'] : [])).includes('video');
        const ready = supportsVideo && readiness?.available === true && connected.length > 0 && data?.uploadsEnabled === true;
        const reason = !supportsVideo ? (network.key === 'twitch' ? 'Statistics only; uploads unavailable.' : ['instagram', 'facebook', 'tiktok'].includes(network.key) ? 'Video delivery is not open for this connection.' : 'Video posting is not supported by this connection.')
            : readiness?.available !== true ? readiness?.status === 'not_released' ? 'Not released.' : 'Connection setup is required.'
            : data?.uploadsEnabled !== true ? 'Device video uploads are not open.'
            : !connected.length ? 'Connect an account in Publish.' : network.key === 'tiktok' ? 'Choose when to deliver to your inbox; finish posting in TikTok.' : 'Choose the account, visibility and posting time in Publish.';
        return { key: network.key, label: network.label, ready, reason };
    });
}
