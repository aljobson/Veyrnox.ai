import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsHandler, earningsMonth } from '../lib/cinema/earningsApi.js';
import { SupabaseError } from '../packages/db/supabase-client.js';

const id = '11111111-1111-4111-8111-111111111111';
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
Object.assign(process.env, { CINEMA_ENABLED: 'true', CINEMA_SUBSCRIPTIONS_ENABLED: 'true', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud' });
const headers = (over = {}) => ({ 'x-veyrnox-auth-id': id, 'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': String(Math.floor(NOW / 1000) - 10), 'cf-access-jwt-assertion': 'token', ...over });
const get = (query = '', over = {}) => new Request(`https://test.invalid/api/v1/admin/cinema/earnings${query}`, { headers: headers(over) });
const result = { ok: true, month: '2026-09', generated_at: 'x', content: [{ content_id: id, unlock_credits: 12, pass_seconds: 300 }], totals: { unlock_credits: 12, pass_seconds: 300 } };

function setup({ rpc = {}, access = async () => ({ email: 'op@veyrnox.ai' }) } = {}) {
  const calls = [];
  const handle = earningsHandler({ accessVerifier: access, now: () => NOW, rpcCall: async (name, args) => { calls.push({ name, args }); if (name === 'consume_account_read_request') return rpc.rate ?? { ok: true }; if (rpc.throws) throw rpc.throws; return rpc.result ?? result; } });
  return { calls, handle };
}

test('the earnings read needs identity, a fresh second factor and an Access assertion before any RPC', async () => {
  const s = setup();
  assert.equal((await s.handle(get('', { 'x-veyrnox-auth-id': '' }))).status, 401);
  assert.equal((await s.handle(get('', { 'x-veyrnox-auth-aal': 'aal1' }))).status, 403);
  assert.equal((await s.handle(get('', { 'x-veyrnox-auth-mfa-at': String(Math.floor(NOW / 1000) - 600) }))).status, 403);
  assert.equal((await s.handle(get('', { 'cf-access-jwt-assertion': '' }))).status, 403);
  const bad = setup({ access: async () => { throw new Error('nope'); } });
  assert.equal((await bad.handle(get())).status, 403);
  process.env.CINEMA_SUBSCRIPTIONS_ENABLED = 'false';
  assert.equal((await s.handle(get())).status, 503);
  process.env.CINEMA_SUBSCRIPTIONS_ENABLED = 'true';
  assert.equal(s.calls.length, 0);
});

test('the month is validated, defaults to the current UTC month, and a non-admin learns only that', async () => {
  const s = setup();
  const res = await s.handle(get('?month=2026-08'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual([data.month, data.totals.pass_seconds, data.content.length], ['2026-09', 300, 1]);
  assert.equal(s.calls.find((c) => c.name === 'operator_cinema_earnings').args.p_month, '2026-08-01');
  await s.handle(get());
  assert.equal(s.calls.at(-1).args.p_month, '2026-09-01');
  for (const q of ['?month=2026-13', '?month=26-09', '?month=2026-09&x=1']) assert.equal((await s.handle(get(q))).status, 400, q);
  assert.equal(earningsMonth(new URLSearchParams(''), NOW), '2026-09');
  assert.equal(earningsMonth(new URLSearchParams('month=2025-02'), NOW), '2025-02');
  const notAdmin = setup({ rpc: { throws: new SupabaseError('rpc failed', { status: 400, body: { code: '42501', message: 'not_admin' } }) } });
  const r = await notAdmin.handle(get());
  assert.equal(r.status, 403);
  assert.deepEqual((await r.json()).error, 'not_admin');
  const other = setup({ rpc: { throws: new Error('private connection string') } });
  const o = await other.handle(get());
  assert.equal(o.status, 503);
  assert.ok(!(await o.text()).includes('private'));
  const limited = setup({ rpc: { rate: { ok: false, code: 'RATE_LIMITED' } } });
  assert.equal((await limited.handle(get())).status, 429);
});
