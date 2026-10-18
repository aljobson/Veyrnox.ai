import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksHandler } from '../lib/cinema/blocksApi.js';
import { titlesHandler } from '../lib/cinema/titlesApi.js';

const me = '11111111-1111-4111-8111-111111111111';
Object.assign(process.env, { CINEMA_ENABLED: 'true', CINEMA_VIEWING_ENABLED: 'true' });
const asMe = { 'x-veyrnox-auth-id': me, 'content-type': 'application/json' };
const url = 'https://test.invalid/api/v1/cinema/blocks';
const setup = (action, result, rate = { ok: true }) => {
  const calls = [];
  return { calls, handle: blocksHandler({ action, rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'consume_account_read_request' ? rate : result; } }) };
};
const post = (body, headers = asMe) => new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
const ctx = (username) => ({ params: Promise.resolve({ username }) });

test('every blocks route needs the middleware identity before any RPC', async () => {
  for (const [action, req, c] of [['list', new Request(url)], ['block', post({ username: 'maker' }, { 'content-type': 'application/json' })], ['unblock', new Request(`${url}/maker`, { method: 'DELETE' }), ctx('maker')]]) {
    const s = setup(action, { ok: true });
    assert.equal((await s.handle(req, c)).status, 401, action);
    assert.equal(s.calls.length, 0, action);
  }
  const spoofed = setup('list', { ok: true });
  assert.equal((await spoofed.handle(new Request(url, { headers: { 'x-veyrnox-auth-id': 'not-a-uuid' } }))).status, 401);
});

test('the block body is exact, and the caller can only name a username, never an id', async () => {
  const s = setup('block', { ok: true, already: false });
  for (const body of [{}, { username: 'Maker' }, { username: 'x' }, { username: 'maker', user_id: me }, { user_id: me }, { username: 3 }, [], null])
    assert.equal((await s.handle(post(body))).status, 400, JSON.stringify(body));
  assert.equal((await s.handle(new Request(url, { method: 'POST', headers: { 'x-veyrnox-auth-id': me, 'content-type': 'text/plain' }, body: '{}' }))).status, 415);
  assert.equal(s.calls.length, 0);
  const ok = await s.handle(post({ username: 'maker' }));
  assert.equal(ok.status, 201);
  assert.deepEqual(s.calls[1].args, { p_auth_id: me, p_username: 'maker' });
});

test('a replayed block or unblock answers 200 with already:true and changes nothing more', async () => {
  const again = setup('block', { ok: true, already: true });
  const r = await again.handle(post({ username: 'maker' }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).already, true);
  const gone = setup('unblock', { ok: true, already: true });
  const u = await gone.handle(new Request(`${url}/maker`, { method: 'DELETE', headers: asMe }), ctx('maker'));
  assert.equal(u.status, 200);
  assert.deepEqual(gone.calls[1], { name: 'unblock_cinema_user', args: { p_auth_id: me, p_username: 'maker' } });
  assert.equal((await gone.handle(new Request(`${url}/Bad!`, { method: 'DELETE', headers: asMe }), ctx('Bad!'))).status, 400);
});

test('typed errors, rate limit, closed viewing and unknown RPC errors never leak', async () => {
  for (const [error, status] of [['user_not_found', 404], ['cannot_block_self', 400], ['block_limit', 409], ['boom: db detail', 503]]) {
    const s = setup('block', { error });
    const r = await s.handle(post({ username: 'maker' }));
    assert.equal(r.status, status);
    assert.equal((await r.json()).error, status === 503 ? 'temporarily_unavailable' : error);
  }
  const limited = setup('list', { ok: true, blocks: [] }, { ok: false, code: 'RATE_LIMITED' });
  const r = await limited.handle(new Request(url, { headers: asMe }));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.equal((await setup('list', { ok: true, blocks: [] }).handle(new Request(`${url}?x=1`, { headers: asMe }))).status, 400);
  process.env.CINEMA_VIEWING_ENABLED = 'false';
  assert.equal((await setup('list', { ok: true, blocks: [] }).handle(new Request(url, { headers: asMe }))).status, 503);
  process.env.CINEMA_VIEWING_ENABLED = 'true';
});

test('the list returns only the public fields of each blocked member', async () => {
  const s = setup('list', { ok: true, blocks: [{ username: 'maker', display_name: 'Maker', created_at: '2026-10-18T10:00:00Z', user_id: me }, { username: 'BAD!' }] });
  const body = await (await s.handle(new Request(url, { headers: asMe }))).json();
  assert.deepEqual(body.blocks, [{ username: 'maker', display_name: 'Maker', created_at: '2026-10-18T10:00:00Z' }]);
});

test('the signed-in title list drops a blocked creator; the anonymous one never looks', async () => {
  const page = [{ id: 'a', username: 'maker', published_at: '2026-09-02T00:00:00.000Z' }, { id: 'b', username: 'other', published_at: '2026-09-01T00:00:00.000Z' }];
  const run = (authed, blocks) => {
    const calls = [];
    const handle = titlesHandler({ action: 'list', authed, cache: { get: async () => undefined, put: async () => {} }, rpcCall: async (name) => {
      calls.push(name);
      if (name === 'consume_account_read_request') return { ok: true };
      if (name === 'list_blocked_cinema_users') return blocks;
      if (name === 'list_cinema_categories') return [];
      return page;
    } });
    return { calls, handle };
  };
  const signedIn = run(true, { ok: true, blocks: [{ username: 'maker' }] });
  const body = await (await signedIn.handle(new Request('https://test.invalid/api/v1/cinema/titles?limit=2', { headers: { 'x-veyrnox-auth-id': me } }))).json();
  assert.deepEqual(body.titles.map((t) => t.id), ['b']);
  assert.equal(body.next_id, 'b', 'the cursor comes from the unfiltered page');
  const anon = run(false, null);
  const open = await (await anon.handle(new Request('https://test.invalid/api/cinema/titles?limit=2'))).json();
  assert.equal(open.titles.length, 2);
  assert.ok(!anon.calls.includes('list_blocked_cinema_users'));
  const broken = run(true, { error: 'x' });
  assert.equal((await broken.handle(new Request('https://test.invalid/api/v1/cinema/titles', { headers: { 'x-veyrnox-auth-id': me } }))).status, 503);
});
