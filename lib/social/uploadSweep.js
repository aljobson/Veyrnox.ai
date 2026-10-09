import { rpc } from '../../packages/db/supabase-client.js';
import { deleteObject } from '../../packages/adapters/r2.js';

// Pending uploads expire after 24h. Ready files remain in the bounded library.
// Removed files wait until every signed PUT expires before storage is released.
export async function sweepSocialUploads(r2cfg, dbcfg, { call = rpc, remove = deleteObject } = {}) {
    try {
        const rows = await call('claim_social_upload_cleanup', {}, dbcfg);
        let deleted = 0, failed = 0;
        for (const row of rows) {
            if (!/^social-uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4)$/.test(row.r2_key)) { failed++; continue; }
            const result = await remove(row.r2_key, r2cfg);
            if (!result?.ok) { failed++; continue; }
            await call('release_social_upload', { p_id: row.id }, dbcfg);
            deleted++;
        }
        return { ok: failed === 0, deleted, failed };
    } catch { return { ok: false, error: 'social_upload_cleanup_failed' }; }
}
