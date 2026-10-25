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

import { rpc } from '../packages/db/supabase-client.js';
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
    url.searchParams.set('not_before', `lte.${new Date().toISOString()}`);
    url.searchParams.set('order', 'queued_at.asc');
    url.searchParams.set('limit', String(limit));
    let res = await fetchWithTimeout(url, { headers: headers(cfg) });
    let legacy = false;
    if (!res.ok) {
        const error = await res.json().catch(() => null);
        // One-release compatibility for a Worker rolled out before 0397.
        if (res.status === 400 && ['42703', 'PGRST204'].includes(error?.code) && error?.message?.includes('not_before')) {
            url.searchParams.delete('not_before');
            res = await fetchWithTimeout(url, { headers: headers(cfg) });
            legacy = true;
        }
    }
    if (!res.ok) return { ok: false, error: `queue read ${res.status}` };
    return { ok: true, rows: await res.json(), legacy };
}

async function markSuccess(cfg, id) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    const res = await fetchWithTimeout(url, { method: 'DELETE', headers: headers(cfg, { Prefer: 'return=minimal' }) });
    if (!res.ok) throw new Error(`queue delete ${res.status}`);
}

async function markFail(cfg, id, attempts, err) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    const res = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ attempts: attempts + 1, last_error: String(err).slice(0, 500) }),
    });
    if (!res.ok) throw new Error(`queue update ${res.status}`);
}

async function deferProtected(cfg, id) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    const res = await fetchWithTimeout(url, {
        method: 'PATCH', headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ not_before: new Date(Date.now() + 86400000).toISOString() }),
    });
    if (!res.ok) throw new Error(`queue defer ${res.status}`);
}

/**
 * @param {{supabaseUrl:string, serviceRoleKey:string}} cfg
 * @param {object} r2cfg
 * @returns {Promise<{ok:true, processed:number, deleted:number, failed:number, skipped:number}|{ok:false, error:string}>}
 */
export async function reapAssets(cfg, r2cfg, { batch = BATCH } = {}) {
    const q = await selectQueue(cfg, batch);
    if (!q.ok) return q;

    let deleted = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of q.rows) {
        let allowed;
        // An unavailable authorization check is not a failed storage deletion.
        try { allowed = q.legacy || await rpc('asset_reap_allowed', { p_key: row.r2_key }, cfg); }
        catch (error) {
            // Only a specifically missing function restores the old consumer.
            // Network, auth and other SQL errors still fail closed.
            if ([400, 404].includes(error.status) && ['PGRST202', '42883'].includes(error.body?.code)
                && error.body?.message?.includes('asset_reap_allowed')) allowed = true;
            else { skipped++; continue; }
        }
        if (allowed !== true) {
            // Move protected keys out of the next batch without losing a future
            // deletion after hold release, asset removal or grant expiry.
            try { await deferProtected(cfg, row.id); }
            catch { return { ok: false, error: 'queue bookkeeping failed', processed: deleted + failed + skipped, deleted, failed, skipped }; }
            skipped++;
            continue;
        }
        let del;
        try {
            // Queue snapshots predate concurrent takedowns. Recheck immediately before R2.
            del = await deleteObject(row.r2_key, r2cfg);
        }
        catch (err) { del = { ok: false, error: err?.message || 'delete failed' }; }
        try {
            if (del.ok) {
                await markSuccess(cfg, row.id);
                deleted += 1;
            } else {
                await markFail(cfg, row.id, row.attempts, del.error);
                failed += 1;
            }
        } catch {
            // Do not count a deletion as complete or double-PATCH an attempt
            // when bookkeeping failed. Leave the row for the next run.
            return { ok: false, error: 'queue bookkeeping failed', processed: deleted + failed + skipped, deleted, failed, skipped };
        }
    }
    return { ok: true, processed: q.rows.length, deleted, failed, skipped };
}
