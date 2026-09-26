import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/v1/social-cinema/profile/route.js';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true' });
const auth = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const profile = { username: 'alice', display_name: 'Alice', bio: '' };
const request = (body, headers = {}) => new Request('https://veyrnox.test/api/v1/social-cinema/profile', {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-veyrnox-auth-id': auth, 'idempotency-key': key, 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
let calls;
function stub(results = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    calls.push({ name, args: JSON.parse(init.body) });
    const result = results[name] ?? ({ consume_account_read_request: { ok: true }, create_cinema_profile: { profile_id: id }, read_own_cinema_profile: { ...profile, id } })[name];
    if (result instanceof Error) throw result;
    return Response.json(result);
  };
}
test('missing/invalid identity and disabled rollout never access the database', async () => {
  stub();
  process.env.CINEMA_ENABLED = 'false';
  for (const handler of [GET, POST]) assert.equal((await handler(request())).status, 503);
  process.env.CINEMA_ENABLED = 'true';
  for (const handler of [GET, POST]) {
    for (const identity of ['', 'bad']) assert.equal((await handler(request(undefined, { 'x-veyrnox-auth-id': identity }))).status, 401);
    process.env.SOCIAL_CINEMA_PROFILES_ENABLED = 'false';
    assert.equal((await handler(request())).status, 503);
    process.env.SOCIAL_CINEMA_PROFILES_ENABLED = 'true';
  }
  assert.deepEqual(calls, []);
});
test('owner read uses verified identity only and forbids caching', async () => {
  stub();
  const res = await GET(request());
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).profile.username, 'alice');
  assert.deepEqual(calls[1], { name: 'read_own_cinema_profile', args: { p_auth_id: auth } });
});
test('create only forwards validated fields and a stable idempotency key', async () => {
  stub();
  const res = await POST(request({ ...profile, display_name: ' Alice ' }));
  assert.equal(res.status, 201);
  assert.deepEqual(calls[1], { name: 'create_cinema_profile', args: { p_auth_id: auth, p_idempotency_key: key, p_profile: profile } });
  assert.deepEqual(await res.json(), { profile_id: id, idempotent: false });
  stub({ create_cinema_profile: { profile_id: id, idempotent: true } });
  assert.equal((await POST(request(profile))).status, 200);
});
test('ownership, status and role injection rejected before mutation', async () => {
  for (const field of ['user_id', 'auth_id', 'role', 'account_status', 'id']) {
    stub(); assert.equal((await POST(request({ ...profile, [field]: 'administrator' }))).status, 400);
    assert.equal(calls.length, 1);
  }
});
test('validation rejects malformed JSON, arrays, invalid lengths, missing key and oversized body', async () => {
  for (const body of ['{', [], null, { ...profile, username: 'UPPER' }, { ...profile, display_name: ' ' }, { ...profile, bio: 'x'.repeat(501) }]) {
    stub(); assert.equal((await POST(request(body))).status, 400); assert.equal(calls.length, 1);
  }
  stub(); assert.equal((await POST(request(profile, { 'idempotency-key': '' }))).status, 400);
  assert.equal((await POST(request(profile, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await POST(request('x'.repeat(70000)))).status, 413);
});
test('rate limits and missing users stop both reads and writes', async () => {
  for (const handler of [GET, POST]) for (const [rate, status] of [[{ code: 'RATE_LIMITED', retry_after_seconds: 90 }, 429], [{ code: 'NOT_FOUND' }, 409], [{}, 503]]) {
    stub({ consume_account_read_request: rate }); const res = await handler(request(profile));
    assert.equal(res.status, status); assert.equal(calls.length, 1);
    if (status === 429) assert.equal(res.headers.get('retry-after'), '60');
  }
});
test('expected conflicts are safe and unknown database responses fail closed', async () => {
  for (const code of ['username_unavailable', 'profile_exists', 'idempotency_conflict']) {
    stub({ create_cinema_profile: { error: code } });
    const res = await POST(request(profile)); assert.equal(res.status, 409); assert.deepEqual(await res.json(), { error: code });
  }
  for (const result of [{ error: 'private SQL information' }, new Error('secret upstream detail')]) {
    stub({ create_cinema_profile: result }); const res = await POST(request(profile));
    assert.equal(res.status, 503); assert.equal(await res.text(), '{"error":"temporarily_unavailable"}');
  }
});

test('restricted profile reads and creation are refused', async () => {
  stub({ read_own_cinema_profile: { error: 'account_not_active' }, create_cinema_profile: { error: 'account_not_active' } });
  for (const [handler, requestBody] of [[GET, undefined], [POST, profile]]) {
    const res = await handler(request(requestBody)); assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'account_not_active');
  }
});
