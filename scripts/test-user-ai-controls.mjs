// Host-run against a fully migrated isolated local DB (ADR-0327). Rolls back; no fixture survives.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || new URL(url).searchParams.has('host')) throw Error('isolated local DATABASE_URL required');
const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const call = async (name, args) => (await one('SELECT public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') AS value', args)).value;
async function person(role) {
  const auth = randomUUID(); await q('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, auth + '@example.invalid']);
  const user = await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id', [auth, !!role]);
  if (role) await q('INSERT INTO public.admin_roles(user_id,role) VALUES($1,$2)', [user.id, role]);
  return { ...user, auth };
}
async function rejects(run, code) {
  await q('SAVEPOINT rejected');
  try { await assert.rejects(run, e => e.code === code); }
  finally { await q('ROLLBACK TO SAVEPOINT rejected'); await q('RELEASE SAVEPOINT rejected'); }
}
const fresh = () => new Date().toISOString();
const set = (actor, user, disabled, limit, idem = randomUUID(), at = fresh()) =>
  call('admin_ai_control_set', [actor.auth, user, disabled, limit, 'Cost control', idem, 'aal2', at]);
const check = (p) => call('check_generation_rate_limit', [p.auth, 10, 60]);
try {
  await q('BEGIN');
  const migration = await readFile(new URL('../packages/db/schema/supabase/0443_user_ai_controls.sql', import.meta.url), 'utf8');
  await q(migration); await q(migration);
  const owner = await person('owner'), finance = await person('finance'), ordinary = await person(), target = await person();

  // No row, no change.
  assert.deepEqual(await check(target), { ok: true, count: 0, limit: 10 });

  // Only an owner-class permission may write or read.
  await rejects(() => set(ordinary, target.id, true, null), '42501');
  await rejects(() => set(finance, target.id, true, null), '42501');
  await rejects(() => call('admin_ai_control_get', [finance.auth, null]), '42501');

  // Input rules: limit 1..10, global cannot disable, fresh MFA, unknown user.
  await rejects(() => set(owner, target.id, false, 11), '22023');
  await rejects(() => set(owner, target.id, false, 0), '22023');
  await rejects(() => set(owner, null, true, null), '22023');
  await rejects(() => set(owner, randomUUID(), true, null), '22023');
  await rejects(() => set(owner, target.id, true, null, randomUUID(), new Date(Date.now() - 301000).toISOString()), 'P0001');

  // Per-user limit lowers, never raises.
  const lim = await set(owner, target.id, false, 2);
  assert.equal(lim.ok, true);
  assert.equal((await check(target)).limit, 2);
  assert.equal((await call('check_generation_rate_limit', [target.auth, 1, 60])).limit, 1);

  // Global limit applies to everyone; the lower of the two wins.
  assert.equal((await set(owner, null, false, 1)).ok, true);
  assert.equal((await check(ordinary)).limit, 1);
  assert.equal((await check(target)).limit, 1);
  assert.equal((await set(owner, null, false, null)).ok, true);
  assert.equal((await check(ordinary)).limit, 10);

  // Kill switch: refused before the attempt counter moves; other accounts unaffected.
  const attempts = () => one('SELECT request_count FROM public.generation_attempt_rate_limits WHERE user_id=$1', [target.id]);
  const before = await attempts();
  assert.equal((await set(owner, target.id, true, null)).ok, true);
  assert.deepEqual(await check(target), { ok: false, code: 'AI_DISABLED' });
  assert.deepEqual(await attempts(), before);
  assert.equal((await check(ordinary)).ok, true);

  // Idempotent replay, key reuse, audit row.
  const idem = randomUUID(), saved = await set(owner, target.id, true, null, idem);
  assert.deepEqual(await set(owner, target.id, true, null, idem), saved);
  assert.equal((await set(owner, target.id, false, null, idem)).code, 'idempotency_key_reused');
  const audit = await one('SELECT area,action,subject FROM public.admin_change_log WHERE id=$1', [saved.change_id]);
  assert.deepEqual(audit, { area: 'other', action: 'ai_control_set', subject: target.id });

  // Turning it back on restores service.
  assert.equal((await set(owner, target.id, false, null)).ok, true);
  assert.equal((await check(target)).ok, true);

  // Lookup by email.
  const got = await call('admin_ai_control_get', [owner.auth, null]);
  assert.equal(got.ok, true);

  // Locked down.
  for (const t of ['user_ai_controls', 'ai_limit_policy']) {
    assert.deepEqual(await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', ['public.' + t]), { relrowsecurity: true, relforcerowsecurity: true });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await one("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS a", [role, 'public.' + t])).a, false);
    }
  }
  console.log('user-ai-controls: ok');
} finally {
  await q('ROLLBACK'); await c.end();
}
