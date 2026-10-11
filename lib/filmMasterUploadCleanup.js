import { rpc } from '../packages/db/supabase-client.js';
import { deleteObject } from '../packages/adapters/r2.js';

// Called only for reservations older than 24 hours. Their signed upload and
// save tickets expired after 15 minutes, so no new save can race this deletion.
export async function cleanUnregisteredFilmMaster(row, r2cfg, dbcfg, { enabled = process.env.FILM_LIBRARY_MASTERS_ENABLED === 'true', call = rpc, remove = deleteObject } = {}) {
    if (!enabled) return { ok: true };
    const match = /^uploads\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.mp4$/.exec(row.r2_key || '');
    if (!match) return { ok: true };
    if (!/^[0-9a-f-]{36}$/.test(row.user_id || '')) return { ok: false };
    try {
        const master = await call('get_film_library_master', { p_auth_id: match[1], p_id: match[2] }, dbcfg);
        if (master?.ok === true) return { ok: true };
        if (master?.code !== 'NOT_FOUND') return { ok: false };
        // Includes copies left by a failed/lost registration or a concurrent
        // save whose owner/source/digest already existed under another id.
        return await remove(`film-masters/${row.user_id}/${match[2]}.mp4`, r2cfg);
    } catch { return { ok: false }; }
}
