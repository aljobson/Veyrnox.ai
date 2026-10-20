import { rpc } from '../../packages/db/supabase-client.js';
import { reportResendConfig, sendEmail } from '../../packages/adapters/resend.js';
import { buildReportDocument } from './reportDocuments.js';
import { loadSocialReportData } from './reportData.js';
import { readAccountLanguage } from '../accountLanguage.js';
import { renderReportDefault } from '../i18n/email.mjs';
import { socialReportDeliveryEnabled, socialScheduledReportsEnabled } from './publishFeature.js';

function b64(bytes) {
  let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function key(report, index) {
  const stamp = String(Date.parse(report.scheduled_for || '') || 0);
  return `report_${String(report.id).replaceAll('-', '')}_${stamp}_${index}`.slice(0, 128);
}

/** Builds and sends due report attachments. Closed until the dedicated delivery flag and sender are configured. */
export async function runSocialReportScheduleSweep({ env = process.env, cfg, rpcCall = rpc, loadData = loadSocialReportData,
  buildDocument = buildReportDocument, send = sendEmail }) {
  if (!socialScheduledReportsEnabled(env) || !socialReportDeliveryEnabled(env)) return { ok: true, skipped: 'disabled' };
  if (!cfg?.supabaseUrl || !cfg?.serviceRoleKey) return { ok: false, skipped: 'not_configured' };
  const mail = reportResendConfig(env);
  if (!mail.apiKey || !mail.from) return { ok: false, skipped: 'email_not_configured' };
  const claimed = await rpcCall('claim_social_report_deliveries', { p_limit: 10 }, cfg);
  if (!claimed?.ok) return { ok: false, error: 'claim_failed' };
  let sent = 0, failed = 0;
  for (const report of claimed.reports || []) {
    let success = false, providerId = null, error = 'delivery_failed';
    try {
      const data = await loadData({ template: report, authId: report.owner_auth_id, brandId: report.brand_id, cfg, rpcCall });
      if (!data?.ok) error = data?.error || 'analytics_unavailable';
      else {
        const document = buildDocument(report, data, report.delivery_format || 'pdf');
        const locale = report.delivery_message ? null : await readAccountLanguage(report.owner_auth_id, cfg, rpcCall);
        const results = [];
        for (const [index, recipient] of (report.delivery_recipients || []).entries()) {
          results.push(await send(mail, { to: recipient, subject: report.report_title || report.name,
            text: report.delivery_message || renderReportDefault({ from: data.range.from, to: data.range.to }, locale),
            replyTo: report.delivery_reply_to || undefined, idempotencyKey: key(report, index),
            attachments: [{ filename: document.filename, content: b64(document.bytes) }] }));
        }
        success = results.length > 0 && results.every((item) => item.ok);
        providerId = results.filter((item) => item.id).map((item) => item.id).join(',').slice(0, 500) || null;
        if (!success) error = results.find((item) => !item.ok)?.error || 'delivery_failed';
      }
    } catch { error = 'delivery_failed'; }
    const completed = await rpcCall('complete_social_report_delivery', { p_id: report.id, p_claim_key: report.claim_key,
      p_success: success, p_provider_id: providerId, p_error: success ? null : error }, cfg);
    if (success && completed?.ok) sent += 1; else failed += 1;
  }
  return { ok: true, claimed: (claimed.reports || []).length, sent, failed };
}
