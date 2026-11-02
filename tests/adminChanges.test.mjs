import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { changesQuery } from '../lib/adminChangesQuery.js';
import { ADMIN_PERMISSIONS } from '../lib/adminPermissions.js';
import { ADMIN_TABS, visibleAdminTabs } from '../lib/adminTabs.js';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/api/v1/admin/changes/route.js');
const ADMIN = { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111', 'x-veyrnox-auth-aal': 'aal2' };
const request = (query = '', headers = ADMIN) => new Request(`https://example.test/api/v1/admin/changes${query}`, { headers });
const parse = query => changesQuery(new URLSearchParams(query));
const CURSOR = { created_at: '2026-11-01T08:20:30.123456+00:00', id: '11111111-1111-4111-8111-111111111112' };

test('query preserves cursor microseconds and binds exact actor/date filters', () => {
  const params = new URLSearchParams({ area: 'role', actor: 'owner+test@example.invalid', from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z', before: JSON.stringify(CURSOR), limit: '100' });
  assert.deepEqual(changesQuery(params), { args: { p_area: 'role', p_actor: 'owner+test@example.invalid', p_from: '2026-11-01T00:00:00Z', p_to: '2026-11-02T00:00:00Z', p_before: CURSOR, p_limit: 100 } });
  assert.equal(parse('').args.p_limit, 50);
});

test('bad filter shapes, dates, limits and duplicate parameters are refused', () => {
  for (const query of ['area=secrets', 'area=', 'limit=0', 'limit=-1', 'limit=101', 'limit=1.1', 'limit=1e1', 'limit=', 'actor=', 'actor=%00', `actor=${'a'.repeat(321)}`, 'limit=5&limit=6', 'extra=1', 'from=infinity', 'from=2026-02-30T00:00:00Z', 'from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z']) {
    assert.equal(parse(query).error, 'filters_invalid', query);
  }
  for (const value of [null, [], {}, { ...CURSOR, id: 'bad' }, { ...CURSOR, created_at: 'infinity' }, { ...CURSOR, extra: true }]) {
    assert.equal(changesQuery(new URLSearchParams({ before: JSON.stringify(value) })).error, 'cursor_invalid');
  }
  assert.equal(parse('before=not-json').error, 'cursor_invalid');
});

test('shell hides unbuilt and unauthorized tabs and leaves existing admin pages accessible', () => {
  assert.equal(ADMIN_TABS.length, 10);
  assert.deepEqual(visibleAdminTabs(), []);
  assert.deepEqual(visibleAdminTabs({ permissions: ['*'] }), []);
  const all = visibleAdminTabs({ isAdmin: true, permissions: ADMIN_PERMISSIONS.owner }).map(t => t.id);
  assert.deepEqual(all, ['users', 'payments', 'changes', 'affiliates', 'endpoints', 'roles', 'switches', 'plans', 'traffic', 'support', 'violations', 'appeals', 'reports', 'webhooks', 'security', 'cinema']);
  const limited = visibleAdminTabs({ isAdmin: true, permissions: ['changes.read'] }).map(t => t.id);
  assert.ok(limited.includes('changes'));
  assert.ok(!limited.includes('users'));
  assert.ok(!limited.includes('roles'));
});

test('route gates, validation, RPC refusals and failures are all no-store and reveal no diagnostics', async t => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', ADMIN_REQUIRE_AAL2: 'true', ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const calls = [];
  let respond = () => Response.json({ ok: true, entries: [], next_cursor: null });
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return String(url).endsWith('/admin_permissions') ? Response.json({ok:true,permissions:['changes.read']}) : respond(); });
  t.mock.method(console, 'error', () => {});
  const expect = async (req, status, body) => {
    const res = await GET(req);
    assert.equal(res.status, status);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), body);
  };
  await expect(request('', {}), 401, { error: 'not_authenticated' });
  await expect(request('', { ...ADMIN, 'x-veyrnox-auth-aal': 'aal1' }), 403, { error: 'mfa_required' });
  await expect(request('?limit=101'), 400, { error: 'filters_invalid' });
  await expect(request('?before=null'), 400, { error: 'cursor_invalid' });
  assert.equal(calls.length, 0);
  await expect(request('?area=account&actor=system&limit=1'), 200, { entries: [], next_cursor: null, permissions: ['changes.read'] });
  assert.deepEqual(calls[1].body, { p_auth_id: ADMIN['x-veyrnox-auth-id'], p_area: 'account', p_actor: 'system', p_from: null, p_to: null, p_before: null, p_limit: 1 });
  assert.match(calls[1].url, /\/rpc\/admin_changes_feed$/);
  respond = () => Response.json({ code: '42501', message: 'private diagnostic' }, { status: 403 });
  await expect(request(), 403, { error: 'not_admin' });
  respond = () => Response.json({ code: '22023', message: 'private diagnostic' }, { status: 400 });
  await expect(request(), 400, { error: 'filters_invalid' });
  respond = () => Response.json({ code: 'XX000', message: 'private diagnostic' }, { status: 500 });
  await expect(request(), 503, { error: 'changes_unavailable' });
  respond = () => { throw new Error('private diagnostic'); };
  await expect(request(), 503, { error: 'changes_unavailable' });
  delete process.env.SUPABASE_URL;
  await expect(request(), 503, { error: 'supabase_not_configured' });
});
