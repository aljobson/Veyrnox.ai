/**
 * Delete abandoned upload sources from R2.
 *
 * Generated assets are tracked in `assets` and swept by `expire_assets`
 * against `expires_at`. A user's uploaded source has no row — it is a bare
 * object under `uploads/{auth_id}/{uuid}` — so it is swept by prefix and age
 * instead.
 *
 * This is a legal control as much as a storage one. Every hour a third
 * party's file sits in our bucket is exposure we did not choose to take on
 * (ADR-0025 section 8.1), so the window is hours, not the asset default.
 *
 * Two safety rules, both deliberate:
 *   - only keys matching the pattern this codebase mints are ever deleted,
 *     so a mis-set prefix cannot reach generated assets;
 *   - the run is bounded, so one scheduled invocation cannot spend the
 *     Worker's whole budget on a large bucket. What it misses, the next run
 *     five minutes later picks up.
 */

import { listObjects, deleteObject } from '../packages/adapters/r2.js';
import { isUploadKey, UPLOAD_PREFIX, UPLOAD_MAX_AGE_HOURS } from './uploadSource.js';

// One run lists at most this many objects and deletes at most this many.
// The cron fires every 5 minutes, so the steady-state backlog drains quickly.
const MAX_LISTED = 200;
const MAX_DELETES = 50;

/**
 * `list` and `remove` default to the real R2 calls and exist so a test can
 * exercise the sweep's rules without SigV4 or a network.
 *
 * @param {object} r2cfg  R2 credentials, from r2.envConfig()
 * @param {{now?: Date, maxAgeHours?: number, list?: Function, remove?: Function}} [opts]
 * @returns {Promise<{ok:boolean, listed:number, expired:number, deleted:number, failed:number, error?:string}>}
 */
export async function sweepUploads(r2cfg, {
    now = new Date(),
    maxAgeHours = UPLOAD_MAX_AGE_HOURS,
    list = listObjects,
    remove = deleteObject,
} = {}) {
    const cutoff = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);

    const listed = await list(`${UPLOAD_PREFIX}/`, r2cfg, { maxKeys: MAX_LISTED });
    if (!listed.ok) return { ok: false, listed: 0, expired: 0, deleted: 0, failed: 0, error: listed.error };

    // An object we did not mint is left alone and reported, never deleted.
    // If this count is ever non-zero something is writing to our prefix.
    const foreign = listed.objects.filter((o) => !isUploadKey(o.key));
    if (foreign.length) {
        console.error('[upload-sweep] objects under the upload prefix that we did not mint:', foreign.length);
    }

    const expired = listed.objects.filter((o) => isUploadKey(o.key) && o.lastModified < cutoff);

    let deleted = 0;
    let failed = 0;
    for (const object of expired.slice(0, MAX_DELETES)) {
        const res = await remove(object.key, r2cfg);
        if (res && res.ok) deleted += 1;
        else {
            failed += 1;
            console.error('[upload-sweep] delete failed for an expired source:', res && res.error);
        }
    }

    return { ok: true, listed: listed.objects.length, expired: expired.length, deleted, failed };
}
