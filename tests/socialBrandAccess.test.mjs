import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
  ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
  PUBLISH_RUNTIME_FLAGS: '{"teams":"true"}',
});

const { resolveBrand } = await import('../lib/social/resolveBrand.js');
const brandRoute = await import('../app/api/v1/social/brands/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const ownerAuth = '33333333-3333-4333-8333-333333333333';
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' };
let calls = [];

function stub(overrides = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    const args = JSON.parse(init.body); calls.push({ name, args });
    const defaults = {
      consume_account_read_request: { ok: true },
      get_or_create_default_social_brand: { ok: true, brand_id: brand, label: 'Personal' },
      get_social_brand_access: { ok: true, brand_id: brand, label: 'Shared brand', role: 'editor', owner_auth_id: ownerAuth, paid: true },
      list_social_brand_access: { ok: true, brands: [{ id: brand, label: 'Shared brand', timezone: 'Europe/London', role: 'editor', paid: true }] },
    };
    const result = overrides[name] ?? defaults[name];
    if (result instanceof Error) throw result;
    return Response.json(result);
  };
}

const request = (selected = brand) => new Request('https://veyrnox.ai/api/v1/social/brands', {
  headers: { 'x-veyrnox-auth-id': auth, ...(selected ? { 'x-publish-brand-id': selected } : {}) },
});

test('selected brand access returns the role and server-only owner identity', async () => {
  stub();
  const result = await resolveBrand(auth, cfg, 'test', {
    request: request(), allowedRoles: ['editor'],
  });
  assert.deepEqual(result, { brandId: brand, brandLabel: 'Shared brand', role: 'editor', paid: true, selected: true, rpcAuthId: ownerAuth });
  assert.equal(calls.at(-1).name, 'get_social_brand_access');
});

test('selected brand access rejects malformed, inaccessible and disallowed selections', async () => {
  stub();
  assert.equal((await resolveBrand(auth, cfg, 'test', { request: request('bad'), allowedRoles: ['owner'] })).error.status, 400);
  assert.equal(calls.length, 0);
  stub({ get_social_brand_access: { ok: false, code: 'BRAND_NOT_FOUND' } });
  assert.equal((await resolveBrand(auth, cfg, 'test', { request: request(), allowedRoles: ['owner'] })).error.status, 404);
  stub();
  const forbidden = await resolveBrand(auth, cfg, 'test', { request: request(), allowedRoles: ['owner'] });
  assert.equal(forbidden.error.status, 403);
  assert.deepEqual(await forbidden.error.json(), { error: 'brand_role_forbidden', role: 'editor' });
});

test('brand list returns only the browser-safe projection', async () => {
  stub();
  const response = await brandRoute.GET(request(''));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.brands, [{ id: brand, label: 'Shared brand', timezone: 'Europe/London', role: 'editor', paid: true }]);
  assert.equal(JSON.stringify(body).includes(ownerAuth), false);
});

test('disabled team flag ignores a client brand selector', async () => {
  const previous = process.env.PUBLISH_RUNTIME_FLAGS;
  process.env.PUBLISH_RUNTIME_FLAGS = '{"teams":"false"}';
  try {
    stub();
    const result = await resolveBrand(auth, cfg, 'test', { request: request(), allowedRoles: ['viewer'] });
    assert.equal(result.role, 'owner');
    assert.equal(result.rpcAuthId, auth);
    assert.equal(result.selected, false);
    assert.equal(calls.at(-1).name, 'get_or_create_default_social_brand');
  } finally { process.env.PUBLISH_RUNTIME_FLAGS = previous; }
});
