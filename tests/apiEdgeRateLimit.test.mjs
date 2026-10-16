import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) {
 if(s.endsWith('/.open-next/worker.js')) return {url:'data:text/javascript,export default {fetch:(...args)=>globalThis.__apiEdgeApp(...args)}',shortCircuit:true};
 return next(s,c);
}`));
const worker = (await import('../worker.js')).default;
const req = (path, ip = '192.0.2.1', headers = {}) => new Request(`https://veyrnox.test${path}`, {
    method: 'POST', headers: { 'cf-connecting-ip': ip, ...headers }, body: 'unread',
});
const env = (limit) => ({ API_EDGE_RATE_LIMITER: { limit } });

test('all ordinary API families and normalized variants are limited before body/auth work', async () => {
    globalThis.__apiEdgeApp = () => assert.fail('limited request reached app');
    for (const path of ['/api/catalog', '/api/v1/account', '/api/publish/v1/posts', '/api/social/team/token',
        '/api/cinema/titles', '/API/V1/generations', '/%61pi/v1/jobs', '/api%2Fv1/jobs', '/api//v1/jobs']) {
        const request = req(path);
        const response = await worker.fetch(request, env(async ({ key }) => {
            assert.equal(key, 'veyrnox-ai:api:v1:192.0.2.1'); return { success: false };
        }), {});
        assert.equal(response.status, 429, path);
        assert.equal(request.bodyUsed, false);
        assert.equal(response.headers.get('retry-after'), '60');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    }
});

test('an unavailable or malformed limiter fails closed without exposing details', async () => {
    globalThis.__apiEdgeApp = () => assert.fail('unlimited request reached app');
    for (const config of [{}, env(async () => { throw Error('private detail'); }),
        ...[{}, null, { success: 'true' }].map(value => env(async () => value))]) {
        const response = await worker.fetch(req('/api/v1/generations'), config, {});
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable', retry_after_seconds: 30 });
    }
});

test('credentials and queries cannot split a bucket; IPv6 addresses share a /64', async () => {
    const keys = [];
    globalThis.__apiEdgeApp = () => new Response('ok');
    const config = env(async ({ key }) => { keys.push(key); return { success: true }; });
    for (const ip of ['2001:db8::1', '2001:DB8:0:0:ffff::1']) {
        assert.equal((await worker.fetch(req('/api/v1/jobs?x=' + crypto.randomUUID(), ip,
            { authorization: crypto.randomUUID(), 'x-forwarded-for': crypto.randomUUID() }), config, {})).status, 200);
    }
    assert.deepEqual(keys, Array(2).fill('veyrnox-ai:api:v1:2001:db8:0:0::/64'));
    for (const ip of ['', 'invalid', '999.1.1.1']) await worker.fetch(req('/api/catalog', ip), config, {});
    assert.deepEqual(keys.slice(2), Array(3).fill('veyrnox-ai:api:v1:unknown'));
});

test('provider callbacks use an independent bucket so a customer cannot starve completion', async () => {
    globalThis.__apiEdgeApp = async request => { assert.equal(await request.text(), 'unread'); return new Response('signature check still runs', { status: 401 }); };
    const keys = [];
    const config = env(async ({ key }) => { keys.push(key); return { success: true }; });
    for (const path of ['/api/v1/jobs', '/api/webhook/stripe', '/api/webhook/fal']) {
        assert.equal((await worker.fetch(req(path), config, {})).status, 401);
    }
    assert.deepEqual(keys, ['veyrnox-ai:api:v1:192.0.2.1', ...Array(2).fill('veyrnox-ai:provider-webhook:v1:192.0.2.1')]);
});

test('pages and specialized admin/report gates keep their own quotas', async () => {
    globalThis.__apiEdgeApp = () => new Response('ok');
    const config = { ...env(() => assert.fail('unrelated route spent general quota')),
        ADMIN_EDGE_RATE_LIMITER: { limit: async () => ({ success: false }) },
        TURNSTILE_REPORT_RATE_LIMITER: { limit: async () => ({ success: false }) } };
    for (const path of ['/', '/app/create', '/apiary', '/_next/static/a.js']) {
        assert.equal((await worker.fetch(req(path), config, {})).status, 200);
    }
    for (const path of ['/api/admin/reap-assets', '/api/v1/admin/metrics', '/api/turnstile-failure']) {
        assert.equal((await worker.fetch(req(path), config, {})).status, 429);
    }
});

test('session authentication uses an independent tighter binding', async () => {
    globalThis.__apiEdgeApp = () => assert.fail('blocked authentication reached app');
    const config = { ...env(() => assert.fail('auth spent general quota')),
        AUTH_EDGE_RATE_LIMITER: { limit: async ({ key }) => {
            assert.equal(key, 'veyrnox-ai:auth:v1:192.0.2.1'); return { success: false };
        } } };
    for (const path of ['/api/auth/session', '/%61pi/auth/session', '/api%2fauth/session']) {
        assert.equal((await worker.fetch(req(path), config, {})).status, 429);
    }
    assert.equal((await worker.fetch(req('/api/auth/session'), env(async () => ({ success: true })), {})).status, 503);
});

test('both deployments bind a general screening quota with separate namespaces', () => {
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    const prod = config.ratelimits.find(binding => binding.name === 'API_EDGE_RATE_LIMITER');
    const staging = config.env.staging.ratelimits.find(binding => binding.name === 'API_EDGE_RATE_LIMITER');
    assert.deepEqual(prod.simple, { limit: 1200, period: 60 });
    assert.deepEqual(staging.simple, prod.simple);
    assert.notEqual(prod.namespace_id, staging.namespace_id);
    for (const deployment of [config, config.env.staging]) {
        assert.deepEqual(deployment.ratelimits.find(binding => binding.name === 'AUTH_EDGE_RATE_LIMITER').simple, { limit: 60, period: 60 });
    }
});
