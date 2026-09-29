import { rpc } from '../packages/db/supabase-client.js';
import { deleteObject, isConfigured } from '../packages/adapters/r2.js';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^org/${UUID}/project/${UUID}/asset/${UUID}/v1\\.(jpg|png|webp|mp4|mp3|wav)$`);

export async function cleanupProjectAssets(env, { rpcCall = rpc, remove = deleteObject } = {}) {
  if (env.TENANT_PROJECTS_ENABLED !== 'true') return { skipped: 'disabled' };
  const cfg = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
  const r2 = { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET, jurisdiction: env.R2_JURISDICTION };
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2)) return { skipped: 'not_configured' };
  const key = crypto.randomUUID();
  const result = { removed: 0, failed: 0 };
  try {
    const { items } = await rpcCall('claim_project_asset_cleanup', { p_key: key }, cfg);
    if (!Array.isArray(items) || items.length > 20 || items.some(i => !new RegExp(`^${UUID}$`).test(i?.id || '') || !KEY.test(i?.r2_key || '') || !i.r2_key.includes(`/asset/${i.id}/`))) throw Error('invalid_claim');
    for (let offset = 0; offset < items.length; offset += 4) {
      await Promise.all(items.slice(offset, offset + 4).map(async item => {
        try {
          if (!(await remove(item.r2_key, r2)).ok) throw Error('delete_failed');
          if (await rpcCall('finish_project_asset_cleanup', { p_id: item.id, p_key: key }, cfg) !== true) throw Error('finish_failed');
          result.removed++;
        } catch { result.failed++; }
      }));
    }
  } catch { result.failed++; }
  if (result.removed || result.failed) console.info(JSON.stringify({ event: 'project.asset_cleanup', ...result }));
  return result;
}
