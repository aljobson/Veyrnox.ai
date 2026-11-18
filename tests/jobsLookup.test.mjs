import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' });
const { GET } = await import('../app/api/v1/jobs/route.js');
const { jobLookupProjection } = await import('../lib/jobLookup.js');
const AUTH = 'auth-id', INTERNAL = '11111111-1111-4111-8111-111111111111';
const KEY = 'attempt.key_123-abc';
const get = (key = KEY, auth = AUTH) => GET(new Request(`https://test/api/v1/jobs?idempotency_key=${encodeURIComponent(key)}`, { headers: auth ? { 'x-veyrnox-auth-id': auth } : {} }));
function fixture(t, { user = true, deleted = false, owner = INTERNAL, state = 'REFUNDED', failure = null } = {}) {
  const calls = []; let reads = 0;
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(target), name = url.pathname.split('/').at(-1), args = init.body && JSON.parse(init.body);
    calls.push(name);
    if (name === failure) throw Error('fixture outage');
    if (name === 'users') {
      assert.equal(url.searchParams.get('auth_id'), `eq.${AUTH}`);
      assert.equal(url.searchParams.get('deleted_at'), 'is.null');
      return Response.json(user ? [{ id: INTERNAL }] : []);
    }
    if (name === 'consume_job_read_request' || name === 'list_user_jobs') {
      if (name === 'consume_job_read_request') assert.deepEqual(args, { p_user_id: INTERNAL });
      else assert.equal(args.p_auth_id, AUTH);
      reads++;
      return Response.json(reads > 2 ? { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 9 } : { ok: true, jobs: [] });
    }
    if (name === 'jobs') {
      assert.equal(url.searchParams.get('user_id'), `eq.${INTERNAL}`);
      assert.equal(url.searchParams.get('deleted_at'), 'is.null');
      assert.equal(url.searchParams.get('select'), 'id,state');
      assert.equal(url.searchParams.get('limit'), '1');
      return Response.json(owner === INTERNAL && !deleted && url.searchParams.get('idempotency_key') === `eq.${KEY}` ? [{ id: 'job-id', state, inputs: 'private', references: 'private' }] : []);
    }
    throw Error(`Forbidden fetch ${url}`);
  });
  return calls;
}
test('every enum and unknown state preserve financial uncertainty', () => {
  const expected = { PRICED: ['queued', 'unknown'], DEBITED: ['queued', 'unknown'], FAILOVER: ['queued', 'unknown'], SUBMITTED: ['running', 'unknown'], SUCCEEDED: ['running', 'unknown'], STORED: ['succeeded', 'none'], FAILED: ['failed', 'pending'], REFUNDED: ['failed', 'confirmed'], QUEUED: ['queued', 'unknown'], RUNNING: ['queued', 'unknown'], unexpected: ['queued', 'unknown'] };
  for (const [state, [publicState, refund_state]] of Object.entries(expected)) assert.deepEqual(jobLookupProjection({ id: 'job', state }), { id: 'job', state: publicState, refunded: state === 'REFUNDED', refund_state });
});
test('distinct auth/internal ids, four fields only, no-store, no switch or manifest dependency', async t => {
  delete process.env.TEMPLATE_SWAP_CLIP_ENABLED;
  const calls = fixture(t), response = await get();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { job: { id: 'job-id', state: 'failed', refunded: true, refund_state: 'confirmed' } });
  assert.deepEqual(calls, ['users', 'consume_job_read_request', 'jobs']);
});
for (const options of [{ owner: 'another-user' }, { deleted: true }, { user: false }]) test(`unowned, deleted, missing/tombstoned user: ${JSON.stringify(options)}`, async t => {
  fixture(t, options); assert.deepEqual(await (await get()).json(), { job: null });
});
test('missing exact key returns null, never prefix matching', async t => {
  fixture(t); assert.deepEqual(await (await get(KEY + '.other')).json(), { job: null });
});
test('auth and malformed key fail before any query', async t => {
  const calls = fixture(t);
  const unauthenticated = await get(KEY, '');
  assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
  for (const key of ['', 'short', 'a'.repeat(129), 'key&user_id=eq.other', 'a*bcd123', 'abcdefgh\n']) assert.equal((await get(key)).status, 400);
  assert.deepEqual(calls, []);
});
test('list and lookup consume one shared internal-user quota', async t => {
  const calls = fixture(t);
  await GET(new Request('https://test/api/v1/jobs', { headers: { 'x-veyrnox-auth-id': AUTH } }));
  assert.equal((await get()).status, 200);
  const response = await get();
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '9');
  assert.equal(calls.filter(v => v === 'jobs').length, 1);
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0351_delete_user_job.sql', import.meta.url), 'utf8');
  assert.match(sql, /SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id/);
  assert.match(sql, /consume_job_read_request\(v_user_id\)/);
});
for (const failure of ['users', 'consume_job_read_request', 'jobs']) test(`lookup ${failure} outage is unresolved`, async t => {
  fixture(t, { failure }); const response = await get();
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: 'internal' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('a failed refund remains unknown until a later authoritative refund is observed', async t => {
  let state = 'DEBITED';
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const name = new URL(target).pathname.split('/').at(-1);
    if (name === 'users') return Response.json([{ id: INTERNAL }]);
    if (name === 'jobs') return Response.json([{ id: 'refused-job', state }]);
    if (name === 'ledger_refund') throw Error('first refund failed');
    assert.ok(['job_submit_rejected', 'consume_job_read_request'].includes(name));
    if (name === 'consume_job_read_request') assert.equal(JSON.parse(init.body).p_user_id, INTERNAL);
    return Response.json({ ok: true });
  });
  const { finishGenerationSubmit } = await import('../lib/generationProviderSubmit.js');
  const response = await finishGenerationSubmit({ templateSwap: true, jobId: 'refused-job', userId: INTERNAL, credits: 47,
    modelRow: { provider: 'fal' }, ownRoute: null, offerRoutes: [], rawKeys: [], rawAssets: [], record: {},
    modelInputs: {}, storedInputs: {}, sources: {}, provider: { submit: async () => ({ ok: false, outcome: 'rejected', errorCode: 'provider_input_rejected' }) }, debit: {},
  }, { supabaseUrl: 'https://db.test', serviceRoleKey: 'fixture' });
  assert.deepEqual(await response.json(), { error: 'provider_input_rejected', job_id: 'refused-job' });
  assert.equal((await (await get()).json()).job.refund_state, 'unknown');
  // An eventual authoritative refund is external to this read-only endpoint.
  state = 'REFUNDED';
  assert.deepEqual((await (await get()).json()).job, { id: 'refused-job', state: 'failed', refunded: true, refund_state: 'confirmed' });
});
