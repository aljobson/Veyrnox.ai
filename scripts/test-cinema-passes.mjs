// Disposable local Postgres only. No production credentials or fixtures.
// Exercises migration 0143 (ADR-0057 Phase 2): Cinema Pass lifecycle,
// entitlement, intro once per account, one live Pass, refund/dispute endings,
// and that no Pass path ever touches the ledger.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const CONSENT = 'cinema-pass-2026-09-26';
const draft = (patch = {}) => ({ content_type: 'SERIES', parent_id: null, position: null, title: 'Pass story', synopsis: 'Episodes', language: 'en', ai_disclosures: [], ...patch });
const save = (actor, body) => value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [actor, randomUUID(), null, 0, body]).then((r) => { assert.ok(r.id, JSON.stringify(r)); return r.id; });
const start = (actor, plan, key = randomUUID(), consent = CONSENT) => value('SELECT public.start_cinema_pass($1,$2,$3,$4,5,600) AS value', [actor, plan, key, consent]);
const apply = (evt, sub, passId, status, over = {}) => value('SELECT public.apply_cinema_pass_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value', [
  evt, over.type ?? 'customer.subscription.updated', passId, sub, over.customer ?? 'cus_1', status,
  over.periodEnd === undefined ? new Date(Date.now() + 6 * 86400000).toISOString() : over.periodEnd, over.cancel ?? false, over.at ?? new Date().toISOString()]);
