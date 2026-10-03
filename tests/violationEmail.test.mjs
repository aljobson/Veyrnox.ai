import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isConfigured, resendConfig, sendEmail } from '../packages/adapters/resend.js';
import { notifyViolation, violationEmail } from '../lib/violationEmail.js';

const mail = { apiKey: 're_test_key', from: 'Veyrnox <support@veyrnox.ai>' };
const message = { to: 'user@example.com', subject: 'S', text: 'T', idempotencyKey: 'violation-11111111-1111-4111-8111-111111111111' };
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'k' };
const USER = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333';
const env = { RESEND_API_KEY: 're_test_key', VIOLATION_EMAIL_FROM: 'Veyrnox <support@veyrnox.ai>' };

test('sending is configured only with a key and a well-formed sender', () => {
    assert.equal(isConfigured(resendConfig(env)), true);
    assert.equal(isConfigured({ apiKey: 'k', from: 'support@veyrnox.ai' }), true);
    for (const bad of [{}, { apiKey: 'k' }, { from: mail.from }, { apiKey: 'k', from: 'not an address' }, { apiKey: 'k', from: 'A <a@b.c>\nBcc: x@y.z' }]) {
        assert.equal(isConfigured(bad), false, JSON.stringify(bad));
    }
});

test('one POST to Resend with the key, the idempotency key and a single recipient', async () => {
    let seen;
    const out = await sendEmail(mail, message, async (url, init) => { seen = { url, init }; return Response.json({ id: 'email_1' }); });
    assert.deepEqual(out, { ok: true, id: 'email_1' });
    assert.equal(seen.url, 'https://api.resend.com/emails');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer re_test_key');
    assert.equal(seen.init.headers['Idempotency-Key'], message.idempotencyKey);
    assert.deepEqual(JSON.parse(seen.init.body), { from: mail.from, to: ['user@example.com'], subject: 'S', text: 'T' });
});

test('nothing is sent when unconfigured, or to a malformed recipient or key', async () => {
    const never = async () => assert.fail('must not call Resend');
    assert.deepEqual(await sendEmail({}, message, never), { ok: false, error: 'not_configured' });
    assert.deepEqual(await sendEmail(mail, { ...message, to: 'a@b.c, d@e.f' }, never), { ok: false, error: 'invalid_recipient' });
    assert.deepEqual(await sendEmail(mail, { ...message, idempotencyKey: 'x' }, never), { ok: false, error: 'invalid_idempotency_key' });
});

test('a refusal or an outage is a short code, never the provider payload or a throw', async () => {
    assert.deepEqual(await sendEmail(mail, message, async () => new Response('{"message":"domain not verified, key re_test_key"}', { status: 403 })), { ok: false, error: 'resend_403' });
    assert.deepEqual(await sendEmail(mail, message, async () => { throw new Error('socket'); }), { ok: false, error: 'unreachable' });
});

test('the warning says nothing was removed; the takedown counts towards the freeze', () => {
    const warning = violationEmail({ tier: 'warning' });
    assert.match(warning.subject, /warning/i);
    assert.match(warning.text, /Nothing has been removed/);
    const first = violationEmail({ tier: 'takedown', takedowns: 1, frozen: false });
    assert.match(first.text, /removal 1 of 3\. 2 more will freeze/);
    assert.match(violationEmail({ tier: 'takedown', takedowns: 2 }).text, /removal 2 of 3\. One more will freeze/);
    const frozen = violationEmail({ tier: 'takedown', takedowns: 3, frozen: true });
    assert.match(frozen.subject, /frozen/);
    assert.match(frozen.text, /third removal .* account is now frozen/);
    for (const m of [warning, first, frozen]) assert.match(m.text, /https:\/\/veyrnox\.ai\/legal\/aup/);
});

test('a notice goes to the account address, keyed on the action, and reports sent', async () => {
    let query; let sent;
    const out = await notifyViolation({
        cfg, userId: USER, actionId: ACTION, tier: 'takedown', takedowns: 1, frozen: false, env,
        deps: {
            select: async (table, q) => { query = { table, ...q }; return [{ email: 'user@example.com' }]; },
            sendEmail: async (c, m) => { sent = { c, m }; return { ok: true, id: 'e1' }; },
        },
    });
    assert.equal(out, 'sent');
    assert.deepEqual(query, { table: 'users', columns: 'email', filter: `id=eq.${USER}`, limit: 1 });
    assert.equal(sent.m.to, 'user@example.com');
    assert.equal(sent.m.idempotencyKey, `violation-${ACTION}`);
    assert.equal(sent.c.from, env.VIOLATION_EMAIL_FROM);
});

test('unconfigured is skipped without a lookup; every failure is "failed", never a throw', async () => {
    const never = { select: async () => assert.fail('no lookup'), sendEmail: async () => assert.fail('no send') };
    assert.equal(await notifyViolation({ cfg, userId: USER, actionId: ACTION, tier: 'warning', env: {}, deps: never }), 'skipped');
    const original = console.error; console.error = () => {};
    try {
        const base = { cfg, userId: USER, actionId: ACTION, tier: 'warning', env };
        assert.equal(await notifyViolation({ ...base, deps: { select: async () => [], sendEmail: never.sendEmail } }), 'failed');
        assert.equal(await notifyViolation({ ...base, deps: { select: async () => { throw new Error('db'); }, sendEmail: never.sendEmail } }), 'failed');
        assert.equal(await notifyViolation({ ...base, deps: { select: async () => [{ email: 'u@example.com' }], sendEmail: async () => ({ ok: false, error: 'resend_500' }) } }), 'failed');
    } finally { console.error = original; }
});

test('the admin reason and the job never reach the email', () => {
    const source = readFileSync(new URL('../lib/violationEmail.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /reason[,:]|jobId|job_id|prompt:/);
    const route = readFileSync(new URL('../app/api/v1/admin/violations/route.js', import.meta.url), 'utf8');
    assert.match(route, /notifyViolation\(\{\s*cfg: g\.cfg, userId, actionId: result\.action_id, tier, takedowns: result\.takedowns, frozen: result\.frozen,\s*\}\)/);
});
