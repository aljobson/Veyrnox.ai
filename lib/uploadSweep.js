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
import { rpc, select } from '../packages/db/supabase-client.js';
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
 * @param {{now?: Date, maxAgeHours?: number, list?: Function, remove?: Function, isProtected?: Function}} [opts]
 * @returns {Promise<{ok:boolean, listed:number, expired:number, deleted:number, failed:number, error?:string}>}
 */
export async function sweepUploads(r2cfg, {
    now = new Date(),
    maxAgeHours = UPLOAD_MAX_AGE_HOURS,
    list = listObjects,
    remove = deleteObject,
    protectedKeys = new Set(),
    isProtected = async key => protectedKeys.has(key),
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

        const expired = page.objects.filter((o) => isUploadKey(o.key) && o.lastModified < cutoff && !protectedKeys.has(o.key));
        expiredCount += expired.length;

        for (const object of expired) {
            if (deleted + failed >= MAX_DELETES) break;
            try { if (await isProtected(object.key)) continue; }
            catch { return { ok: false, listed: listedCount, expired: expiredCount, deleted, failed,
                error: 'voice upload protection recheck failed' }; }
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
export async function sweepConsumedUploads(r2cfg, dbcfg, { now = new Date(), find = select, remove = deleteObject,
    protectedKeys = new Set(), isProtected = async key => protectedKeys.has(key) } = {}) {
    const oldestSafeJob = new Date(now.getTime() - 16 * 60 * 1000).toISOString();
    const since = new Date(now.getTime() - CONSUMED_WINDOW_MINUTES * 60 * 1000).toISOString();
    const window = `state=in.(${TERMINAL_STATES})&created_at=lte.${encodeURIComponent(oldestSafeJob)}&updated_at=gte.${encodeURIComponent(since)}`;
    const query = predicate => find('jobs', {
        columns: 'id,inputs', filter: `${window}&${predicate}&order=updated_at.desc`, limit: MAX_DELETES,
    }, dbcfg);
    let legacyRows;
    try {
        legacyRows = await query('inputs->source_keys=not.is.null');
    } catch (err) {
        return { ok: false, jobs: 0, deleted: 0, failed: 0, error: err && err.message };
    }
    let referenceRows = [], referenceQueryFailed = false;
    try {
        referenceRows = await query(`inputs=cs.${encodeURIComponent(JSON.stringify({ references: [{ origin: 'upload' }] }))}`);
    } catch {
        // A newer-schema query must never prevent existing chat/source-map cleanup.
        referenceQueryFailed = true;
        console.error('[upload-sweep] reference lookup failed; continuing legacy cleanup');
    }
    const rows = [...new Map([
        ...(Array.isArray(legacyRows) ? legacyRows : []),
        ...(Array.isArray(referenceRows) ? referenceRows : []),
    ].map(row => [row.id ?? JSON.stringify(row), row])).values()];
    const keys = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        for (const ref of Array.isArray(row?.inputs?.references) ? row.inputs.references : []) {
            if (ref?.origin === 'upload' && isUploadKey(ref.key) && !protectedKeys.has(ref.key)) keys.add(ref.key);
        }
        const map = row && row.inputs && row.inputs.source_keys;
        if (map && typeof map === 'object') for (const key of Object.values(map)) if (isUploadKey(key) && !protectedKeys.has(key)) keys.add(key);
    }
    let deleted = 0;
    let failed = 0;
    for (const key of keys) {
        if (deleted + failed >= MAX_DELETES) break;
        try { if (await isProtected(key)) continue; }
        catch { return { ok: false, jobs: rows.length, deleted, failed, error: 'voice upload protection recheck failed' }; }
        const res = await remove(key, r2cfg);
        if (res && res.ok) deleted += 1;
        else { failed += 1; console.error('[upload-sweep] delete failed for a consumed source:', res && res.error); }
    }
    return { ok: true, jobs: rows.length, deleted, failed, ...(referenceQueryFailed ? { referenceQueryFailed: true } : {}) };
}

const missingVoiceProtectionRpc = error => error?.status === 404
    && /PGRST202|schema cache|could not find the function/i.test(JSON.stringify(error?.body ?? error?.message ?? ''));

/**
 * Resolve uploads retained by an active private voice-verification record.
 * A missing RPC means migration 0616 has not landed yet. Any other database
 * failure is fail-closed: callers must skip upload deletion for that run.
 */
export async function protectedMusicVoiceUploads(dbcfg, { read = rpc } = {}) {
    try {
        const result = await read('music_voice_protected_uploads', {}, dbcfg);
        if (!result?.ok || !Array.isArray(result.keys) || result.keys.some(key => !isUploadKey(key))) {
            return { ok: false, keys: new Set(), error: 'invalid voice upload protection result' };
        }
        return { ok: true, keys: new Set(result.keys) };
    } catch (error) {
        if (missingVoiceProtectionRpc(error)) return { ok: true, keys: new Set(), migrationPending: true };
        return { ok: false, keys: new Set(), error: 'voice upload protection lookup failed' };
    }
}

/** Re-check one candidate immediately before deletion without returning the full retained-key set. */
export async function musicVoiceUploadProtected(dbcfg, key, { read = rpc } = {}) {
    if (!isUploadKey(key)) return { ok: false, protected: true, error: 'invalid upload key' };
    try {
        const result = await read('music_voice_upload_protected', { p_key: key }, dbcfg);
        return typeof result?.protected === 'boolean' && result?.ok === true
            ? { ok: true, protected: result.protected }
            : { ok: false, protected: true, error: 'invalid voice upload protection result' };
    } catch (error) {
        if (missingVoiceProtectionRpc(error)) return { ok: true, protected: false, migrationPending: true };
        return { ok: false, protected: true, error: 'voice upload protection lookup failed' };
    }
}
