// /api/v1/admin/security (ADR-0104): security alerts and their triage, read
// and written through admin_security_* behind the same gates as the other
// dashboard routes; and the event recorder that feeds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { recordSecurityEvent, securityEventsEnabled, sourceKey } from '../lib/securityEvents.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const listRoute = new URL('../app/api/v1/admin/security/route.js', import.meta.url);
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };
const ALERT = '33333333-3333-4333-8333-333333333333';

async function withEnv(env, href, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
function stubRpc(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), body });
        return handler(String(url), body);
    };
    return calls;
}
const list = (headers, query = '') => new Request(`https://veyrnox.test/api/v1/admin/security${query}`, { headers });
const post = (headers, body) => new Request('https://veyrnox.test/api/v1/admin/security', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

test('callers without identity or a second factor are refused before any RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, listRoute.href, async ({ GET }) => {
        assert.equal((await GET(list({}))).status, 401);
        const aal1 = await GET(list({ 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    assert.equal(calls.length, 0);
});

test('status and limit are validated, then passed to admin_security_alerts; never cached', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/admin_security_alerts$/);
        return Response.json({ ok: true, alerts: [{ id: ALERT, rule_id: 'SEC-001' }], open_by_severity: { high: 1 }, recent_events: [] });
    });
    await withEnv(CONFIGURED, listRoute.href, async ({ GET }) => {
        for (const query of ['?status=bogus', '?limit=0', '?limit=201', '?limit=1.5']) {
            assert.equal((await GET(list(ADMIN, query))).status, 400, query);
        }
        const res = await GET(list(ADMIN, '?status=open&limit=20'));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual((await res.json()).open_by_severity, { high: 1 });
    });
    assert.deepEqual(calls.at(-1).body, { p_auth_id: 'auth-admin', p_status: 'open', p_limit: 20 });
});

test('the RPC refusing a non-admin answers 403 not_admin', async () => {
    stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
    await withEnv(CONFIGURED, listRoute.href, async ({ GET }) => {
        const res = await GET(list(ADMIN));
        assert.deepEqual([res.status, await res.json()], [403, { error: 'not_admin' }]);
    });
});

test('a state change validates id, status and note, then calls admin_security_alert_set_status', async () => {
    const calls = stubRpc(() => Response.json({ ok: true, status: 'resolved', unchanged: false }));
    await withEnv(CONFIGURED, listRoute.href, async ({ POST }) => {
        assert.equal((await POST(post(ADMIN, { alert_id: 'nope', status: 'resolved' }))).status, 400);
        assert.equal((await POST(post(ADMIN, { alert_id: ALERT, status: 'bogus' }))).status, 400);
        assert.equal((await POST(post(ADMIN, { alert_id: ALERT, status: 'resolved', note: 'x'.repeat(501) }))).status, 400);
        const res = await POST(post(ADMIN, { alert_id: ALERT, status: 'resolved', note: 'checked' }));
        assert.deepEqual([res.status, await res.json()], [200, { status: 'resolved', unchanged: false }]);
    });
    assert.deepEqual(calls.at(-1).body, { p_auth_id: 'auth-admin', p_alert_id: ALERT, p_status: 'resolved', p_note: 'checked' });
});

test('an unknown alert is a 404', async () => {
    stubRpc(() => Response.json({ ok: false, code: 'ALERT_NOT_FOUND' }));
    await withEnv(CONFIGURED, listRoute.href, async ({ POST }) => {
        const res = await POST(post(ADMIN, { alert_id: ALERT, status: 'resolved' }));
        assert.deepEqual([res.status, await res.json()], [404, { error: 'alert_not_found' }]);
    });
});

test('the recorder is off unless SECURITY_EVENTS_ENABLED is "true", and never writes an address or a token', async () => {
    const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', SECURITY_EVENTS_HASH_KEY: 'k-test', SECURITY_EVENTS_ENABLED: 'true' };
    const req = new Request('https://veyrnox.test/api/v1/jobs?token=secret', { headers: { 'cf-connecting-ip': '203.0.113.9', authorization: 'Bearer abc' } });
    const sent = [];
    const fetcher = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}'); };
    await recordSecurityEvent({ category: 'auth', action: 'request.reject', outcome: 'failure', req, status: 401, reason: 'signature' }, { ...env, SECURITY_EVENTS_ENABLED: 'false' }, fetcher);
    assert.equal(sent.length, 0);
    await recordSecurityEvent({ category: 'auth', action: 'request.reject', outcome: 'failure', req, status: 401, reason: 'signature' }, env, fetcher);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/rest\/v1\/rpc\/record_security_event$/);
    const text = JSON.stringify(sent[0].body);
    assert.ok(!text.includes('203.0.113.9') && !text.includes('secret') && !text.includes('abc'));
    assert.equal(sent[0].body.p_path, '/api/v1/jobs');
    assert.match(sent[0].body.p_source_key, /^[A-Za-z0-9_-]{24}$/);
});

test('without a hash key the source is left out; with one the same address maps to the same key', async () => {
    const req = new Request('https://veyrnox.test/x', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    assert.equal(await sourceKey(req, {}), null);
    const env = { SECURITY_EVENTS_HASH_KEY: 'k-test' };
    assert.equal(await sourceKey(req, env), await sourceKey(req, env));
    assert.notEqual(await sourceKey(req, env), await sourceKey(req, { SECURITY_EVENTS_HASH_KEY: 'other' }));
});

test('recording is on with the hash key or the flag, and "false" always wins', () => {
    assert.equal(securityEventsEnabled({}), false);
    assert.equal(securityEventsEnabled({ SECURITY_EVENTS_HASH_KEY: 'k' }), true);
    assert.equal(securityEventsEnabled({ SECURITY_EVENTS_ENABLED: 'true' }), true);
    assert.equal(securityEventsEnabled({ SECURITY_EVENTS_ENABLED: 'false', SECURITY_EVENTS_HASH_KEY: 'k' }), false);
    assert.equal(securityEventsEnabled({ SECURITY_EVENTS_ENABLED: 'yes' }), false);
});
