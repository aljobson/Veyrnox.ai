import { deleteObject } from '../packages/adapters/r2.js';
import { select, rpc } from '../packages/db/supabase-client.js';
import { isUploadKey } from './uploadSource.js';

/** Release budget only after R2 confirms deletion, including an absent object. */
export async function removeReservedUpload(key, r2cfg, dbcfg, { remove = deleteObject, release = rpc } = {}) {
    if (!isUploadKey(key)) return { ok: false, error: 'invalid upload key' };
    const deleted = await remove(key, r2cfg);
    if (!deleted?.ok) return deleted;
    try { await release('release_upload', { p_key: key }, dbcfg); }
    catch { return { ok: false, error: 'upload reservation release failed' }; }
    return deleted;
}

/** Also cleans reservations whose URL was never used, so empty slots recover. */
export async function sweepUploadReservations(r2cfg, dbcfg, { now = new Date(), find = select, remove = removeReservedUpload } = {}) {
    try {
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const rows = await find('upload_reservations', {
            columns: 'r2_key', filter: `created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.asc`, limit: 50,
        }, dbcfg);
        let deleted = 0, failed = 0;
        for (const row of rows) {
            const result = await remove(row.r2_key, r2cfg, dbcfg);
            if (result?.ok) deleted++; else failed++;
        }
        return { ok: failed === 0, deleted, failed };
    } catch { return { ok: false, error: 'upload reservation sweep failed' }; }
}
