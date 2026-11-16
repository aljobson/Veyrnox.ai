// Real Postgres acceptance, called inside test-credit-subscriptions.mjs's transaction after full replay.
// Every fixture is rolled back to the savepoint, including catalog timestamps and legacy snapshots.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function testUltraRetirement(c) {
  const rows = async (sql, args = []) => (await c.query(sql, args)).rows;
  const one = async (sql, args = []) => (await rows(sql, args))[0];
  const rpc = async (sql, args) => (await one(`SELECT ${sql} AS r`, args)).r;
  const hex = () => randomUUID().replaceAll('-', '');
  await c.query('SAVEPOINT ultra_retirement');
  try {
    const cutoff = '2020-01-02T00:00:00.000Z';
    const before = '2020-01-01T23:59:59.999Z';
    const after = '2020-01-02T00:00:00.001Z';
    // 0549 is held outside the migrations folder (ADR-0346): run it here, inside the savepoint, as the later release will.
    const held = readFileSync('docs/operations/0549_retire_ultra_plans.sql', 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await c.query(held);
    await c.query("UPDATE public.credit_subscription_plans SET retired_at = $1 WHERE id IN ('ultra-monthly','ultra-yearly') AND NOT active", [cutoff]);
    assert.deepEqual((await rpc('public.list_credit_subscription_plans()')).map((p) => p.id),
      ['lite-monthly', 'starter-monthly', 'plus-monthly', 'lite-yearly', 'starter-yearly', 'plus-yearly'], 'the public catalogue is the six Lite/Starter/Plus plans once 0549 runs');
    const ultra = await one("SELECT active, credits FROM public.credit_subscription_plans WHERE id = 'ultra-monthly'");
    assert.deepEqual(ultra, { active: false, credits: 2011 });
    let tick = 0; // every event carries a strictly newer period end, as the credit-cycle guard requires (PERIOD_NOT_NEWER)
    const nextEnd = () => new Date(Date.now() + (30 + ++tick) * 86400000).toISOString();
    async function customer() {
      const auth = randomUUID();
      await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1,$2,now())', [auth, `${auth}@example.invalid`]);
      const { id } = await one('SELECT id FROM public.users WHERE auth_id=$1', [auth]);
      const rc = randomUUID();
      await c.query('INSERT INTO public.store_customers(user_id, rc_customer_id) VALUES ($1,$2)', [id, rc]);
      return { auth, id, rc, transaction: hex() };
    }
    async function event(u, { plan = 'ultra.monthly', purchased = null, type = 'initial_purchase', action = 'activate', eventId = `retire_${hex()}`, channel = 'ios' } = {}) {
      return rpc('public.apply_store_generation_event($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)',
        [u.rc, channel, `ai.veyrnox.generation.${plan}`, u.transaction, eventId, action, type, nextEnd(), purchased]);
    }
    async function subscription(u) {
      return one('SELECT plan_id, price_usd_cents, credits, status FROM public.credit_subscriptions WHERE store_original_transaction_id=$1', [u.transaction]);
    }
    for (const purchased of [null, cutoff, after]) {
      const u = await customer();
      assert.equal((await event(u, { purchased })).code, 'PLAN_NOT_FOUND');
      assert.equal(await subscription(u), undefined);
      const start = await rpc('public.start_credit_subscription($1,$2,$3,$4,5,600)', [u.auth, 'ultra-monthly', `ultra_${hex()}`, 'acceptance']);
      assert.equal(start.code, 'PLAN_NOT_FOUND');
      const annual = await rpc('public.start_credit_subscription($1,$2,$3,$4,5,600)', [u.auth, 'ultra-yearly', `ultra_${hex()}`, 'acceptance']);
      assert.equal(annual.code, 'PLAN_NOT_FOUND');
    }
    const delayed = await customer(), eventId = `retire_${hex()}`;
    assert.equal((await event(delayed, { purchased: before, eventId })).granted, 2011);
    const duplicate = await event(delayed, { purchased: before, eventId });
    assert.equal(duplicate.idempotent, true); assert.equal(duplicate.granted, 0);
    assert.equal((await event(delayed, { type: 'renewal', purchased: after })).granted, 2011);
    // A real preexisting snapshot may differ from today's catalog: retain BOTH monetary columns.
    await c.query('UPDATE public.credit_subscriptions SET credits=2411, price_usd_cents=12800 WHERE store_original_transaction_id=$1', [delayed.transaction]);
    assert.equal((await event(delayed, { type: 'renewal' })).granted, 2411);
    assert.deepEqual(await subscription(delayed), { plan_id: 'ultra-monthly', price_usd_cents: 12800, credits: 2411, status: 'active' });
    assert.equal((await event(delayed, { type: 'cancellation', action: 'cancel_at_period_end' })).ok, true);
    assert.equal((await event(delayed, { type: 'uncancellation' })).ok, true);
    assert.equal((await subscription(delayed)).credits, 2411);
    assert.equal((await event(delayed, { plan: 'unmapped.monthly', type: 'renewal' })).code, 'PLAN_NOT_FOUND');
    // Switching away takes the target snapshot; active tier and interval changes keep working.
    assert.equal((await event(delayed, { plan: 'starter.monthly', type: 'product_change' })).ok, true);
    assert.deepEqual(await subscription(delayed), { plan_id: 'starter-monthly', price_usd_cents: 1900, credits: 297, status: 'active' });
    assert.equal((await event(delayed, { plan: 'plus.annual', type: 'product_change' })).ok, true);
    assert.deepEqual(await subscription(delayed), { plan_id: 'plus-yearly', price_usd_cents: 56900, credits: 924, status: 'active' });
    for (const purchased of [null, cutoff, after]) assert.equal((await event(delayed, { type: 'renewal', purchased })).code, 'PLAN_NOT_FOUND');
    assert.equal((await event(delayed, { type: 'product_change', purchased: before })).code, 'PLAN_NOT_FOUND', 'scheduled changes never prove payment');
    // Effective Starter -> Ultra transitions bought before retirement and delivered later.
    for (const type of ['initial_purchase', 'renewal']) {
      const u = await customer();
      assert.equal((await event(u, { plan: 'starter.monthly' })).granted, 297);
      assert.equal((await event(u, { type, purchased: before })).granted, 2011);
      assert.equal((await subscription(u)).plan_id, 'ultra-monthly');
      assert.equal((await event(u, { type: 'renewal', purchased: after })).granted, 2011);
      assert.equal((await event(u, { type: 'cancellation', action: 'refund' })).ok, true);
      assert.equal((await subscription(u)).status, 'ended');
      // A lapsed Ultra subscriber who resubscribes after the cutoff is a NEW purchase: refused.
      for (const t of ['initial_purchase', 'renewal']) assert.equal((await event(u, { type: t, purchased: after })).code, 'PLAN_NOT_FOUND');
      assert.equal((await subscription(u)).status, 'ended');
      for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_subscription_credits']) {
        assert.deepEqual(await rows(`SELECT * FROM public.${fn}() WHERE user_id=$1`, [u.id]), []);
      }
    }
    // Android annual legacy ownership uses the retained qualified mapping and monthly credit grants.
    const yearly = await customer();
    assert.equal((await event(yearly, { plan: 'ultra.annual:annual', channel: 'android', purchased: before })).granted, 2011);
    const own = await rpc('public.read_own_credit_subscription($1)', [yearly.auth]);
    assert.equal(own.subscription.billing_interval, 'year');
    assert.equal(own.subscription.price_usd_cents, 123840);
    console.log('Ultra retirement: delayed purchases, snapshot renewals, tier/interval transitions, refusal, refunds and reconciliation passed');
  } finally {
    await c.query('ROLLBACK TO SAVEPOINT ultra_retirement');
    await c.query('RELEASE SAVEPOINT ultra_retirement');
  }
}
