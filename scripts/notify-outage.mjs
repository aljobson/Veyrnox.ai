#!/usr/bin/env node
// Tells the owner, on Slack and by email, that the database is down or back. Used by
// .github/workflows/supabase-status-alert.yml: `node scripts/notify-outage.mjs outage|recovery`.
//   SLACK_WEBHOOK_URL   Slack incoming webhook (secret). Only https://hooks.slack.com/ is accepted.
//   RESEND_API_KEY      Resend key (secret). ALERT_EMAIL_TO is the recipient; ALERT_EMAIL_FROM overrides the sender.
// A channel that is not configured is skipped. Exit 0 when at least one channel delivered, 1 when none did,
// so a run that could not reach the owner is red, never silently green.
import { fileURLToPath } from 'node:url';
import { reportResendConfig, sendEmail } from '../packages/adapters/resend.js';

const SLACK_URL_RE = /^https:\/\/hooks\.slack\.com\/(?:services|triggers)\/[A-Za-z0-9/_-]{10,200}$/;
const TIMEOUT_MS = 10_000;

export function buildMessage(kind, { runUrl = '', baseUrl = 'https://veyrnox.ai' } = {}) {
    if (kind !== 'outage' && kind !== 'recovery') throw new Error(`unknown alert kind: ${kind}`);
    const outage = kind === 'outage';
    const subject = outage ? 'Veyrnox.ai: Supabase is down' : 'Veyrnox.ai: Supabase is back';
    const text = outage
        ? `The database provider is failing: ${baseUrl}/api/status has reported "degraded" on two checks in a row.\n`
          + 'Sign-in and browsing keep working; creating, buying and saving are paused and the banner is showing. '
          + 'Nothing is spent against the credit ledger while it is down.\n'
        : `${baseUrl}/api/status is back to "ok". The banner clears on its own within about 10 seconds.\n`
          + 'Worth a look: reconcile_balances() should still return zero rows.\n';
    return { subject, text: runUrl ? `${text}\nRun: ${runUrl}\n` : text };
}

export async function sendSlack(webhookUrl, message, fetchImpl = fetch) {
    if (!webhookUrl) return { ok: false, error: 'not_configured' };
    if (!SLACK_URL_RE.test(webhookUrl)) return { ok: false, error: 'invalid_webhook' };
    try {
        const res = await fetchImpl(webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `*${message.subject}*\n${message.text}` }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return res.ok ? { ok: true } : { ok: false, error: `slack_${res.status}` };
    } catch {
        return { ok: false, error: 'slack_unreachable' };
    }
}

export async function notify(kind, env = process.env, deps = {}) {
    const message = buildMessage(kind, { runUrl: env.RUN_URL });
    const slack = await (deps.sendSlack || sendSlack)(env.SLACK_WEBHOOK_URL, message);
    const cfg = { ...reportResendConfig(env), ...(env.ALERT_EMAIL_FROM ? { from: env.ALERT_EMAIL_FROM } : {}) };
    // One email per workflow run and kind: a rerun of the same step reuses the key and Resend drops the duplicate.
    const email = env.ALERT_EMAIL_TO
        ? await (deps.sendEmail || sendEmail)(cfg, { to: env.ALERT_EMAIL_TO, subject: message.subject, text: message.text, idempotencyKey: `supabase-${kind}-${env.GITHUB_RUN_ID || Date.now()}` })
        : { ok: false, error: 'not_configured' };
    return { slack, email, delivered: slack.ok || email.ok };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = await notify(process.argv[2]);
    // Error codes only: never a webhook URL, key or address.
    console.log(`slack: ${result.slack.ok ? 'sent' : result.slack.error}; email: ${result.email.ok ? 'sent' : result.email.error}`);
    process.exit(result.delivered ? 0 : 1);
}
