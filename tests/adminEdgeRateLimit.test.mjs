import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { adminEdgeRateLimit } from '../lib/adminEdgeRateLimit.js';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s.endsWith('/.open-next/worker.js')) return {
      url: 'data:text/javascript,' + encodeURIComponent('export default {fetch: (...args) => globalThis.__adminTestApp(...args)};'), shortCircuit: true
    };
    return next(s, c);
  }
`));
const worker = (await import('../worker.js')).default;
const request = (path, headers = {}, method = 'POST') => new Request(`https://veyrnox.test${path}`, {
    method, headers: { 'cf-connecting-ip': '192.0.2.1', ...headers },
    ...(method === 'POST' ? { body: 'do not read this body' } : {}),
});
const binding = (limit) => ({ ADMIN_EDGE_RATE_LIMITER: { limit } });

test('every admin namespace and normalized variant is screened before app work', async () => {
    const paths = ['/api/admin', '/api/admin/', '/api/admin/reap-assets', '/api/admin/top-up-backfill',
        '/api/v1/admin', '/api/v1/admin/metrics', '/API/V1/ADMIN/metrics', '/%61pi/admin/reap-assets',
        '/api%2Fadmin/reap-assets', '/api//v1//admin/metrics', '/api/x/%2e%2e/admin/reap-assets',
        '/api/x/..%2Fadmin/reap-assets'];
    let called = 0;
    globalThis.__adminTestApp = () => assert.fail('blocked request reached app');
    for (const path of paths) for (const method of ['GET', 'POST', 'OPTIONS']) {
        const req = request(path, {}, method);
        const res = await worker.fetch(req, binding(async ({ key }) => {
            called++; assert.equal(key, 'veyrnox-ai:admin:v1:192.0.2.1'); return { success: false };
        }), {});
        assert.equal(res.status, 429, path);
        assert.equal(req.bodyUsed, false);
        assert.equal(res.headers.get('retry-after'), '60');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
        assert.match(res.headers.get('strict-transport-security'), /max-age=63072000/);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.equal(res.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
        assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: 60 });
    }
    assert.equal(called, paths.length * 3);
});
test('allowed request reaches the same app handler with original request/env/context', async () => {
    const req = request('/api/v1/admin/metrics', { authorization: 'Bearer test-only' });
    const env = binding(async () => ({ success: true })), ctx = {};
    const expected = new Response('app authentication still required', { status: 401 });
    globalThis.__adminTestApp = (r, e, c) => {
        assert.equal(r, req); assert.equal(e, env); assert.equal(c, ctx);
        assert.equal(r.headers.get('authorization'), 'Bearer test-only');
        assert.equal(r.bodyUsed, false); return expected;
    };
    assert.equal(await worker.fetch(req, env, ctx), expected);
});
test('malformed/missing/throwing bindings fail closed and never expose errors', async () => {
    globalThis.__adminTestApp = () => assert.fail('unavailable gate reached app');
    for (const env of [{}, binding(async () => { throw new Error('private-key-detail'); }),
        ...[null, {}, { success: 'true' }, { success: 1 }].map((v) => binding(async () => v))]) {
        const res = await worker.fetch(request('/api/admin/top-up-backfill'), env, {});
        assert.equal(res.status, 503);
        assert.equal(res.headers.get('retry-after'), '30');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { error: 'rate_limit_unavailable', retry_after_seconds: 30 });
    }
});
test('public, customer and webhook paths never call the admin limiter', async () => {
    let forwarded = 0;
    globalThis.__adminTestApp = () => { forwarded++; return new Response('ok'); };
    const env = binding(() => assert.fail('unrelated request consumed admin quota'));
    const paths = ['/', '/app/admin', '/api/v1/account', '/api/v1/top-ups', '/api/v1/jobs/123/asset',
        '/api/webhook/stripe', '/api/webhook/fal', '/api/administrator', '/api/v1/admin-tools',
        '/app?next=/api/admin/reap-assets', '/api/v1/health'];
    for (const path of paths) assert.equal((await worker.fetch(request(path), env, {})).status, 200);
    assert.equal(forwarded, paths.length);
});
test('credentials, spoofed forwarding headers, paths and queries cannot split one IP bucket', async () => {
    const keys = [];
    const env = binding(async ({ key }) => { keys.push(key); return { success: true }; });
    for (const path of ['/api/admin/reap-assets?a=1', '/api/admin/top-up-backfill?b=2', '/api/v1/admin/metrics']) {
        await adminEdgeRateLimit(request(path, { 'x-veyrnox-auth-id': crypto.randomUUID(),
            'x-forwarded-for': crypto.randomUUID(), authorization: crypto.randomUUID(), 'cf-ray': '' }), env);
    }
    assert.equal(new Set(keys).size, 1);
    await adminEdgeRateLimit(request('/api/admin/reap-assets', { 'cf-connecting-ip': '192.0.2.2' }), env);
    assert.equal(new Set(keys).size, 2);
});
test('IPv6 is canonicalized and missing or malformed IPs share the fallback, never bypass', async () => {
    const keys = [];
    const env = binding(async ({ key }) => { keys.push(key); return { success: false }; });
    for (const ip of ['2001:DB8:0:0:0:0:0:1', '2001:db8::1']) {
        assert.equal((await adminEdgeRateLimit(request('/api/admin/reap-assets', { 'cf-connecting-ip': ip }), env)).status, 429);
    }
    assert.equal(keys[0], keys[1]);
    for (const ip of ['', 'garbage', 'abc', '999.0.0.1', 'a'.repeat(100), '192.0.2.1, 192.0.2.2']) {
        await adminEdgeRateLimit(request('/api/admin/reap-assets', { 'cf-connecting-ip': ip }), env);
        assert.equal(keys.at(-1), 'veyrnox-ai:admin:v1:unknown');
    }
    const req = request('/api/admin/reap-assets'); req.headers.delete('cf-connecting-ip');
    assert.equal((await adminEdgeRateLimit(req, env)).status, 429);
    assert.equal(keys.at(-1), 'veyrnox-ai:admin:v1:unknown');
});
test('scheduled recovery calls the app directly even when external rate limiting is unavailable', async () => {
    let backfills = 0;
    const env = { PUBLIC_HOST: 'https://veyrnox.test', TOP_UP_BACKFILL_TOKEN: 'cron-test-only',
        ADMIN_EDGE_RATE_LIMITER: { limit: () => assert.fail('cron touched external limiter') } };
    const ctx = {};
    globalThis.__adminTestApp = (req, e, c) => {
        backfills++;
        assert.equal(new URL(req.url).pathname, '/api/admin/top-up-backfill');
        assert.equal(req.headers.get('authorization'), 'Bearer cron-test-only');
        assert.equal(e, env); assert.equal(c, ctx);
        return new Response('{}');
    };
    await worker.scheduled({}, env, ctx);
    assert.equal(backfills, 1);
});
test('deployment binds the intended namespace and quota', () => {
    const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const ratelimits = JSON.parse(raw.match(/"ratelimits"\s*:\s*(\[[\s\S]*?\])/)[1]);
    assert.deepEqual(ratelimits, [{ name: 'ADMIN_EDGE_RATE_LIMITER', namespace_id: '2026092401', simple: { limit: 60, period: 60 } }]);
});
