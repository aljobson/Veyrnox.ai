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
import { select } from '../packages/db/supabase-client.js';
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

    // Walk every page. Keys are `uploads/{auth_id}/{uuid}`, so ListObjectsV2's
    // lexicographic order is effectively random but STABLE — which means a
    // single first page is not a sample, it is the same 200 keys every run.
    // Stopping there let ~200 unexpired objects at the front of the prefix
    // hide every expired object behind them, permanently, and the run still
    // reported ok with deleted: 0. This is the retention control for ADR-0025
    // section 8.1, so failing silently was the worst available behaviour.
    let token;
    let listedCount = 0;
    let expiredCount = 0;
    let foreignCount = 0;
    let deleted = 0;
    let failed = 0;

    do {
        const page = await list(`${UPLOAD_PREFIX}/`, r2cfg, { maxKeys: MAX_LISTED, continuationToken: token });
        if (!page.ok) {
            // Report what this run managed before the failure rather than
            // discarding it — the deletes already happened.
            return { ok: false, listed: listedCount, expired: expiredCount, deleted, failed, error: page.error };
        }
        listedCount += page.objects.length;

        // An object we did not mint is left alone and reported, never deleted.
        // If this is ever non-zero something else is writing to our prefix.
        foreignCount += page.objects.filter((o) => !isUploadKey(o.key)).length;

        const expired = page.objects.filter((o) => isUploadKey(o.key) && o.lastModified < cutoff);
        expiredCount += expired.length;

        for (const object of expired) {
            if (deleted + failed >= MAX_DELETES) break;
            const res = await remove(object.key, r2cfg);
            if (res && res.ok) deleted += 1;
            else {
                failed += 1;
                console.error('[upload-sweep] delete failed for an expired source:', res && res.error);
            }
        }

        token = page.nextToken;
    } while (token && deleted + failed < MAX_DELETES);

    if (foreignCount) {
        console.error('[upload-sweep] objects under the upload prefix that we did not mint:', foreignCount);
    }

    return { ok: true, listed: listedCount, expired: expiredCount, deleted, failed };
}

// A finished job's uploads are deleted on the next runs rather than left for
// the 24h sweep: the upload route caps how many an account may hold, so a
// consumed source kept for a day blocked a user after ~10 jobs (2026-09-22).
// Every run looks back this far, so a missed run costs nothing.
const CONSUMED_WINDOW_MINUTES = 30;
const TERMINAL_STATES = 'STORED,REFUNDED,FAILED';

/**
 * Delete the uploads of jobs that finished in the last half hour. A job's
 * uploads are named in `jobs.inputs.source_keys` (field -> key); only keys
 * this codebase mints are touched. Deleting an already-deleted key is a
 * no-op in R2, so the overlapping windows are harmless.
 *
 * @param {object} r2cfg  R2 credentials
 * @param {{supabaseUrl:string, serviceRoleKey:string}} dbcfg
 * @param {{now?: Date, find?: Function, remove?: Function}} [opts]
 * @returns {Promise<{ok:boolean, jobs:number, deleted:number, failed:number, error?:string}>}
 */
export async function sweepConsumedUploads(r2cfg, dbcfg, { now = new Date(), find = select, remove = deleteObject } = {}) {
    const since = new Date(now.getTime() - CONSUMED_WINDOW_MINUTES * 60 * 1000).toISOString();
    let rows;
    try {
        rows = await find('jobs', {
            columns: 'id,inputs',
            filter: `state=in.(${TERMINAL_STATES})&updated_at=gte.${encodeURIComponent(since)}&inputs->source_keys=not.is.null&order=updated_at.desc`,
            limit: MAX_DELETES,
        }, dbcfg);
    } catch (err) {
        return { ok: false, jobs: 0, deleted: 0, failed: 0, error: err && err.message };
    }
    const keys = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const map = row && row.inputs && row.inputs.source_keys;
        if (map && typeof map === 'object') for (const key of Object.values(map)) if (isUploadKey(key)) keys.add(key);
    }
    let deleted = 0;
    let failed = 0;
    for (const key of keys) {
        if (deleted + failed >= MAX_DELETES) break;
        const res = await remove(key, r2cfg);
        if (res && res.ok) deleted += 1;
        else { failed += 1; console.error('[upload-sweep] delete failed for a consumed source:', res && res.error); }
    }
    return { ok: true, jobs: Array.isArray(rows) ? rows.length : 0, deleted, failed };
}
