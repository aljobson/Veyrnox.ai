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
  UPLOAD_REQUEST_RATE_LIMIT_ENABLED: 'true',
});
const { POST } = await import('../app/api/v1/uploads/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const body = { content_type: 'image/png', size_bytes: 1024 };
const post = (payload = body, identity = auth) => POST(new Request('https://veyrnox.test/api/v1/uploads', {
  method: 'POST', headers: identity ? { 'x-veyrnox-auth-id': identity } : {},
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
}));
let calls;
function stub({ rate = { ok: true }, balance = 1, stored = 0, fail, r2Failure = false } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'db.test') {
      const name = u.pathname.split('/').pop(); calls.push(name);
      assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth });
      if (fail === name) throw new Error('private backend detail');
      if (name === 'consume_upload_request') return Response.json(rate);
      assert.equal(name, 'read_user_balance');
      return Response.json(balance);
    }
    calls.push('r2-list');
    assert.equal(u.hostname, 'test-account.r2.cloudflarestorage.com');
    assert.equal(u.searchParams.get('prefix'), `uploads/${auth}/`);
    assert.equal(u.searchParams.get('max-keys'), '11');
    if (r2Failure) return new Response('unavailable', { status: 503 });
    return new Response('<ListBucketResult>' + Array.from({ length: stored }, (_, i) =>
      `<Contents><Key>uploads/${auth}/${i}.png</Key><LastModified>2026-09-24T00:00:00Z</LastModified><Size>1</Size></Contents>`
    ).join('') + '</ListBucketResult>');
  };
}
test('identity and cheap payload checks precede quota and all storage work', async () => {
  stub();
  for (const identity of [null, 'bad', '../forged']) assert.equal((await post(body, identity)).status, 401);
  for (const payload of ['{', null, [], { ...body, content_type: 'text/html' }, { ...body, size_bytes: -1 }]) {
    assert.equal((await post(payload)).status, 400);
  }
  assert.deepEqual(calls, []);
});
test('quota denial stops before balance and R2 and returns bounded uncached Retry-After', async () => {
  for (const [input, expected] of [[12, 12], [0, 1], [500, 60], [undefined, 60], ['bad', 60]]) {
    stub({ rate: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: input } });
    const response = await post();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), String(expected));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'rate_limited', retry_after_seconds: expected });
    assert.deepEqual(calls, ['consume_upload_request']);
  }
});
test('missing users retain 409 and malformed or unavailable quota fails closed', async () => {
  stub({ rate: { ok: false, code: 'NOT_FOUND' } });
  assert.equal((await post()).status, 409);
  assert.deepEqual(calls, ['consume_upload_request']);
  for (const rate of [null, {}, { ok: 'true' }, { ok: false, code: 'unexpected' }]) {
    stub({ rate });
    const response = await post();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'rate_limit_unavailable' });
    assert.deepEqual(calls, ['consume_upload_request']);
  }
  stub({ fail: 'consume_upload_request' });
  assert.equal((await post()).status, 503);
  assert.deepEqual(calls, ['consume_upload_request']);
});
test('quota approval preserves balance and R2 failure gates', async () => {
  for (const [balance, status] of [[null, 409], [0, 402], [-1, 402]]) {
    stub({ balance });
    assert.equal((await post()).status, status);
    assert.deepEqual(calls, ['consume_upload_request', 'read_user_balance']);
  }
  stub({ fail: 'read_user_balance' });
  assert.equal((await post()).status, 503);
  stub({ r2Failure: true });
  assert.equal((await post()).status, 503);
});
test('nine stored objects allow issuance, ten or eleven refuse it', async () => {
  for (const stored of [9, 10, 11]) {
    stub({ stored });
    const response = await post();
    assert.equal(response.status, stored < 10 ? 200 : 429);
    const result = await response.json();
    if (stored < 10) {
      assert.match(result.key, new RegExp(`^uploads/${auth}/[a-f0-9-]+\\.png$`));
      assert.equal(result.expires_in, 900);
      assert.equal(result.content_type, 'image/png');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const signed = new URL(result.upload_url);
      assert.equal(signed.searchParams.get('X-Amz-Expires'), '900');
      assert.match(signed.searchParams.get('X-Amz-SignedHeaders'), /content-type/);
    } else assert.equal(result.error, 'too_many_pending_uploads');
    assert.deepEqual(calls, ['consume_upload_request', 'read_user_balance', 'r2-list']);
  }
});
test('disabled rollout works against the pre-migration database', async () => {
  process.env.UPLOAD_REQUEST_RATE_LIMIT_ENABLED = 'false';
  try {
    stub({ fail: 'consume_upload_request' });
    assert.equal((await post()).status, 200);
    assert.deepEqual(calls, ['read_user_balance', 'r2-list']);
  } finally { process.env.UPLOAD_REQUEST_RATE_LIMIT_ENABLED = 'true'; }
});
