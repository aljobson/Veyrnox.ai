import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkStatus, readOnce, EXIT_CODES } from '../scripts/check-supabase-status.mjs';
import { buildMessage, notify, sendSlack } from '../scripts/notify-outage.mjs';

const noSleep = async () => {};
const seq = (...states) => { let i = 0; return async () => states[Math.min(i++, states.length - 1)]; };
const HOOK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX';

test('degraded needs two readings in a row; any ok clears it', async () => {
    assert.equal(await checkStatus('https://x.test', { read: seq('ok'), sleep: noSleep }), 'ok');
    assert.equal(await checkStatus('https://x.test', { read: seq('degraded', 'ok'), sleep: noSleep }), 'ok');
    assert.equal(await checkStatus('https://x.test', { read: seq('degraded', 'degraded'), sleep: noSleep }), 'degraded');
});

test('a site that does not answer is unreachable, which site-health owns', async () => {
    assert.equal(await checkStatus('https://x.test', { read: seq('unreachable', 'unreachable'), sleep: noSleep }), 'unreachable');
    assert.equal(await checkStatus('https://x.test', { read: seq('degraded', 'unreachable'), sleep: noSleep }), 'unreachable');
    assert.deepEqual(EXIT_CODES, { ok: 0, degraded: 1, unreachable: 2 });
});

test('a reading is degraded only for an explicit degraded body', async () => {
    const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
    assert.equal(await readOnce('https://x.test', reply(200, { status: 'degraded' })), 'degraded');
    assert.equal(await readOnce('https://x.test', reply(200, { status: 'ok' })), 'ok');
    assert.equal(await readOnce('https://x.test', reply(200, { status: 'unknown' })), 'ok');
    assert.equal(await readOnce('https://x.test', reply(502, {})), 'unreachable');
    assert.equal(await readOnce('https://x.test', async () => { throw new Error('down'); }), 'unreachable');
});

test('the two messages say what is down and what keeps working, and carry the run link', () => {
    const down = buildMessage('outage', { runUrl: 'https://github.test/run/1' });
    assert.match(down.subject, /down/);
    assert.match(down.text, /creating, buying and saving are paused/);
    assert.match(down.text, /Run: https:\/\/github\.test\/run\/1/);
    assert.match(buildMessage('recovery').subject, /back/);
    assert.throws(() => buildMessage('nope'));
});

test('Slack only takes a hooks.slack.com webhook, and reports a code, never the URL', async () => {
    const message = buildMessage('outage');
    assert.deepEqual(await sendSlack('', message), { ok: false, error: 'not_configured' });
    assert.deepEqual(await sendSlack('https://evil.test/services/T000/B000/XXXXXXXXXXXXXXXX', message), { ok: false, error: 'invalid_webhook' });
    let seen;
    assert.deepEqual(await sendSlack(HOOK, message, async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200 }; }), { ok: true });
    assert.equal(seen.url, HOOK);
    assert.match(seen.body.text, /Supabase is down/);
    assert.deepEqual(await sendSlack(HOOK, message, async () => ({ ok: false, status: 404 })), { ok: false, error: 'slack_404' });
    assert.deepEqual(await sendSlack(HOOK, message, async () => { throw new Error(HOOK); }), { ok: false, error: 'slack_unreachable' });
});

test('delivered when either channel works; undelivered only when both fail; one email key per run and kind', async () => {
    const env = { SLACK_WEBHOOK_URL: HOOK, ALERT_EMAIL_TO: 'owner@example.test', RESEND_API_KEY: 'test-key-12345678', GITHUB_RUN_ID: '42' };
    const calls = [];
    const deps = { sendSlack: async () => ({ ok: false, error: 'slack_500' }), sendEmail: async (cfg, mail) => { calls.push({ cfg, mail }); return { ok: true, id: 'e1' }; } };
    const both = await notify('outage', env, deps);
    assert.equal(both.delivered, true);
    assert.equal(calls[0].mail.to, 'owner@example.test');
    assert.equal(calls[0].mail.idempotencyKey, 'supabase-outage-42');
    const none = await notify('outage', { ...env, ALERT_EMAIL_TO: '' }, deps);
    assert.equal(none.delivered, false, 'slack failed and no email address is set');
    assert.equal(none.email.error, 'not_configured');
});

test('the workflow runs every 5 minutes on main only, pins its actions, and holds the least permissions', () => {
    const yml = readFileSync(new URL('../.github/workflows/supabase-status-alert.yml', import.meta.url), 'utf8');
    assert.match(yml, /cron: '2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*'/);
    assert.match(yml, /^permissions: \{\}/m);
    assert.equal((yml.match(/refs\/heads\/main/g) || []).length, 2);
    for (const line of yml.split('\n').filter((l) => /uses:/.test(l))) assert.match(line, /@[0-9a-f]{40} # v/);
    assert.match(yml, /secrets\.SLACK_WEBHOOK_URL/);
    assert.match(yml, /secrets\.RESEND_API_KEY/);
    assert.doesNotMatch(yml, /pull_request/);
});
