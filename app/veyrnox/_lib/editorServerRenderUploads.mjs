import { ALLOWED_UPLOAD_TYPES } from '../../../lib/uploadSource.js';
import { renderSnapshot, renderAttempt } from './editorServerRenderClient.mjs';

export const REUSE_MS = 22 * 60 * 60 * 1000;
const supported = new Set(['video/mp4', 'audio/mpeg', 'audio/wav']);
const aliases = new Map([
    ['audio/x-wav', 'audio/wav'], ['audio/wave', 'audio/wav'], ['audio/vnd.wave', 'audio/wav'],
    ['audio/mp3', 'audio/mpeg'], ['audio/x-mpeg', 'audio/mpeg'],
]);
const serverMedia = id => /^[jefu]-/.test(id);
const failure = code => Object.assign(new Error(code), { code });
export function exportDocument(document) {
    if (!document) return null;
    const copy = structuredClone(document), tl = copy.timeline;
    const used = new Set([...tl.video, ...tl.audio].map(clip => clip.mediaId));
    // Only the export copy loses unused bin entries; cloud/local edits remain intact.
    tl.media = Object.fromEntries(Object.entries(tl.media).filter(([id]) => used.has(id)));
    return copy;
}
export function localRenderFiles(document, blobs = new Map()) {
    const files = [], errors = [];
    for (const media of Object.values(document.timeline.media)) {
        if (serverMedia(media.id)) continue;
        const blob = blobs.get(media.id), type = aliases.get(blob?.type) || blob?.type;
        const code = !blob ? 'localMissing' : !supported.has(type) ? 'localType'
            : !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > ALLOWED_UPLOAD_TYPES[type].maxBytes ? 'localSize' : null;
        if (code) errors.push({ id: media.id, name: media.name, code });
        else files.push({ id: media.id, name: media.name, blob, type, size: blob.size });
    }
    if (files.length > 10) errors.push({ code: 'localCount' });
    return { files, errors };
}
export function reusableUpload(record, file, actor, now = Date.now()) {
    return !!record?.complete && record.actor === actor && record.blob === file.blob && now < (record.reservedUntil ?? record.anchor + REUSE_MS);
}
export const pendingRenderFiles = (files, cache, actor, now = Date.now()) => files.filter(file => !reusableUpload(cache.get(file.id), file, actor, now));
export function remapRenderDocument(document, mapping) {
    const copy = structuredClone(document), tl = copy.timeline;
    tl.media = Object.fromEntries(Object.entries(tl.media).map(([id, media]) => {
        const next = mapping.get(id) || id;
        return [next, { ...media, id: next }];
    }));
    for (const clip of [...tl.video, ...tl.audio]) clip.mediaId = mapping.get(clip.mediaId) || clip.mediaId;
    return copy;
}
/** Called only before FIRST send. A sent attempt is always retried as-is. */
export function uploadedRenderAttempt(snapshot, price, key, files, cache, actor, now = Date.now()) {
    if (pendingRenderFiles(files, cache, actor, now).length) throw failure('upload_consent_expired');
    const mapping = new Map(files.map(file => [file.id, cache.get(file.id).mediaId]));
    const doc = remapRenderDocument(snapshot.document, mapping);
    return Object.freeze({ ...renderAttempt(renderSnapshot(doc, Number.parseInt(snapshot.resolution), snapshot.label), price, key),
        uploadedLocalFiles: files.length > 0 });
}

/** One file at a time; completed sources survive refusals/cancellation in cache. */
export async function uploadRenderFiles(files, { actor, getActor, cache, consent, call, transfer = putRenderBlob,
    signal, now = Date.now, onProgress = () => {} }) {
    const check = () => {
        signal?.throwIfAborted();
        if (actor !== getActor()) throw failure('account_changed');
    };
    check();
    const pending = pendingRenderFiles(files, cache, actor, now());
    if (pending.some(file => !consent.includes(file.id))) throw failure('upload_consent_expired');
    for (const [index, file] of pending.entries()) {
        check();
        let record = cache.get(file.id);
        if (record?.actor !== actor || record?.blob !== file.blob || record.complete) record = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            check();
            try {
                if (!record || now() >= record.expiresAt) {
                    // Captured BEFORE requesting: PUT completion never extends retention.
                    const anchor = now();
                    const grant = await call('/uploads', { method: 'POST', signal, preserveUploadErrors: true,
                        body: JSON.stringify({ content_type: file.type, size_bytes: file.size,
                            batch_count: pending.length - index, batch_bytes: pending.slice(index).reduce((sum, item) => sum + item.size, 0) }) });
                    check();
                    const match = /^uploads\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|mp3|wav)$/.exec(grant.key || '');
                    if (grant.reserved !== true || !match || match[1] !== actor.toLowerCase() || !grant.upload_url || !grant.headers
                        || grant.content_type !== file.type || !Number.isFinite(grant.expires_in) || grant.expires_in <= 0) throw failure('upload_invalid_grant');
                    const deadline = typeof grant.reserved_until === 'string' ? Date.parse(grant.reserved_until) : NaN;
                    record = { actor, blob: file.blob, anchor, reservedUntil: Number.isFinite(deadline) ? deadline : undefined,
                        expiresAt: anchor + grant.expires_in * 1000,
                        mediaId: `u-${match[2]}`, grant, complete: false };
                    cache.set(file.id, record);
                }
                onProgress({ id: file.id, name: file.name, progress: 0 });
                const response = await transfer(record.grant.upload_url, { method: 'PUT', credentials: 'omit',
                    headers: record.grant.headers, body: file.blob, signal,
                    onProgress: progress => onProgress({ id: file.id, name: file.name, progress }) });
                check();
                if (!response.ok && response.status !== 412) {
                    if (response.status === 403 && now() >= record.expiresAt) { record = null; continue; }
                    throw failure('upload_failed');
                }
                // A lost success followed by 412 is checked by create, never overwritten.
                record.complete = true;
                onProgress({ id: file.id, name: file.name, progress: 1 });
                break;
            } catch (error) {
                check();
                if (attempt === 2 || !(error instanceof TypeError || error.code === 'network_error')) throw error;
            }
        }
        if (!record?.complete) throw failure('upload_failed');
    }
    check();
    if (pendingRenderFiles(files, cache, actor, now()).length) throw failure('upload_consent_expired');
}

export function putRenderBlob(url, { headers, body, signal, onProgress }) {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const finish = fn => value => { signal?.removeEventListener('abort', abort); fn(value); };
        xhr.open('PUT', url);
        // Content-Length is browser controlled and derived from the unchanged Blob.
        // Pass the complete grant; the browser ignores only forbidden headers.
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
        xhr.onload = finish(() => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status }));
        xhr.onerror = finish(() => reject(failure('network_error')));
        xhr.onabort = finish(() => reject(new DOMException('Aborted', 'AbortError')));
        signal?.addEventListener('abort', abort, { once: true });
        xhr.send(body);
    });
}
