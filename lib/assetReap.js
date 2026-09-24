/**
 * Drain the asset_reap_queue: delete the R2 objects expire_assets (0016)
 * queued when it removed their `assets` rows.
 *
 * This lived only inside POST /api/admin/reap-assets, which nothing called —
 * so the pg_cron half ran every 15 minutes, the rows disappeared on day 90,
 * and the bytes stayed in R2 forever (audit 2026-09-23). The Worker cron now
 * calls this every five minutes; the admin route is the manual replay.
 *
 * A row that fails keeps its place with attempts + 1 and the error, so a
 * permanently failing key is visible rather than retried invisibly forever.
 */

import { fetchWithTimeout } from './fetchWithTimeout.js';
import { deleteObject } from '../packages/adapters/r2.js';

export const BATCH = 100;
// Past this many tries a key is almost certainly not going away on its own
// (a bucket that no longer holds it, a malformed key): stop paying for the
// attempt every cron tick and let the count carry the signal.
export const MAX_ATTEMPTS = 8;

const headers = (cfg, extra = {}) => ({
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    ...extra,
});

async function selectQueue(cfg, limit) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('select', 'id,r2_key,attempts');
    url.searchParams.set('attempts', `lt.${MAX_ATTEMPTS}`);
    url.searchParams.set('order', 'queued_at.asc');
    url.searchParams.set('limit', String(limit));
    const res = await fetchWithTimeout(url, { headers: headers(cfg) });
    if (!res.ok) return { ok: false, error: `queue read ${res.status}` };
    return { ok: true, rows: await res.json() };
}

function markSuccess(cfg, id) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    return fetchWithTimeout(url, { method: 'DELETE', headers: headers(cfg, { Prefer: 'return=minimal' }) });
}

function markFail(cfg, id, attempts, err) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    return fetchWithTimeout(url, {
        method: 'PATCH',
        headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ attempts: attempts + 1, last_error: String(err).slice(0, 500) }),
    });
}

/**
 * @param {{supabaseUrl:string, serviceRoleKey:string}} cfg
 * @param {object} r2cfg
 * @returns {Promise<{ok:true, processed:number, deleted:number, failed:number}|{ok:false, error:string}>}
 */
export async function reapAssets(cfg, r2cfg, { batch = BATCH } = {}) {
    const q = await selectQueue(cfg, batch);
    if (!q.ok) return q;

    let deleted = 0;
    let failed = 0;
    for (const row of q.rows) {
        try {
            const del = await deleteObject(row.r2_key, r2cfg);
            if (del.ok) {
                await markSuccess(cfg, row.id);
                deleted += 1;
            } else {
                await markFail(cfg, row.id, row.attempts, del.error);
                failed += 1;
            }
        } catch (err) {
            await markFail(cfg, row.id, row.attempts, err && err.message);
            failed += 1;
        }
    }
    return { ok: true, processed: q.rows.length, deleted, failed };
}
