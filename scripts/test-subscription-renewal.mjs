#!/usr/bin/env node
// Local database acceptance, not a Stripe test-clock delivery test.
// Advance the existing expiry RPC's p_as_of; never relax production time checks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must name a throwaway local test database');
const target = new URL(url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) {
  throw new Error('Renewal tests refuse remote databases and non-test database names');
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const key = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const end = (days) => new Date(Date.now() + days * 86400000).toISOString();

try {
  await c.query('BEGIN');
  const plans = await rpc('public.list_credit_subscription_plans()');
  assert.equal(plans.length, 3);
  for (const plan of plans) {
    await c.query('SAVEPOINT tier');
    const auth = randomUUID();
    await c.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',
      [auth, `${auth}@example.invalid`]);
    const u = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
    assert.equal((await rpc("public.ledger_grant($1,28,'grant:renewal_test')", [u])).ok, true);
    const start = await rpc('public.start_credit_subscription($1,$2,$3,$4,5,600)',
      [auth, plan.id, key('start'), 'renewal-test']);
    assert.equal(start.ok, true);
    const sub = key('sub'), customer = key('cus');
    const state = (status, type = 'customer.subscription.updated') =>
      rpc('public.apply_credit_subscription_event($1,$2,$3,$4,$5,$6,$7,false,now())',
        [key('evt'), type, start.subscription_id, sub, customer, status, end(30)]);
    const paid = (invoice, event, days, cents = plan.price_usd_cents) =>
      rpc('public.grant_credit_subscription_invoice($1,$2,$3,$4,$5,now())',
        [sub, invoice, event, cents, end(days)]);
    const balance = () => one('SELECT balance,subscription_balance FROM public.credit_balances WHERE user_id=$1', [u]);
    assert.equal((await state('active', 'customer.subscription.created')).ok, true);
    assert.equal((await paid(key('in'), key('evt'), 30)).granted, plan.credits);
    const debit = await rpc("public.ledger_debit($1,$2,7,'debit:generation','seedance-2.0-fast','{}'::jsonb)", [u, randomUUID()]);
    assert.equal(debit.ok, true);

    const renewalInvoice = key('in'), renewalEvent = key('evt');
    const renewed = await paid(renewalInvoice, renewalEvent, 60);
    assert.equal(renewed.expired, plan.credits - 7, 'old remainder expires rather than rolling over');
    assert.equal(renewed.granted, plan.credits);
    assert.deepEqual(await balance(), { balance: 38 + plan.credits, subscription_balance: plan.credits });
    assert.equal((await paid(renewalInvoice, renewalEvent, 60)).granted, 0);
    assert.equal((await paid(renewalInvoice, key('evt'), 60)).granted, 0);

    assert.equal((await state('past_due', 'invoice.payment_failed')).status, 'past_due');
    const failedInvoice = key('in'), failedEvent = key('evt');
    assert.equal((await paid(failedInvoice, failedEvent, 90, 0)).code, 'INVOICE_NOT_PAID');
    assert.deepEqual(await balance(), { balance: 38 + plan.credits, subscription_balance: plan.credits },
      'failure does not grant a new cycle or remove a still-paid cycle');
    await rpc('public.expire_subscription_credits($1,500)', [end(61)]);
    assert.deepEqual(await balance(), { balance: 38, subscription_balance: 0 }, 'no grace credits after the paid end');
    assert.equal((await rpc('public.read_user_balance($1)', [auth])), 38);
    const repeat = await rpc('public.expire_subscription_credits($1,500)', [end(61)]);
    assert.equal(repeat.expired_credits, 0);

    // A genuinely paid retry has a separate Stripe event; the refused event stays refused.
    assert.equal((await paid(failedInvoice, failedEvent, 90)).code, 'INVOICE_NOT_PAID');
    assert.equal((await paid(failedInvoice, key('evt'), 90)).granted, plan.credits);
    assert.deepEqual(await balance(), { balance: 38 + plan.credits, subscription_balance: plan.credits });
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_top_ups',
      'reconcile_failed_refunds', 'reconcile_subscription_credits']) {
      assert.deepEqual((await c.query(`SELECT * FROM public.${fn}()`)).rows, [], fn);
    }
    console.log(`${plan.id}: renewal expires remainder, replay grants once, failed renewal has no grace, paid recovery succeeds; zero drift`);
    await c.query('ROLLBACK TO SAVEPOINT tier');
  }
} finally {
  await c.query('ROLLBACK').catch(() => {});
  await c.end();
}