const end = (sub, evt, reason, at = new Date().toISOString()) => value('SELECT public.end_cinema_pass($1,$2,$3,$4,$5) AS value', [sub, evt, reason, 'du_test', at]);
const entitlement = (actor, content) => value('SELECT public.cinema_entitlement($1,$2) AS value', [actor, content]);
const own = (actor) => value('SELECT public.read_own_cinema_pass($1) AS value', [actor]).then((r) => r.pass);
const ledgerRows = () => value("SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'");
const balances = () => q('SELECT user_id, balance, free_balance FROM public.credit_balances ORDER BY user_id');
async function person() {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  return actor;
}
try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0143_cinema_passes.sql', import.meta.url), 'utf8');
  await c.query(migration); await c.query(migration);
  const plans = await value('SELECT public.list_cinema_pass_plans() AS value');
  assert.deepEqual(plans.map((p) => [p.id, p.billing_interval, p.price_usd_cents, p.intro_price_usd_cents]),
    [['pass-weekly', 'week', 1499, 1199], ['pass-monthly', 'month', 4999, null], ['pass-yearly', 'year', 19999, null]]);

  // A published locked episode to be entitled to.
  const creator = await person();
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [creator, randomUUID(), { username: `p_${creator.replaceAll('-', '').slice(0, 20)}`, display_name: 'Creator' }]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [creator]);
  const series = await save(creator, draft());
  const season = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const locked = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 9 }));
  const locked2 = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 10 }));
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=ANY($1::uuid[])", [[series, season, locked, locked2]]);

  const ledgerBefore = await ledgerRows(), balancesBefore = await balances();
  const alice = await person(), bob = await person(), carol = await person();

  // Start: pending row, intro decided by the database, idempotent on the key.
  const key = randomUUID();
  const a1 = await start(alice, 'pass-weekly', key);
  assert.deepEqual([a1.ok, a1.status, a1.billing_interval, a1.price_usd_cents, a1.intro_price_usd_cents, a1.idempotent], [true, 'pending', 'week', 1499, 1199, false]);
  const replay = await start(alice, 'pass-weekly', key);
  assert.deepEqual([replay.idempotent, replay.pass_id], [true, a1.pass_id]);
  assert.equal((await start(alice, 'pass-monthly', key)).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await start(alice, 'no-such-plan')).code, 'PLAN_NOT_FOUND');
  assert.equal((await start(alice, 'pass-weekly', randomUUID(), null)).code, 'CONSENT_VERSION_REQUIRED');
  assert.equal((await start('invalid', 'pass-weekly')).code, 'USER_NOT_FOUND');
  assert.equal((await start(randomUUID(), 'pass-weekly')).code, 'USER_NOT_FOUND');
  assert.deepEqual(await entitlement(alice, locked), { access: 'locked', credits: 6 });

  // Return recording and the first Stripe event bind the subscription and activate.
  assert.equal((await value('SELECT public.record_cinema_pass_session($1,$2,$3) AS value', [alice, a1.pass_id, 'cs_test_a1'])).ok, true);
  assert.equal((await value('SELECT public.record_cinema_pass_session($1,$2,$3) AS value', [bob, a1.pass_id, 'cs_test_a1'])).code, 'PASS_NOT_FOUND');
  // A wrong hint on a pending Pass may be replaced; once bound it is fixed.
  assert.equal((await value('SELECT public.record_cinema_pass_session($1,$2,$3) AS value', [alice, a1.pass_id, 'cs_test_typo'])).ok, true);
  assert.equal((await value('SELECT public.record_cinema_pass_session($1,$2,$3) AS value', [alice, a1.pass_id, 'cs_test_a1'])).ok, true);
  const t0 = new Date(Date.now() - 60000).toISOString();
  const act = await apply('evt_a1', 'sub_a1', a1.pass_id, 'active', { at: t0 });
  assert.deepEqual([act.ok, act.status, act.flagged, act.stale], [true, 'active', false, false]);
  assert.equal((await value('SELECT public.record_cinema_pass_session($1,$2,$3) AS value', [alice, a1.pass_id, 'cs_test_other'])).code, 'SESSION_MISMATCH');
  assert.deepEqual(await entitlement(alice, locked), { access: 'pass', credits: 0 });
  assert.deepEqual(await entitlement(bob, locked), { access: 'locked', credits: 6 });
  assert.deepEqual((await apply('evt_a1', 'sub_a1', null, 'ended')), { ok: true, idempotent: true, pass_id: a1.pass_id, status: 'active', flagged: false });
  assert.equal((await own(alice)).status, 'active');
  assert.equal((await own(alice)).stripe_subscription_id, 'sub_a1');

  // Binding rules: a subscription bound to one Pass cannot be re-pointed; an unsigned unknown one is refused.
  assert.equal((await apply('evt_x1', 'sub_a1', randomUUID(), 'active')).code, 'PASS_MISMATCH');
  assert.equal((await apply('evt_x2', 'sub_unknown', null, 'active')).code, 'PASS_NOT_FOUND');
  assert.equal((await apply('evt_x3', 'sub_unknown', a1.pass_id, 'active')).code, 'PASS_NOT_FOUND', 'an already bound Pass is not re-bound');
  assert.equal((await apply('bad id', 'sub_a1', null, 'active')).code, 'INVALID_EVENT');
  assert.equal((await apply('evt_x4', 'sub_a1', null, 'weird')).code, 'INVALID_EVENT');

  // Ordering: an older event cannot regress; a newer past_due keeps entitlement; period end in the past ends it.
  const stale = await apply('evt_old', 'sub_a1', null, 'ended', { at: new Date(Date.parse(t0) - 1000).toISOString() });
  assert.deepEqual([stale.stale, stale.status], [true, 'active']);
  const due = await apply('evt_due', 'sub_a1', null, 'past_due', { at: new Date().toISOString() });
  assert.equal(due.status, 'past_due');
  assert.deepEqual(await entitlement(alice, locked), { access: 'pass', credits: 0 });
  await apply('evt_exp', 'sub_a1', null, 'past_due', { periodEnd: new Date(Date.now() - 1000).toISOString(), at: new Date().toISOString() });
  assert.deepEqual(await entitlement(alice, locked), { access: 'locked', credits: 6 }, 'a lapsed period does not entitle');
  await apply('evt_ren', 'sub_a1', null, 'active', { at: new Date().toISOString() });
  assert.deepEqual(await entitlement(alice, locked), { access: 'pass', credits: 0 });

  // A permanent Unlock wins over a Pass, and unlocking still works for a Pass holder.
  const un = await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [alice, locked2, 'unlock-2026-09-26']);
  assert.equal(un.access, 'unlocked');
  assert.deepEqual(await entitlement(alice, locked2), { access: 'unlocked', credits: 0 });
  const ledgerAfterUnlock = await ledgerRows();
  assert.equal(ledgerAfterUnlock, ledgerBefore + 1, 'only the Unlock wrote a ledger row');

  // One live Pass: a new start is refused; a pending Pass that pays anyway is flagged, never entitled.
  assert.equal((await start(alice, 'pass-monthly')).code, 'PASS_ALREADY_ACTIVE');
  const pendingBefore = await start(bob, 'pass-weekly');
  const b2 = await start(bob, 'pass-monthly');
  assert.equal(b2.intro_price_usd_cents, null, 'monthly has no intro');
  assert.equal((await apply('evt_b1', 'sub_b1', pendingBefore.pass_id, 'active')).status, 'active');
  const flagged = await apply('evt_b2', 'sub_b2', b2.pass_id, 'active');
  assert.deepEqual([flagged.status, flagged.flagged], ['flagged', true]);
  assert.equal((await q('SELECT end_reason FROM public.cinema_passes WHERE id=$1', [b2.pass_id]))[0].end_reason, 'superseded');
  assert.deepEqual(await entitlement(bob, locked), { access: 'pass', credits: 0 });
  const b3 = await apply('evt_b3', 'sub_b2', null, 'active');
  assert.deepEqual([b3.stale, b3.flagged], [true, true], 'a flagged Pass is terminal and keeps reporting flagged');
  assert.equal((await apply('evt_b2', 'sub_b2', null, 'active')).flagged, true, 'so does a replayed event');

  // The intro is once per account: burned by a paid Pass, not by an abandoned checkout.
  await end('sub_b1', 'evt_b1_refund', 'refunded');
  assert.deepEqual(await entitlement(bob, locked), { access: 'locked', credits: 6 });
  const bobAgain = await start(bob, 'pass-weekly');
  assert.equal(bobAgain.intro_price_usd_cents, null, 'intro already used');
  const carolAbandoned = await start(carol, 'pass-weekly');
  assert.equal(carolAbandoned.intro_price_usd_cents, 1199);
  const carolAgain = await start(carol, 'pass-weekly');
  assert.equal(carolAgain.intro_price_usd_cents, 1199, 'an unpaid checkout keeps the intro');

  // Endings: refund ends; dispute ends and Freezes; both idempotent on the event; an ended Pass keeps its first reason.
  assert.deepEqual(await end('sub_b1', 'evt_b1_refund', 'refunded'), { ok: true, idempotent: true });
  assert.equal((await q('SELECT end_reason, status FROM public.cinema_passes WHERE stripe_subscription_id=$1', ['sub_b1']))[0].end_reason, 'refunded');
  assert.equal((await end('sub_nope', 'evt_z', 'refunded')).code, 'PASS_NOT_FOUND');
  assert.equal((await end('sub_a1', 'evt_z2', 'chargeback')).code, 'INVALID_EVENT');
  const disputed = await end('sub_a1', 'evt_a1_dispute', 'disputed');
  assert.deepEqual([disputed.ok, disputed.frozen], [true, true]);
  assert.equal(await value('SELECT (frozen_at IS NOT NULL) AS value FROM public.users WHERE auth_id=$1', [alice]), true);
  assert.deepEqual(await entitlement(alice, locked), { access: 'locked', credits: 6 });
  assert.deepEqual(await entitlement(alice, locked2), { access: 'unlocked', credits: 0 }, 'a permanent Unlock survives');
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [alice, locked, 'unlock-2026-09-26'])).error, 'account_frozen');
  assert.equal((await apply('evt_a1_after', 'sub_a1', null, 'active')).stale, true, 'ended is terminal');
  assert.equal((await start(alice, 'pass-weekly')).code, 'ACCOUNT_FROZEN');
  assert.equal(await value("SELECT count(*)::int AS value FROM public.account_actions WHERE action='freeze' AND reason LIKE 'Stripe dispute%sub_a1%'"), 1);

  // Cancellation marks: cooling-off ends now; period-end only stops renewal; only the owner, only a live Pass.
  const dave = await person();
  const d1 = await start(dave, 'pass-yearly');
  await apply('evt_d1', 'sub_d1', d1.pass_id, 'active');
  assert.equal((await value('SELECT public.mark_cinema_pass_cancelled($1,$2,$3) AS value', [alice, d1.pass_id, 'period_end'])).code, 'PASS_NOT_FOUND');
  assert.equal((await value('SELECT public.mark_cinema_pass_cancelled($1,$2,$3) AS value', [dave, d1.pass_id, 'later'])).code, 'INVALID_MODE');
  assert.equal((await value('SELECT public.mark_cinema_pass_cancelled($1,$2,$3) AS value', [dave, d1.pass_id, 'period_end'])).ok, true);
  assert.equal((await own(dave)).cancel_at_period_end, true);
  assert.deepEqual(await entitlement(dave, locked), { access: 'pass', credits: 0 }, 'still entitled until the period end');
  assert.equal((await value('SELECT public.mark_cinema_pass_cancelled($1,$2,$3) AS value', [dave, d1.pass_id, 'cooling_off'])).status, 'ended');
  assert.equal((await own(dave)).end_reason, 'cancelled_cooling_off');
  assert.equal((await value('SELECT public.mark_cinema_pass_cancelled($1,$2,$3) AS value', [dave, d1.pass_id, 'period_end'])).code, 'PASS_NOT_LIVE');
  assert.deepEqual(await entitlement(dave, locked), { access: 'locked', credits: 6 });

  // Own read prefers the live Pass; deleted Auth identity is refused.
  const erin = await person();
  assert.equal(await own(erin), null);
  await q('DELETE FROM auth.users WHERE id=$1', [erin]);
  assert.equal((await value('SELECT public.read_own_cinema_pass($1) AS value', [erin])).code, 'USER_NOT_FOUND');
  assert.equal((await start(erin, 'pass-weekly')).code, 'USER_NOT_FOUND');

  // Rate limit on starts: five per ten minutes.
  const frank = await person();
  for (let i = 0; i < 5; i++) assert.equal((await start(frank, 'pass-weekly')).ok, true, `start ${i}`);
  assert.equal((await start(frank, 'pass-weekly')).code, 'RATE_LIMITED');

  // Money invariants: the Pass paths wrote nothing to the ledger; balances only moved for the one Unlock.
  assert.equal(await ledgerRows(), ledgerBefore + 1);
  const balancesAfter = await balances();
  assert.equal(balancesAfter.length, balancesBefore.length + 6);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_balances()'), 0);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_free_credits()'), 0);

  // Append-only events, restricted deletes, grants.
  await assert.rejects(q("UPDATE public.cinema_pass_events SET status='x'"), /append-only/);
  await assert.rejects(q('DELETE FROM public.cinema_pass_events'), /append-only/);
  await assert.rejects(q('DELETE FROM public.cinema_passes WHERE id=$1', [a1.pass_id]));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['cinema_pass_plans', 'cinema_passes', 'cinema_pass_events']) {
      assert.equal(await value(`SELECT has_table_privilege($1, 'public.${table}', 'SELECT') AS value`, [role]), false, `${role} ${table}`);
    }
    const allowed = role === 'service_role';
    for (const fn of ['public.start_cinema_pass(text,text,text,text,integer,integer)', 'public.apply_cinema_pass_event(text,text,uuid,text,text,text,timestamptz,boolean,timestamptz)',
      'public.end_cinema_pass(text,text,text,text,timestamptz)', 'public.read_own_cinema_pass(text)', 'public.mark_cinema_pass_cancelled(text,uuid,text)', 'public.list_cinema_pass_plans()', 'public.cinema_entitlement(text,uuid)']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), allowed, `${role} ${fn}`);
    }
  }
  await q('BEGIN'); await q('SET LOCAL ROLE service_role');
  assert.equal((await start(carol, 'pass-monthly')).ok, true);
  await q('ROLLBACK');
  console.log('Cinema pass checks passed: plans, start/replay, binding, ordering, entitlement precedence, one live pass, intro once, refund/dispute endings, cancellation marks, rate limit, ledger untouched and grants.');
} finally { await c.end(); }
