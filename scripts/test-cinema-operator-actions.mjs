// Disposable local database only: Operator permissions, durable retries, races and ledger invariants.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)
    || !/(?:rebuild_check|[^/]+_test)$/.test(new URL(url).pathname)) throw Error('isolated local test database required');
const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const now = () => Math.floor(Date.now() / 1000);
const begin = (actor, action, target, key = randomUUID(), reason = 'Operator review', mfa = now()) => value(
  'SELECT public.begin_cinema_operator_action($1,$2,$3,$4,$5,$6,$7,$8) AS value', [actor, 'aal2', mfa, key, action, target, reason, randomUUID()]);
const complete = (actor, operation, refund = `re_${randomUUID().replaceAll('-', '')}`, cents = 1299) => value(
  'SELECT public.complete_cinema_operator_refund($1,$2,$3,$4,$5,$6,$7) AS value', [actor, 'aal2', now(), operation, refund, cents, randomUUID()]);
async function person(admin = false, role = null) {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  if (admin) await q('UPDATE public.users SET is_admin=true WHERE auth_id=$1', [actor]);
  if (role) {
    await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [actor, randomUUID(), { username: `o_${actor.replaceAll('-', '').slice(0, 20)}`, display_name: role }]);
    await q('UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)', [actor, role]);
  }
  return actor;
}
try {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0150_cinema_operator_actions.sql', import.meta.url), 'utf8');
  await c.query('BEGIN'); await c.query(sql); await c.query(sql); await c.query('ROLLBACK');
  const operator = await person(true), secondOperator = await person(true), reviewer = await person(false, 'administrator');
  const creator = await person(false, 'creator'), viewer = await person();
  const draft = { content_type: 'FILM', parent_id: null, position: null, title: 'Operator fixture', synopsis: '', language: 'en', ai_disclosures: [] };
  const film = (await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), null, 0, draft])).id;
  assert.ok(film);
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=$1", [film]);
  const unlock = await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [viewer, film, 'unlock-2026-09-26']);
  assert.equal(unlock.access, 'unlocked', JSON.stringify(unlock));
  assert.equal((await begin(reviewer, 'reverse_unlocks', film)).error, 'not_authorized');
  assert.equal((await begin(operator, 'reverse_unlocks', film, randomUUID(), 'Review', now() - 600)).error, 'not_authorized');
  assert.equal((await begin(operator, 'reverse_unlocks', film)).error, 'content_still_published');
  await q("UPDATE public.cinema_content SET lifecycle_status='SUSPENDED', visibility='PRIVATE' WHERE id=$1", [film]);
  const key = randomUUID(); const reversed = await begin(operator, 'reverse_unlocks', film, key);
  assert.deepEqual([reversed.ok, reversed.unlocks_reversed, reversed.credits_returned], [true, 1, 6]);
  assert.equal((await begin(operator, 'reverse_unlocks', film, key)).idempotent, true);
  assert.equal((await begin(operator, 'reverse_unlocks', film, key, 'Different reason')).error, 'idempotency_conflict');
  assert.equal((await begin(secondOperator, 'reverse_unlocks', film)).unlocks_reversed, 0);
  assert.equal(await value("SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason=$1", [`reverse:cinema_unlock:${film}`]), 1);
  assert.equal(await value('SELECT operator AS value FROM public.cinema_unlock_reversals WHERE content_id=$1 ORDER BY created_at LIMIT 1', [film]), `operator:${operator}`);

  // Two pending checkouts before either activates produce one live and one flagged Pass.
  const buyer = await person();
  const start = () => value('SELECT public.start_cinema_pass($1,$2,$3,$4,5,600) AS value', [buyer, 'pass-weekly', randomUUID(), 'cinema-pass-2026-09-26']);
  const first = await start(), second = await start();
  const suffix = randomUUID().replaceAll('-', '');
  const apply = (pass, sub) => value('SELECT public.apply_cinema_pass_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',
    [`evt_${randomUUID().replaceAll('-', '')}`, 'customer.subscription.updated', pass, sub, `cus_${suffix}`, 'active', new Date(Date.now() + 86400000), false, new Date()]);
  assert.equal((await apply(first.pass_id, `sub_a${suffix}`)).status, 'active');
  assert.equal((await apply(second.pass_id, `sub_b${suffix}`)).status, 'flagged');
  const snapshot = () => value("SELECT jsonb_build_object('ledger',(SELECT count(*) FROM public.ledger_entries),'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.user_id) FROM public.credit_balances b)) AS value");
  const before = await snapshot();
  assert.equal((await begin(operator, 'refund_pass', first.pass_id)).error, 'pass_not_flagged');
  assert.equal((await begin(reviewer, 'refund_pass', second.pass_id)).error, 'not_authorized');
  const refundKey = randomUUID();
  const op = await begin(operator, 'refund_pass', second.pass_id, refundKey);
  assert.deepEqual([op.ok, op.complete, op.subscription_id], [true, false, `sub_b${suffix}`]);
  assert.equal((await begin(operator, 'refund_pass', second.pass_id, refundKey)).action_id, op.action_id);
  assert.equal((await begin(secondOperator, 'refund_pass', second.pass_id)).error, 'refund_already_requested');
  assert.equal((await complete(secondOperator, op.action_id)).error, 'action_not_found');
  assert.equal((await complete(reviewer, op.action_id)).error, 'not_authorized');
  assert.equal((await complete(operator, op.action_id, 'invalid')).error, 'invalid_request');
  // Refund webhook beats the HTTP receipt; retries must still finish the same operation.
  await value('SELECT public.end_cinema_pass($1,$2,$3,$4,$5) AS value', [`sub_b${suffix}`, `evt_end${suffix}`, 'refunded', 're_external', new Date()]);
  assert.equal((await begin(operator, 'refund_pass', second.pass_id, refundKey)).action_id, op.action_id);
  const refundId = `re_${suffix}`;
  assert.equal((await complete(operator, op.action_id, refundId)).ok, true);
  assert.equal((await complete(operator, op.action_id, refundId)).idempotent, true);
  assert.equal((await complete(operator, op.action_id, refundId, 999)).error, 'idempotency_conflict');
  const done = await begin(operator, 'refund_pass', second.pass_id, refundKey);
  assert.deepEqual([done.complete, done.refund_usd_cents, done.idempotent], [true, 1299, true]);
  assert.equal(await value('SELECT status AS value FROM public.cinema_passes WHERE id=$1', [first.pass_id]), 'active');
  assert.deepEqual(await snapshot(), before, 'Pass refunds never touch ledger or credit balances');

  // Completion also ends a still-flagged Pass, and preserves an intervening dispute.
  for (const disputed of [false, true]) {
    const anotherBuyer = await person();
    const pending = await value('SELECT public.start_cinema_pass($1,$2,$3,$4,5,600) AS value', [anotherBuyer, 'pass-weekly', randomUUID(), 'cinema-pass-2026-09-26']);
    const sub = `sub_${randomUUID().replaceAll('-', '')}`;
    await q("UPDATE public.cinema_passes SET status='flagged', end_reason='superseded', stripe_subscription_id=$2, stripe_customer_id=$3 WHERE id=$1", [pending.pass_id, sub, `cus_${suffix}`]);
    const pendingOp = await begin(operator, 'refund_pass', pending.pass_id);
    if (disputed) await value('SELECT public.end_cinema_pass($1,$2,$3,$4,$5) AS value', [sub, `evt_${randomUUID().replaceAll('-', '')}`, 'disputed', 'du_test', new Date()]);
    assert.equal((await complete(operator, pendingOp.action_id)).ok, true);
    assert.deepEqual((await q('SELECT status,end_reason FROM public.cinema_passes WHERE id=$1', [pending.pass_id]))[0], { status: 'ended', end_reason: disputed ? 'disputed' : 'refunded' });
  }

  // Frozen/deleted Operators cannot continue even with a still-valid JWT.
  const frozenOperator = await person(true), deletedOperator = await person(true);
  await q("SELECT public.freeze_account(id, 'Operator fixture', NULL) FROM public.users WHERE auth_id=$1", [frozenOperator]);
  assert.equal((await begin(frozenOperator, 'reverse_unlocks', film)).error, 'not_authorized');
  await q('DELETE FROM auth.users WHERE id=$1', [deletedOperator]);
  assert.equal((await begin(deletedOperator, 'reverse_unlocks', film)).error, 'not_authorized');

  // Permission changes take effect even on replay.
  await q('UPDATE public.users SET is_admin=false WHERE auth_id=$1', [operator]);
  assert.equal((await begin(operator, 'refund_pass', second.pass_id, refundKey)).error, 'not_authorized');
  await q('UPDATE public.users SET is_admin=true WHERE auth_id=$1', [operator]);
  // Two connections contend for the same idempotency key: one immutable result.
  const concurrentKey = randomUUID(); const other = new pg.Client({ connectionString: url }); await other.connect();
  try {
    const args = [operator, 'aal2', now(), concurrentKey, 'reverse_unlocks', film, 'Concurrent operation', randomUUID()];
    const stmt = 'SELECT public.begin_cinema_operator_action($1,$2,$3,$4,$5,$6,$7,$8) AS value';
    const results = await Promise.all([c.query(stmt, args), other.query(stmt, args)]);
    assert.deepEqual(results.map(r => r.rows[0].value.idempotent).sort(), [false, true]);
  } finally { await other.end(); }
  for (const table of ['cinema_operator_actions', 'cinema_operator_refund_receipts']) {
    await assert.rejects(q(`UPDATE public.${table} SET request_id=request_id`), /append-only/);
    await assert.rejects(q(`DELETE FROM public.${table}`), /append-only/);
    const flags = (await q('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]))[0];
    assert.ok(flags.relrowsecurity && flags.relforcerowsecurity);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await value('SELECT has_table_privilege($1,$2,$3) AS value', [role, `public.${table}`, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE']), false);
  }
  for (const fn of ['begin_cinema_operator_action(text,text,bigint,uuid,text,uuid,text,uuid)', 'complete_cinema_operator_refund(text,text,bigint,uuid,text,integer,uuid)']) {
    for (const role of ['anon', 'authenticated']) assert.equal(await value('SELECT has_function_privilege($1,$2,$3) AS value', [role, `public.${fn}`, 'EXECUTE']), false);
    assert.equal(await value('SELECT has_function_privilege($1,$2,$3) AS value', ['service_role', `public.${fn}`, 'EXECUTE']), true);
  }
  assert.equal(await value("SELECT has_function_privilege('service_role','public.cinema_operator_actor(text,text,bigint)','EXECUTE') AS value"), false);
  assert.deepEqual(await q('SELECT * FROM public.reconcile_balances()'), []);
  assert.deepEqual(await q('SELECT * FROM public.reconcile_free_credits()'), []);
  console.log('Cinema Operator actions passed: authorization, reversal, retries, webhook race, concurrency, immutable audit, ACLs and reconciliation.');
} finally { await c.end(); }
