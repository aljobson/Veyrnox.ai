import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET, PUT } = await import('../app/api/v1/social/brand-kit/route.js');
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true', PUBLISH_RUNTIME_FLAGS: '{"teams":"true"}', EDITOR_SHARED_TOOLS_ENABLED: 'true' });
const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const workspace = '33333333-3333-4333-8333-333333333333';
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });
let calls = [];
function stub(overrides = {}, role = 'owner') {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    const args = JSON.parse(init.body); calls.push({ name, args });
    const defaults = {
      consume_account_read_request: { ok: true }, consume_social_post_write_request: { ok: true },
      get_social_brand_access: { ok: true, brand_id: brand, role, owner_auth_id: auth, paid: true },
      get_social_brand_kit: { ok: true, linked: true, canLink: false, kit: { name: 'Brand', voice: 'Warm', hashtags: ['Brand'], hasLogo: true, credits: [] } },
      set_social_brand_kit_link: { ok: true, linked: true },
    };
    const result = overrides[name] ?? defaults[name];
    assert.notEqual(result, undefined, name);
    if (result instanceof Error) throw result;
    return Response.json(result);
  };
}
function request(method = 'GET', body, identity = auth) {
  return new Request('https://veyrnox.ai/api/v1/social/brand-kit', { method,
    headers: { 'x-veyrnox-auth-id': identity, 'x-publish-brand-id': brand, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test('identity and flag checks happen before any upstream call', async () => {
  stub();
  for (const call of [GET, PUT]) assert.equal((await call(request(call === PUT ? 'PUT' : 'GET', undefined, ''))).status, 401);
  delete process.env.EDITOR_SHARED_TOOLS_ENABLED;
  try { for (const call of [GET, PUT]) assert.equal((await call(request(call === PUT ? 'PUT' : 'GET'))).status, 404); }
  finally { process.env.EDITOR_SHARED_TOOLS_ENABLED = 'true'; }
  assert.equal(calls.length, 0);
});
test('members receive the presentation kit using their verified acting identity', async () => {
  stub({}, 'viewer');
  const response = await GET(request()); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(data.kit.hasLogo, true); assert.equal(data.kit.voice, 'Warm');
  assert.doesNotMatch(JSON.stringify(data), /projectId|assetId|workspaceId|workspaceName|owner_auth_id/);
  assert.deepEqual(calls.at(-1), { name: 'get_social_brand_kit', args: { p_auth_id: auth, p_brand_id: brand } });
});
test('owner reads include the linked workspace name and id', async () => {
  stub({ get_social_brand_kit: { ok: true, linked: true, canLink: true, workspaceId: workspace, workspaceName: 'Owner workspace', kit: { name: 'Brand' } } });
  const response = await GET(request()); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.workspaceId, workspace);
  assert.equal(data.workspaceName, 'Owner workspace'); assert.equal(data.kit.name, 'Brand');
});
test('only owners link and unlink; the selected brand and actor are passed to the RPC', async () => {
  stub(); assert.equal((await PUT(request('PUT', { workspaceId: workspace }))).status, 200);
  assert.deepEqual(calls.at(-1), { name: 'set_social_brand_kit_link', args: { p_auth_id: auth, p_brand_id: brand, p_workspace_id: workspace } });
  stub({ set_social_brand_kit_link: { ok: true, linked: false } });
  assert.deepEqual(await (await PUT(request('PUT', { workspaceId: null }))).json(), { linked: false });
  stub({}, 'manager'); assert.equal((await PUT(request('PUT', { workspaceId: workspace }))).status, 403);
  assert.ok(!calls.some(c => c.name === 'set_social_brand_kit_link'));
});
test('PUT rejects extra keys, malformed UUIDs, arrays and nested arrays before upstream', async () => {
  for (const body of [{}, null, [], [workspace], [[workspace]], { workspaceId: [workspace] }, { workspaceId: [[workspace]] }, { workspaceId: 123 }, { workspaceId: {} }, { workspaceId: 'bad' }, { workspaceId: workspace, injected: true }]) {
    stub(); assert.equal((await PUT(request('PUT', body))).status, 400, JSON.stringify(body)); assert.equal(calls.length, 0);
  }
});
test('RPC failures return safe 502 errors without upstream details', async () => {
  for (const [call, method, rpc] of [[GET, 'GET', 'get_social_brand_kit'], [PUT, 'PUT', 'set_social_brand_kit_link']]) {
    for (const failure of [new Error('private SQL secret'), { ok: false, code: 'private SQL secret' }]) {
      stub({ [rpc]: failure });
      const response = await call(request(method, method === 'PUT' ? { workspaceId: workspace } : undefined));
      assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: 'internal' });
    }
  }
});
