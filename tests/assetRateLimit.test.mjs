import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access',
  R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
  ASSET_LINK_RATE_LIMIT_ENABLED: 'true',
});
const { GET } = await import('../app/api/v1/jobs/[id]/asset/route.js');
const id = '11111111-1111-4111-8111-111111111111';
const get = (auth = true, job = id) => GET(new Request('https://veyrnox.test/api/v1/jobs/' + job + '/asset', {
  headers: auth ? { 'x-veyrnox-auth-id': 'verified-user' } : {},
}), { params: Promise.resolve({ id: job }) });
let calls;
function stub(rate, fail = false) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = String(url).split('/').pop(); calls.push(name);
    if (name === 'consume_asset_link_request') {
      assert.deepEqual(JSON.parse(init.body), { p_auth_id: 'verified-user' });
      if (fail) throw new Error('private backend details');
      return Response.json(rate);
    }
    assert.equal(name, 'get_user_asset');
    return Response.json({ ok: true, r2_key: 'private/file.png', mime_type: 'image/png', size_bytes: 1 });
  };
}
test('authentication and input validation happen before consuming quota', async () => {
  stub({ ok: true });
  assert.equal((await get(false)).status, 401);
  assert.equal((await get(true, 'bad')).status, 400);
  assert.deepEqual(calls, []);
});
test('allowed request checks quota, then ownership, before returning a signed link', async () => {
  stub({ ok: true });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).expires_in, 900);
  assert.deepEqual(calls, ['consume_asset_link_request', 'get_user_asset']);
});
test('quota approval does not bypass asset ownership', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop(); seen.push(name);
    return Response.json(name === 'consume_asset_link_request' ? { ok: true } : { ok: false, code: 'NOT_FOUND' });
  };
  const response = await get();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
  assert.deepEqual(seen, ['consume_asset_link_request', 'get_user_asset']);
});
test('denied requests stop before lookup and return bounded Retry-After without caching', async () => {
  for (const [input, expected] of [[12, 12], [0, 1], [500, 60], [undefined, 60], ['bad', 60]]) {
    stub({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: input });
    const response = await get();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), String(expected));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'rate_limited', retry_after_seconds: expected });
    assert.deepEqual(calls, ['consume_asset_link_request']);
  }
});
test('missing users get 404 and a broken or malformed limiter fails closed', async () => {
  stub({ ok: false, code: 'NOT_FOUND' });
  assert.equal((await get()).status, 404);
  for (const reply of [null, {}, { ok: 'true' }, { ok: false, code: 'unexpected' }]) {
    stub(reply);
    const response = await get();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' });
    assert.deepEqual(calls, ['consume_asset_link_request']);
  }
  stub(null, true);
  assert.equal((await get()).status, 503);
  assert.deepEqual(calls, ['consume_asset_link_request']);
});
test('disabled rollout remains compatible with the pre-migration database', async () => {
  process.env.ASSET_LINK_RATE_LIMIT_ENABLED = 'false';
  try {
    stub(null, true);
    assert.equal((await get()).status, 200);
    assert.deepEqual(calls, ['get_user_asset']);
  } finally { process.env.ASSET_LINK_RATE_LIMIT_ENABLED = 'true'; }
});
