import { rpc } from '../../packages/db/supabase-client.js';
import { socialScheduledReportsEnabled } from './publishFeature.js';

/** Advances due report templates into a visible "ready" state. No data leaves Veyrnox. */
export async function runSocialReportScheduleSweep({ env = process.env, cfg, rpcCall = rpc }) {
  if (!socialScheduledReportsEnabled(env)) return { ok: true, skipped: 'disabled' };
  if (!cfg?.supabaseUrl || !cfg?.serviceRoleKey) return { ok: false, skipped: 'not_configured' };
  const claimed = await rpcCall('claim_social_report_deliveries', { p_limit: 10 }, cfg);
  if (!claimed?.ok) return { ok: false, error: 'claim_failed' };
  let ready = 0, failed = 0;
  for (const report of claimed.reports || []) {
    const completed = await rpcCall('complete_social_report_delivery', { p_id: report.id, p_claim_key: report.claim_key,
      p_success: true, p_provider_id: null, p_error: null }, cfg);
    if (completed?.ok) ready += 1; else failed += 1;
  }
  return { ok: true, claimed: (claimed.reports || []).length, ready, failed };
}
