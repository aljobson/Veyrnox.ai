// the `polled` panel of /api/v1/admin/webhooks: in-flight jobs for providers completed by a polling sweep
// (GrsAI, BytePlus, Crun). Read-only; the gates are covered in adminWebhooks.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/webhooks/route.js', import.meta.url);
const lib = await import('../lib/adminPolledProviders.js');
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true', CRUN_ENABLED: 'true' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (headers) => new Request('https://veyrnox.test/api/v1/admin/webhooks', { headers });
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

const RPC_OK = { ok: true, since: '2026-11-02T00:00:00Z', hours: 24, by_source: [], failures: [], stuck_events: [] };

test('the webhooks answer carries a polled panel read from submitted jobs of the four providers only', async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(String(url));
        urls.push(u);
        return u.pathname === '/rest/v1/jobs' ? Response.json([]) : Response.json(RPC_OK);
    };
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request(ADMIN));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const body = await res.json();
        assert.deepEqual(body.polled.providers.map((p) => p.provider), ['grsai', 'byteplus', 'crun', 'higgsfield']);
        assert.equal(body.polled.capped, false);
    });
    const jobs = urls.filter((u) => u.pathname === '/rest/v1/jobs');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].searchParams.get('provider'), 'in.(grsai,byteplus,crun,higgsfield)');
    assert.equal(jobs[0].searchParams.get('state'), 'eq.SUBMITTED');
});

test('counts in-flight jobs, the oldest age, and jobs past the sweep timeout plus slack', async () => {
    const now = new Date('2026-11-02T12:00:00Z');
    const ago = (m) => new Date(now.getTime() - m * 60_000).toISOString();
    globalThis.fetch = async () => Response.json([
        { provider: 'crun', created_at: ago(60) },   // past 45 + 5: overdue
        { provider: 'crun', created_at: ago(46) },   // past its timeout but inside the slack
        { provider: 'crun', created_at: ago(2) },
        { provider: 'grsai', created_at: ago(36) },  // past 30 + 5: overdue
    ]);
    const out = await lib.readPolledProviders({ supabaseUrl: 'https://db.test', serviceRoleKey: 'k' }, { now, crunEnabled: false });
    const by = Object.fromEntries(out.providers.map((p) => [p.provider, p]));
    assert.deepEqual([by.crun.in_flight, by.crun.oldest_minutes, by.crun.overdue, by.crun.sweep_enabled], [3, 60, 1, false]);
    assert.deepEqual([by.grsai.in_flight, by.grsai.oldest_minutes, by.grsai.overdue], [1, 36, 1]);
    assert.deepEqual([by.byteplus.in_flight, by.byteplus.oldest_minutes, by.byteplus.overdue], [0, null, 0]);
});

test('a failed jobs read leaves polled null and keeps the webhook figures', async () => {
    globalThis.fetch = async (url) => {
        if (new URL(String(url)).pathname === '/rest/v1/jobs') throw new Error('network down with secret detail');
        return Response.json(RPC_OK);
    };
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request(ADMIN));
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.polled, null);
        assert.equal(body.hours, 24);
        assert.ok(!JSON.stringify(body).includes('secret detail'));
    });
});

test('the polled timeouts match the sweeps they describe', async () => {
    const [grsai, byteplus, crun] = await Promise.all([import('../lib/grsaiSweep.js'), import('../lib/byteplusSweep.js'), import('../lib/crunSweep.js')]);
    assert.equal(lib.POLLED_PROVIDERS.grsai.timeoutMinutes, grsai.TIMEOUT_MINUTES);
    assert.equal(lib.POLLED_PROVIDERS.byteplus.timeoutMinutes, byteplus.TIMEOUT_MINUTES);
    assert.equal(lib.POLLED_PROVIDERS.crun.timeoutMinutes, crun.TIMEOUT_MINUTES);
});

test('Higgsfield has its own flag, timeout and off-message without changing Crun', async () => {
    const { TIMEOUT_MINUTES } = await import('../lib/higgsfieldSweep.js');
    assert.equal(lib.POLLED_PROVIDERS.higgsfield.timeoutMinutes, TIMEOUT_MINUTES);
    globalThis.fetch = async () => Response.json([]);
    for (const enabled of [false, true]) {
        const out = await lib.readPolledProviders({ supabaseUrl: 'https://db.test', serviceRoleKey: 'k' }, { crunEnabled: !enabled, higgsfieldEnabled: enabled });
        assert.equal(out.providers.find(p => p.provider === 'higgsfield').sweep_enabled, enabled);
        assert.equal(out.providers.find(p => p.provider === 'crun').sweep_enabled, !enabled);
    }
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('app/veyrnox/app/admin/webhooks/page.js', 'utf8');
    assert.match(page, /p\.provider === 'higgsfield' \? 'HIGGSFIELD_ENABLED' : 'CRUN_ENABLED'/);
});
