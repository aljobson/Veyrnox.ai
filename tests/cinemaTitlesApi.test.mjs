import test from 'node:test';
import assert from 'node:assert/strict';
import { titlesHandler } from '../lib/cinema/titlesApi.js';

const id = '11111111-1111-4111-8111-111111111111';
Object.assign(process.env, { CINEMA_ENABLED: 'true', CINEMA_VIEWING_ENABLED: 'true' });
const title = { id, content_type: 'SERIES', title: 'A story', creator: { username: 'maker' }, seasons: [] };
const list = [{ id, title: 'A story', published_at: '2026-09-26T10:00:00.000Z' }];

function setup(action, result, { authed = false, rate = { ok: true } } = {}) {
  const calls = [], store = new Map();
  const handle = titlesHandler({ action, authed, cache: { get: async (k) => store.get(k), put: async (k, r) => store.set(k, r) },
    rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'consume_account_read_request' ? rate : result; } });
  return { calls, store, handle };
}
const get = (path, headers = {}) => new Request(`https://test.invalid${path}`, { headers });
const ctx = (param) => ({ params: Promise.resolve({ id: param }) });

test('the anonymous catalogue is validated, cached for a minute, and never carries identity', async () => {
  const s = setup('list', list);
  process.env.CINEMA_VIEWING_ENABLED = 'false';
  assert.equal((await s.handle(get('/api/cinema/titles'))).status, 503);
  process.env.CINEMA_VIEWING_ENABLED = 'true';
  for (const q of ['?limit=0', '?limit=51', '?limit=abc', '?before=not-a-date', '?x=1']) assert.equal((await s.handle(get(`/api/cinema/titles${q}`))).status, 400, q);
  const res = await s.handle(get('/api/cinema/titles?limit=1&before=2026-09-26T12:00:00Z'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const data = await res.json();
  assert.deepEqual([data.titles.length, data.next], [1, '2026-09-26T10:00:00.000Z']);
  assert.deepEqual(s.calls[0].args, { p_limit: 1, p_before: '2026-09-26T12:00:00.000Z', p_category: null });
  assert.ok(!s.calls.some((c) => c.name === 'consume_account_read_request'));
  const again = await s.handle(get('/api/cinema/titles?limit=1&before=2026-09-26T12:00:00Z'));
  assert.equal(again.status, 200);
  assert.equal(s.calls.length, 2, 'served from the cache: titles and categories were read once');
  const full = setup('list', Array.from({ length: 24 }, (_, i) => ({ id, published_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })));
  assert.equal((await (await full.handle(get('/api/cinema/titles'))).json()).next, '2026-09-24T00:00:00.000Z');
  const short = setup('list', list);
  assert.equal((await (await short.handle(get('/api/cinema/titles'))).json()).next, null);
});

test('a title read is public without identity and per-viewer with it', async () => {
  const anon = setup('title', title);
  assert.equal((await anon.handle(get(`/api/cinema/titles/${id}`), ctx('nope'))).status, 400);
  assert.equal((await anon.handle(get(`/api/cinema/titles/${id}?x=1`), ctx(id))).status, 400);
  const res = await anon.handle(get(`/api/cinema/titles/${id}`), ctx(id.toUpperCase()));
  assert.equal(res.status, 200);
  assert.deepEqual(anon.calls[0].args, { p_auth_id: null, p_content_id: id });
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal((await anon.handle(get(`/api/cinema/titles/${id}`), ctx(id))).status, 200);
  assert.equal(anon.calls.length, 1, 'cached');
  const missing = setup('title', { error: 'title_not_found' });
  assert.equal((await missing.handle(get(`/api/cinema/titles/${id}`), ctx(id))).status, 404);

  const signed = setup('title', title, { authed: true });
  assert.equal((await signed.handle(get(`/api/v1/cinema/titles/${id}`), ctx(id))).status, 401);
  const r = await signed.handle(get(`/api/v1/cinema/titles/${id}`, { 'x-veyrnox-auth-id': id }), ctx(id));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(signed.calls[0].name, 'consume_account_read_request');
  assert.deepEqual(signed.calls[1].args, { p_auth_id: id, p_content_id: id });
  assert.equal(signed.store.size, 0, 'signed-in reads are never cached');
  const limited = setup('title', title, { authed: true, rate: { ok: false, code: 'RATE_LIMITED' } });
  assert.equal((await limited.handle(get(`/api/v1/cinema/titles/${id}`, { 'x-veyrnox-auth-id': id }), ctx(id))).status, 429);
  const odd = setup('title', { id: 'x' });
  assert.equal((await odd.handle(get(`/api/cinema/titles/${id}`), ctx(id))).status, 503);
});

test('the routes outside the auth middleware never opt into identity', async () => {
  // /api/cinema/* is not covered by middleware.js, so a spoofable header there
  // must never be read: only the /api/v1 variant may pass authed: true.
  const { readFileSync } = await import('node:fs');
  for (const file of ['../app/api/cinema/titles/route.js', '../app/api/cinema/titles/[id]/route.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /authed/, file);
  }
  assert.match(readFileSync(new URL('../app/api/v1/cinema/titles/[id]/route.js', import.meta.url), 'utf8'), /authed: true/);
});

test('the catalogue filters by one category slug and returns the category list', async () => {
  const calls = [];
  const handle = titlesHandler({ action: 'list', cache: { get: async () => undefined, put: async () => {} }, rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'list_cinema_categories' ? [{ slug: 'romance', label: 'Romance' }] : list; } });
  for (const q of ['?category=Romance', '?category=bad%20slug', '?category=']) assert.equal((await handle(get(`/api/cinema/titles${q}`))).status, 400, q);
  const res = await handle(get('/api/cinema/titles?category=romance'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual([data.category, data.categories[0].slug, data.titles.length], ['romance', 'romance', 1]);
  assert.equal(calls.find((c) => c.name === 'list_public_cinema_titles').args.p_category, 'romance');
  const all = await (await handle(get('/api/cinema/titles'))).json();
  assert.equal(all.category, null);
  assert.equal(calls.at(-2).args.p_category, null);
});
