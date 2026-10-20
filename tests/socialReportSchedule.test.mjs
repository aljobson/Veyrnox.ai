import test from 'node:test';
import assert from 'node:assert/strict';
import { runSocialReportScheduleSweep } from '../lib/social/reportSchedule.js';
import { reportResendConfig } from '../packages/adapters/resend.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service' };
const enabled = { PUBLISH_SCHEDULED_REPORTS_ENABLED: 'true', PUBLISH_REPORT_DELIVERY_ENABLED: 'true', RESEND_API_KEY: 're_test', REPORT_EMAIL_FROM: 'Veyrnox <reports@veyrnox.ai>' };
const report = { id: '11111111-1111-4111-8111-111111111111', claim_key: '22222222-2222-4222-8222-222222222222', scheduled_for: '2026-10-14T09:00:00Z', brand_id: 'b1', owner_auth_id: 'u1', name: 'Weekly', range_days: 7, compare_previous: false, include_content: true, delivery_format: 'pdf', delivery_recipients: ['one@example.com', 'two@example.com'] };

test('scheduled delivery is closed until both rollout flags are open', async () => {
  let calls = 0;
  const result = await runSocialReportScheduleSweep({ env: { PUBLISH_SCHEDULED_REPORTS_ENABLED: 'true' }, cfg, rpcCall: async () => { calls += 1; } });
  assert.deepEqual(result, { ok: true, skipped: 'disabled' }); assert.equal(calls, 0);
});

test('scheduled delivery refuses to claim work without its email provider key', async () => {
  let calls = 0;
  const result = await runSocialReportScheduleSweep({ env: { PUBLISH_SCHEDULED_REPORTS_ENABLED: 'true', PUBLISH_REPORT_DELIVERY_ENABLED: 'true' }, cfg, rpcCall: async () => { calls += 1; } });
  assert.deepEqual(result, { ok: false, skipped: 'email_not_configured' }); assert.equal(calls, 0);
});

test('report delivery uses the verified Veyrnox sender unless explicitly overridden', () => {
  assert.deepEqual(reportResendConfig({ RESEND_API_KEY: 're_test' }), {
    apiKey: 're_test', from: 'Veyrnox Reports <support@veyrnox.ai>', replyTo: 'support@veyrnox.ai',
  });
});

test('scheduled report sweep builds one attachment and sends it to every recipient', async () => {
  const calls = [], messages = [];
  const rpcCall = async (name, args) => { calls.push({ name, args }); if (name === 'claim_social_report_deliveries') return { ok: true, reports: [report] }; return { ok: true }; };
  const result = await runSocialReportScheduleSweep({ env: enabled, cfg, rpcCall,
    loadData: async () => ({ ok: true, range: { from: '2026-10-08', to: '2026-10-14' } }),
    buildDocument: () => ({ bytes: Uint8Array.of(1, 2, 3), filename: 'weekly.pdf', contentType: 'application/pdf' }),
    send: async (mail, message) => { messages.push({ mail, message }); return { ok: true, id: `email-${messages.length}` }; },
  });
  assert.deepEqual(result, { ok: true, claimed: 1, sent: 1, failed: 0 }); assert.equal(messages.length, 2);
  assert.equal(messages[0].message.attachments[0].content, 'AQID'); assert.notEqual(messages[0].message.idempotencyKey, messages[1].message.idempotencyKey);
  assert.deepEqual(calls.at(-1).args, { p_id: report.id, p_claim_key: report.claim_key, p_success: true, p_provider_id: 'email-1,email-2', p_error: null });
});

test('a partial recipient failure fails the claimed delivery for retry', async () => {
  const calls = [];
  const result = await runSocialReportScheduleSweep({ env: enabled, cfg,
    rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'claim_social_report_deliveries' ? { ok: true, reports: [report] } : { ok: true }; },
    loadData: async () => ({ ok: true, range: { from: '2026-10-08', to: '2026-10-14' } }), buildDocument: () => ({ bytes: Uint8Array.of(1), filename: 'weekly.pdf' }),
    send: async (_mail, message) => message.to.startsWith('one') ? { ok: true, id: 'e1' } : { ok: false, error: 'resend_503' },
  });
  assert.deepEqual(result, { ok: true, claimed: 1, sent: 0, failed: 1 });
  assert.equal(calls.at(-1).args.p_success, false); assert.equal(calls.at(-1).args.p_error, 'resend_503');
});

test('the default report sentence follows the report owner account language; a custom message and English stay as written', async () => {
  const run = async (locale, extra = {}) => {
    const messages = [];
    const rpcCall = async (name, args) => {
      if (name === 'claim_social_report_deliveries') return { ok: true, reports: [{ ...report, ...extra }] };
      if (name === 'get_user_language') { assert.equal(args.p_auth_id, report.owner_auth_id); return { ok: true, locale }; }
      return { ok: true };
    };
    await runSocialReportScheduleSweep({ env: enabled, cfg, rpcCall,
      loadData: async () => ({ ok: true, range: { from: '2026-10-08', to: '2026-10-14' } }),
      buildDocument: () => ({ bytes: Uint8Array.of(1), filename: 'weekly.pdf', contentType: 'application/pdf' }),
      send: async (mail, message) => { messages.push(message); return { ok: true, id: 'e' }; } });
    return messages[0].text;
  };
  assert.equal(await run(null, { delivery_message: null }), 'Your Veyrnox.ai Publish report for 2026-10-08 to 2026-10-14 is attached.');
  assert.equal(await run('de', { delivery_message: null }), 'Ihr Veyrnox.ai-Publish-Bericht für den Zeitraum 2026-10-08 bis 2026-10-14 ist angehängt.');
  assert.equal(await run('de', { delivery_message: 'Weekly numbers' }), 'Weekly numbers');
});
