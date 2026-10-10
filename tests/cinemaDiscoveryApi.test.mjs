import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryHandler } from '../lib/cinema/discoveryApi.js';
const id = '11111111-1111-4111-8111-111111111111';
const at = '2026-10-10T21:00:00.123456+00:00';
const title = { id, root_id: id, content_type: 'SERIES', title: 'Published story', synopsis: '', series_title: null,
  categories: ['drama'], published_at: at, username: 'creator', display_name: 'Creator', duration_seconds: null, episode_count: 1, competitions: [] };
Object.assign(process.env, { CINEMA_ENABLED: 'true', CINEMA_VIEWING_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', VOTING_ENABLED: 'true' });
function setup(page = { titles: [title] }, categories = [{ slug: 'drama', label: 'Drama' }]) {
  const calls = [];
  const handler = discoveryHandler({ rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'list_cinema_categories' ? categories : page; } });
  const get = q => handler(new Request(`https://test.invalid/api/cinema/discovery${q}`, { headers: { 'x-veyrnox-auth-id': id, 'x-veyrnox-auth-role': 'service_role' } }));
  return { get, calls };
}
test('discovery gates before database reads and never trusts spoofed identity', async () => {
  const s = setup(); process.env.CINEMA_VIEWING_ENABLED = 'false';
  assert.equal((await s.get('')).status, 503); assert.equal(s.calls.length, 0);
  process.env.CINEMA_VIEWING_ENABLED = 'true'; process.env.VOTING_ENABLED = 'false';
  assert.equal((await s.get('?mode=voting')).status, 503); assert.equal(s.calls.length, 0);
  const r = await s.get('?mode=series'); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(s.calls[0], { name: 'list_cinema_discovery', args: { p_mode: 'series', p_limit: 12, p_before: null, p_before_id: null, p_category: null } });
  assert.ok(s.calls.every(c => !Object.keys(c.args).includes('p_auth_id')));
  process.env.VOTING_ENABLED = 'true';
});
test('strict query validation preserves compound cursor microseconds', async () => {
  const s = setup();
  for (const q of ['?mode=', '?mode=winners', '?mode=all&mode=series', '?limit=0', '?limit=25', '?limit=abc', '?category=', '?category=Drama', '?x=1', `?before_id=${id}`, '?before=2026-10-10T00:00:00Z', `?before=2026-02-30T00:00:00Z&before_id=${id}`, `?before=2026-10-10T24:00:00Z&before_id=${id}`]) assert.equal((await s.get(q)).status, 400, q);
  assert.equal(s.calls.length, 0);
  const r = await s.get(`?${new URLSearchParams({ mode: 'series', category: 'drama', before: at, before_id: id, limit: '1' })}`);
  assert.equal(r.status, 200); assert.equal(s.calls[0].args.p_before, at);
  assert.deepEqual((await r.json()).next, { at, id });
});
test('the public projection strips unexpected private fields including ballots and stream tokens', async () => {
  const comp = { id, name: 'This week', ends_at: at, qualified_votes: 2, voter_id: 'private', held_count: 20 };
  const s = setup({ titles: [{ ...title, creator_id: 'private', stream_uid: 'secret', competitions: [comp], my_vote: 'private' }] });
  const data = await (await s.get('?mode=voting')).json();
  assert.equal(data.titles.length, 1); assert.deepEqual(data.titles[0].competitions, [{ id, name: comp.name, ends_at: at, qualified_votes: 2 }]);
  for (const field of ['creator_id', 'stream_uid', 'my_vote']) assert.equal(Object.hasOwn(data.titles[0], field), false);
  assert.equal(data.next, null);
});
test('malformed or oversized RPC results fail closed and legitimate 160-character titles are accepted', async () => {
  for (const patch of [{ id: 'bad' }, { root_id: 'bad' }, { content_type: 'SEASON' }, { title: 'x'.repeat(161) }, { competitions: [{ id, name: 'Week', ends_at: at, qualified_votes: -1 }] }, { categories: ['Bad'] }, { episode_count: 1.1 }]) {
    const s = setup({ titles: [{ ...title, ...patch }] }); assert.equal((await s.get('')).status, 503, JSON.stringify(patch));
  }
  assert.equal((await setup({ titles: [{ ...title, title: 'x'.repeat(160) }] }).get('')).status, 200);
  assert.equal((await setup({ titles: Array(13).fill(title) }).get('')).status, 503);
  assert.equal((await setup({ titles: [title] }).get('?mode=voting')).status, 503);
  assert.equal((await setup({ titles: [{ ...title, content_type: 'FILM' }] }).get('?mode=series')).status, 503);
  assert.equal((await setup({ error: 'invalid_query' }).get('')).status, 503);
});
