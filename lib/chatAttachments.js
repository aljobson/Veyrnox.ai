// Chat turn image attachments (ADR-0068): resolving a fresh send's images, and finding a send already stored under its
// key so a retry is answered from its job (amendment 4). Split from chatTurn.js to keep it under the file-size limit.
import { MAX_IMAGE_EDGE } from './chat.js';

export const STORED_SEND_UNKNOWN = Symbol('stored_send_unknown');

/**
 * The inputs of the caller's own job stored under this send's key: null when there is none, STORED_SEND_UNKNOWN when the
 * read failed. jobs is unique on (user_id, idempotency_key), so a job found here is the only one the ledger can replay.
 */
export async function findStoredSend(select, userId, key, cfg) {
    try {
        const rows = await select('jobs', { columns: 'id,inputs', filter: `user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(key)}`, limit: 1 }, cfg);
        const row = Array.isArray(rows) && rows[0];
        if (!row || !row.id) return null;
        return row.inputs && typeof row.inputs === 'object' ? row.inputs : {};
    } catch (err) {
        console.error('[chat] stored send lookup failed:', err && err.message);
        return STORED_SEND_UNKNOWN;
    }
}

/**
 * The attachment part of a stored chat job, when the request names exactly the images it recorded: the same upload keys
 * and Library ids under the same image_N labels (keys first, then assets, as resolveAttachments numbers them). Null
 * otherwise, which is a different request under the same key.
 */
export function storedImageInputs(stored, keys, assetIds) {
    if (stored.kind !== 'chat' || !Array.isArray(stored.attachments)) return null;
    const wantKeys = Object.fromEntries(keys.map((k, i) => [`image_${i + 1}`, k]));
    const wantAssets = Object.fromEntries(assetIds.map((id, j) => [`image_${keys.length + j + 1}`, id]));
    const same = (got, want) => {
        const g = got && typeof got === 'object' ? got : {};
        const names = Object.keys(want);
        return Object.keys(g).length === names.length && names.every((n) => g[n] === want[n]);
    };
    if (!same(stored.source_keys, wantKeys) || !same(stored.source_assets, wantAssets)) return null;
    return {
        ok: true, urls: [],
        inputs: {
            attachments: stored.attachments,
            ...(keys.length ? { source_keys: stored.source_keys } : {}),
            ...(assetIds.length ? { source_assets: stored.source_assets } : {}),
        },
    };
}

/**
 * Resolve each attached image for this caller: upload keys, then Library assets (the caller's own finished images, by
 * job id). Both pass the same checks: the caller's own, really an image, within the size cap. The job records upload
 * keys under `source_keys`, which is where the upload sweeper looks, so those files are deleted soon after the reply
 * instead of waiting out the age limit. A Library asset is recorded under `source_assets` and NEVER under
 * `source_keys`: the sweeper must not be able to delete a file the person still owns. The pixel size and type are kept
 * for the thread, never the file name.
 */
export async function resolveAttachments(authId, keys, assetIds, resolveImage, resolveAsset, order) {
    let results;
    try {
        results = await Promise.all([...keys.map((k) => resolveImage(authId, k)), ...assetIds.map((id) => resolveAsset(authId, id))]);
    } catch (err) {
        console.error('[chat] attachment check failed:', err && err.message);
        return { ok: false, status: 502, error: 'attachment_check_failed' };
    }
    // Results come back keys first, then assets. The model and the thread get them in the order the request named them
    // (`order`, present only when both kinds are mixed). The job's image_N labels keep their keys-then-assets numbering: they
    // are part of the request identity a retried send is matched on (0399), so renumbering would refuse a retry of a job
    // admitted before this change instead of finding it.
    const sequence = [];
    if (Array.isArray(order) && order.length === results.length) {
        let k = 0, a = 0;
        for (const kind of order) sequence.push(kind === 'asset' ? keys.length + a++ : k++);
    } else for (let i = 0; i < results.length; i++) sequence.push(i);
    const urls = [], attachments = [], source_keys = {}, source_assets = {};
    for (let n = 0; n < sequence.length; n++) {
        const i = sequence[n];
        const r = results[i];
        const isAsset = i >= keys.length;
        if (!r || r.ok !== true) {
            if (r && r.error === 'internal') return { ok: false, status: 502, error: 'attachment_check_failed' };
            if (r && r.error === 'source_type_unsupported') return { ok: false, status: 400, error: 'attachment_type_unsupported' };
            return { ok: false, status: 400, error: r && r.error === 'source_not_found' ? 'attachment_not_found' : 'attachment_invalid' };
        }
        if (typeof r.contentType !== 'string' || !r.contentType.startsWith('image/')) return { ok: false, status: 400, error: 'attachment_type_unsupported' };
        const d = r.dimensions;
        if (!d || !(d.width > 0) || !(d.height > 0)) return { ok: false, status: 400, error: 'attachment_invalid' };
        if (Math.max(d.width, d.height) > MAX_IMAGE_EDGE) return { ok: false, status: 400, error: 'image_too_large' };
        urls.push(r.url);
        attachments.push({ type: r.contentType, width: d.width, height: d.height });
        if (isAsset) source_assets[`image_${i + 1}`] = assetIds[i - keys.length];
        else source_keys[`image_${i + 1}`] = keys[i];
    }
    return {
        ok: true, urls,
        inputs: {
            attachments,
            ...(Object.keys(source_keys).length ? { source_keys } : {}),
            ...(Object.keys(source_assets).length ? { source_assets } : {}),
        },
    };
}
