// Requires a fully replayed, isolated local database. All fixtures roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  || new URL(url).searchParams.has('host')) throw new Error('isolated local DATABASE_URL required');
const client = new pg.Client({ connectionString: url });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const migration = await readFile(new URL('../packages/db/schema/supabase/0426_admin_change_log.sql', import.meta.url), 'utf8');
const signature = 'public.admin_changes_feed(text,text,jsonb,integer,text,timestamp with time zone,timestamp with time zone)';
const feed = async (auth, { area = null, before = null, limit = 50, actor = null, from = null, to = null } = {}) =>
  (await one('SELECT public.admin_changes_feed($1,$2,$3,$4,$5,$6,$7) AS value', [auth, area, before, limit, actor, from, to])).value;
async function person(admin) {
  const auth = randomUUID();
  await q('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@example.invalid`]);
  const row = await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id,email', [auth, admin]);
  if (admin && (await one("SELECT to_regclass('public.admin_roles') AS present")).present) await q("INSERT INTO public.admin_roles(user_id,role) VALUES($1,'owner')",[row.id]);
  assert.ok(row, 'identity trigger provisioned the user');
  return { auth, ...row };
}
async function refuses(run, code = '42501') {
  await q('SAVEPOINT refusal');
  try { await assert.rejects(run, error => error.code === code); }
  finally { await q('ROLLBACK TO SAVEPOINT refusal'); await q('RELEASE SAVEPOINT refusal'); }
}
async function asService(run) {
  await q('SAVEPOINT service_call');
  try { await q('SET LOCAL ROLE service_role'); return await run(); }
  finally { await q('ROLLBACK TO SAVEPOINT service_call'); await q('RELEASE SAVEPOINT service_call'); }
}

try {
  await q('BEGIN');
  const roles = await readFile(new URL('../packages/db/schema/supabase/0428_admin_roles.sql',import.meta.url),'utf8');
  await q(roles);
  const wrapper=await one('SELECT pg_get_functiondef($1::regprocedure) AS body',[signature]);
  await q(migration);await q(migration);
  assert.deepEqual(await one('SELECT pg_get_functiondef($1::regprocedure) AS body',[signature]),wrapper,'S0 replay must preserve the role wrapper');
  const admin = await person(true);
  const ordinary = await person(false);
  const finance = await person(true);await q("UPDATE public.admin_roles SET role='finance' WHERE user_id=$1",[finance.id]);
  await refuses(() => asService(() => feed(finance.auth)));
  const actor = admin.email;
  const call = options => asService(() => feed(admin.auth, { actor, ...options }));
  assert.deepEqual(await call({}), { ok: true, entries: [], next_cursor: null });
  await refuses(() => asService(() => feed(ordinary.auth)));
  await refuses(() => asService(() => feed(randomUUID())));

  const ids = Array.from({ length: 4 }, () => randomUUID()).sort().reverse();
  for (let index = 0; index < 3; index++) {
    await q(`INSERT INTO public.admin_change_log(id,actor_user_id,actor_email,area,action,subject,"before","after",reason,created_at)
      VALUES($1,$2,$3,'other','fixture',$4,'{"active":false}','{"active":true}','test operator decision','2026-11-01T12:00:00.123456Z')`,
    [ids[index], admin.id, actor, ordinary.id]);
    if (index === 0) {
      const single = await call({});
      assert.equal(single.entries.length, 1);
      assert.equal(single.next_cursor, null);
      assert.deepEqual(single.entries[0].before, { active: false });
      assert.deepEqual(single.entries[0].after, { active: true });
    }
  }
  await q(`INSERT INTO public.account_actions(id,user_id,action,actor,reason,created_at)
    VALUES($1,$2,'unfreeze',$3,'fixture account action','2026-11-01T12:00:00.123456Z')`, [ids[3], ordinary.id, actor]);
  const first = await call({ limit: 2 });
  assert.deepEqual(first.entries.map(row => row.id), ids.slice(0, 2));
  assert.match(first.next_cursor.created_at, /\.123456/);
  const second = await call({ limit: 2, before: first.next_cursor });
  assert.deepEqual(second.entries.map(row => row.id), ids.slice(2));
  assert.equal(second.next_cursor, null);
  assert.equal(second.entries[1].area, 'account');
  assert.equal(second.entries[1].subject_email, ordinary.email);
  assert.equal((await call({ area: 'account' })).entries.length, 1);
  assert.equal((await call({ area: 'role' })).entries.length, 0);
  assert.equal((await call({ actor: actor.toUpperCase() })).entries.length, 4);
  assert.equal((await call({ from: '2026-11-01T12:00:00.123456Z' })).entries.length, 4);
  assert.equal((await call({ to: '2026-11-01T12:00:00.123456Z' })).entries.length, 0);
  for (const options of [{ limit: 0 }, { limit: 101 }, { limit: null }, { area: 'bad' }, { actor: '' }, { actor: 'x'.repeat(321) }, { from: 'infinity' }, { from: '2026-11-02', to: '2026-11-01' }, { before: {} }, { before: { id: ids[0], created_at: 'infinity' } }]) {
    await refuses(() => call(options), '22023');
  }
  for (const statement of ['UPDATE public.admin_change_log SET reason=reason', 'DELETE FROM public.admin_change_log', 'TRUNCATE public.admin_change_log']) {
    await refuses(() => q(statement));
  }
  const rls = await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.admin_change_log'::regclass");
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const acl = await one(`SELECT has_table_privilege($1,'public.admin_change_log','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access,
      has_function_privilege($1,$2,'EXECUTE') AS rpc_access`, [role, signature]);
    assert.equal(acl.table_access, false, role);
    assert.equal(acl.rpc_access, role === 'service_role', role);
  }
  await q(migration);
  await q(migration);
  assert.deepEqual((await call({})).entries.map(row => row.id), ids, 'replay preserves the audit history');
  for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_subscription_credits']) {
    assert.deepEqual(await q(`SELECT * FROM public.${fn}()`), [], `${fn} stays clean`);
  }
  console.log('admin panel S0: empty/single/many, filters, keyset ties, admin checks, ACLs, append-only, replay and reconciliation passed');
} finally {
  await q('ROLLBACK');
  await client.end();
}
