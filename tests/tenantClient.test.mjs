import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantRequest } from '../packages/db/tenant-client.js';
Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test' });
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });
const request = new Request('http://localhost:3000', { headers: { authorization: 'Bearer user-token' } });
const call = options => tenantRequest(request, { requestId: 'test' }, 'projects', options);
const rejectsCode = (promise, status, code) => assert.rejects(promise, e => e.status === status && e.code === code);

test('tenant response cap remains 256 KiB unless explicitly overridden', async () => {
  const raw = JSON.stringify('x'.repeat(256 * 1024 - 2));
  globalThis.fetch = async () => new Response(raw);
  assert.equal((await call()).length, 256 * 1024 - 2);
  globalThis.fetch = async () => new Response(raw + ' ');
  await rejectsCode(call(), 413, 'BODY_TOO_LARGE');
  assert.equal((await call({ maxBytes: 256 * 1024 + 1 })).length, 256 * 1024 - 2);
  globalThis.fetch = async () => new Response('"1234"');
  await rejectsCode(call({ maxBytes: 5 }), 413, 'BODY_TOO_LARGE');
});

test('only explicit limit-aware requests distinguish saved-item limits', async () => {
  globalThis.fetch = async () => Response.json({ code: 'PT429', message: 'LIMIT_REACHED', details: 'private detail' }, { status: 429 });
  await rejectsCode(call(), 429, 'RATE_LIMITED');
  await assert.rejects(call({ limitAware: true }), e => e.status === 429 && e.code === 'LIMIT_REACHED' && e.message === 'A saved-item limit was reached.');
  for (const raw of ['not JSON', 'null', '{}', '{"message":"RATE_LIMITED"}', '{"message":"LIMIT_REACHED extra"}', JSON.stringify({ message: 'LIMIT_REACHED', details: 'x'.repeat(4096) })]) {
    globalThis.fetch = async () => new Response(raw, { status: 429 });
    await rejectsCode(call({ limitAware: true }), 429, 'RATE_LIMITED');
  }
});

test('bounded 429 reads cancel oversized streams and never expose upstream messages', async () => {
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(4097))); },
    cancel() { cancelled = true; },
  }), { status: 429 });
  await rejectsCode(call({ limitAware: true }), 429, 'RATE_LIMITED');
  assert.equal(cancelled, true);
  globalThis.fetch = async () => new Response('secret', { status: 409 });
  await assert.rejects(call({ limitAware: true }), e => e.code === 'CONFLICT' && !e.message.includes('secret'));
});
