import test from 'node:test';
import assert from 'node:assert/strict';
import { runSocialReportScheduleSweep } from '../lib/social/reportSchedule.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service' };

test('scheduled report sweep is closed by default', async () => {
  let calls = 0;
  const result = await runSocialReportScheduleSweep({ env: {}, cfg, rpcCall: async () => { calls += 1; } });
  assert.deepEqual(result, { ok: true, skipped: 'disabled' }); assert.equal(calls, 0);
});

test('scheduled report sweep marks every claimed report ready', async () => {
  const calls = [];
  const rpcCall = async (name, args) => {
    calls.push({ name, args });
    if (name === 'claim_social_report_deliveries') return { ok: true, reports: [
      { id: '11111111-1111-4111-8111-111111111111', claim_key: '22222222-2222-4222-8222-222222222222' },
      { id: '33333333-3333-4333-8333-333333333333', claim_key: '44444444-4444-4444-8444-444444444444' },
    ] };
    return { ok: args.p_id.startsWith('1') };
  };
  const result = await runSocialReportScheduleSweep({ env: { PUBLISH_SCHEDULED_REPORTS_ENABLED: 'true' }, cfg, rpcCall });
  assert.deepEqual(result, { ok: true, claimed: 2, ready: 1, failed: 1 });
  assert.deepEqual(calls.map((call) => call.name), ['claim_social_report_deliveries', 'complete_social_report_delivery', 'complete_social_report_delivery']);
  assert.deepEqual(calls[1].args, { p_id: '11111111-1111-4111-8111-111111111111', p_claim_key: '22222222-2222-4222-8222-222222222222',
    p_success: true, p_provider_id: null, p_error: null });
});
