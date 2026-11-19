import { rpc } from '../packages/db/supabase-client.js';
import { deleteObject, isConfigured } from '../packages/adapters/r2.js';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^org/${UUID}/project/${UUID}/file/(${UUID})/v1\\.fcproj$`);
export async function cleanupProjectFiles(env, { rpcCall = rpc, remove = deleteObject } = {}) {
    if (env.TENANT_PROJECTS_ENABLED !== 'true') return { skipped: 'disabled' };
    const cfg = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    const r2 = { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET, jurisdiction: env.R2_JURISDICTION };
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2)) return { skipped: 'not_configured' };
    const key = crypto.randomUUID(), result = { removed: 0, failed: 0, claimed_unpurged: 0 };
    try {
        const claim = await rpcCall('claim_project_file_cleanup', { p_key: key }, cfg);
        if (!Array.isArray(claim.items) || claim.items.length > 20 || !Number.isSafeInteger(claim.claimed_unpurged) || claim.claimed_unpurged < 0) throw Error('invalid_claim');
        result.claimed_unpurged = claim.claimed_unpurged;
        for (let offset = 0; offset < claim.items.length; offset += 4) {
            await Promise.all(claim.items.slice(offset, offset + 4).map(async item => {
                let reason = 'invalid_key';
                try {
                    if (!new RegExp(`^${UUID}$`).test(item?.id || '') || KEY.exec(item?.r2_key || '')?.[1] !== item.id) throw Error('invalid_key');
                    reason = 'delete_failed';
                    if (!(await remove(item.r2_key, r2)).ok) throw Error('delete_failed');
                    reason = 'finish_failed';
                    if (await rpcCall('finish_project_file_cleanup', { p_id: item.id, p_key: key, p_error: null }, cfg) !== true) throw Error('finish_failed');
                    result.removed++; result.claimed_unpurged--;
                } catch {
                    result.failed++;
                    if (new RegExp(`^${UUID}$`).test(item?.id || '')) {
                        try { await rpcCall('finish_project_file_cleanup', { p_id: item.id, p_key: key, p_error: reason }, cfg); } catch { /* Lease expiry permits another sweep. */ }
                    }
                }
            }));
        }
    } catch (error) {
        // Code deployed before migration 0562: PostgREST answers 404 / PGRST202. Not a failure.
        const body = typeof error?.body === 'string' ? error.body : JSON.stringify(error?.body ?? '');
        if (error?.status === 404 || /PGRST202/.test(body)) return { skipped: 'not_migrated' };
        result.failed++; result.claimed_unpurged = 0;
    }
    console.info(JSON.stringify({ event: 'project.file_cleanup', ...result }));
    return result;
}
