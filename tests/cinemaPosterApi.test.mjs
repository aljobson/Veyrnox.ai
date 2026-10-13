import test from 'node:test';
import assert from 'node:assert/strict';
import { posterHandler, posterTime, streamPosterUrl } from '../lib/cinema/posterApi.js';

const id = '11111111-1111-4111-8111-111111111111';
const uid = 'a'.repeat(32);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
Object.assign(process.env, {
  CINEMA_ENABLED: 'true', CINEMA_VIEWING_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true',
  CREATOR_CONTENT_ENABLED: 'true', CREATOR_UPLOADS_ENABLED: 'true',
  CINEMA_STREAM_SIGNING_KEY_ID: 'b'.repeat(32),
  CINEMA_STREAM_SIGNING_JWK: btoa(JSON.stringify({ kty: 'RSA', d: 'private' })),
  CINEMA_STREAM_CUSTOMER_CODE: 'customer123',
});

const request = (path = id, headers = {}) => new Request(`https://veyrnox.test/api/cinema/posters/${path}`, { headers });
const context = value => ({ params: Promise.resolve({ id: value }) });
const noCache = { get: async () => undefined, put: async () => {} };

test('poster frame time is deterministic and the provider URL uses only a signed token', () => {
  assert.equal(posterTime(100), 25);
  assert.equal(posterTime(0.1), 0.025);
  assert.throws(() => posterTime(0), /invalid_duration/);
  const url = streamPosterUrl({ stream_uid: uid, duration_seconds: 40 }, { customerCode: 'abc123' }, 'signed.token');
  assert.equal(url.hostname, 'customer-abc123.cloudflarestream.com');
  assert.equal(url.pathname, '/signed.token/thumbnails/thumbnail.jpg');
  assert.equal(url.searchParams.get('time'), '10.000s');
  assert.equal(url.searchParams.get('fit'), 'crop');
  assert.equal(url.href.includes(uid), false);
});

test('public posters are ownership-safe JPEG proxies and cache by content id', async () => {
  const calls = [], store = new Map();
  const cache = { get: async key => store.get(key), put: async (key, value) => store.set(key, value) };
  const handle = posterHandler({ cache, now: () => 1_000_000,
    rpcCall: async (name, args) => { calls.push({ name, args }); return { stream_uid: uid, duration_seconds: 80 }; },
    sign: async (value, cfg, exp) => { calls.push({ sign: value, code: cfg.customerCode, exp }); return 'signed.token'; },
    fetcher: async (url, init) => { calls.push({ url: String(url), init }); return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }); },
  });
  const response = await handle(request(id, { 'x-veyrnox-auth-id': id }), context(id.toUpperCase()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.match(response.headers.get('cache-control'), /^public, max-age=300/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
  assert.deepEqual(calls[0], { name: 'read_cinema_poster_source', args: { p_auth_id: null, p_content_id: id } });
  assert.equal(calls[1].sign, uid);
  assert.equal(calls[1].exp, 1900);
  assert.match(calls[2].url, /signed\.token\/thumbnails\/thumbnail\.jpg/);
  assert.equal(calls[2].url.includes(uid), false);
  const cached = await handle(request(), context(id));
  assert.equal(cached.status, 200);
  assert.equal(calls.length, 3, 'provider and database are skipped on a cache hit');
});

test('missing or malformed poster sources fail closed without leaking provider details', async () => {
  let provider = 0;
  const missing = posterHandler({ cache: noCache, rpcCall: async () => ({ error: 'poster_not_found', stream_uid: uid }),
    sign: async () => { throw Error('must not sign'); }, fetcher: async () => { provider++; } });
  assert.equal((await missing(request(), context(id))).status, 404);
  assert.equal(provider, 0);
  assert.equal((await missing(request('bad'), context('bad'))).status, 400);
  assert.equal((await missing(new Request(`https://veyrnox.test/api/cinema/posters/${id}?time=0`), context(id))).status, 400);

  for (const upstream of [new Response('text', { headers: { 'content-type': 'text/plain' } }), new Response('not-jpeg', { headers: { 'content-type': 'image/jpeg' } })]) {
    const handle = posterHandler({ cache: noCache, rpcCall: async () => ({ stream_uid: uid, duration_seconds: 40 }), sign: async () => 'token', fetcher: async () => upstream });
    const response = await handle(request(), context(id));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('creator preview requires verified identity, read quota and owner-scoped lookup', async () => {
  const calls = [];
  const handle = posterHandler({ authed: true, cache: noCache,
    rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'consume_account_read_request' ? { ok: true } : { stream_uid: uid, duration_seconds: 20 }; },
    sign: async () => 'private.token', fetcher: async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }),
  });
  assert.equal((await handle(request(), context(id))).status, 401);
  const response = await handle(request(id, { 'x-veyrnox-auth-id': id }), context(id));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=60');
  assert.deepEqual(calls.map(call => call.name), ['consume_account_read_request', 'read_cinema_poster_source']);
  assert.equal(calls[1].args.p_auth_id, id);

  const limited = posterHandler({ authed: true, cache: noCache, rpcCall: async () => ({ ok: false, code: 'RATE_LIMITED' }) });
  assert.equal((await limited(request(id, { 'x-veyrnox-auth-id': id }), context(id))).status, 429);
});
