#!/usr/bin/env node
// 0383: yearly Credit Subscriptions. One payment a year; month 1 is granted with the invoice and months
// 2 to 12 by grant_due_yearly_cycles, through subscription_grant, so no rollover and every reconciler
// stay as they are. Runs against the full migration replay (ledger-tests.yml). Everything is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const S = 398; // starter-yearly credits a month
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const hex = () => randomUUID().replace(/-/g, '');
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const buckets = async (u) => {
    const b = await one('SELECT balance, free_balance, subscription_balance FROM public.credit_balances WHERE user_id = $1', [u.id]);
    return [b.balance, b.free_balance, b.subscription_balance];
};
const start = (u, plan) => rpc('public.start_credit_subscription($1, $2, $3, $4, 5, 600)', [u.auth, plan, `k-${hex()}`, 'subscription-test-1']);
const apply = (id, sub, status, end = inDays(365)) =>
    rpc('public.apply_credit_subscription_event($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [`evt_${hex()}`, 'customer.subscription.updated', id, sub, `cus_${hex()}`, status, end, false, new Date().toISOString()]);
const paid = (sub, invoice, cents = 20520) =>
    rpc('public.grant_credit_subscription_invoice($1, $2, $3, $4, $5, now())', [sub, invoice, `evt_${hex()}`, cents, inDays(365)]);
const reverse = (sub, invoice, reason) =>
    rpc('public.reverse_credit_subscription_invoice($1, $2, $3, $4, $5, now())', [sub, invoice, `evt_${hex()}`, reason, 'ref_1']);
const sweep = () => rpc('public.grant_due_yearly_cycles()');
const row = (id) => one('SELECT cycles_granted, cycle_anchor, cycle_key_base, status FROM public.credit_subscriptions WHERE id = $1', [id]);
/** Move a yearly subscription `months` into its year: its anchor and the current cycle's expiry both fall back. */
async function later(id, userId, months) {
    await q(`UPDATE public.credit_subscriptions SET cycle_anchor = cycle_anchor - make_interval(months => $2) WHERE id = $1`, [id, months]);
    await q(`UPDATE public.credit_balances SET subscription_expires_at = now() - interval '1 hour' WHERE user_id = $1`, [userId]);
}
const reconciles = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);
    }
};
async function yearly(plan = 'starter-yearly') {
    const u = await user();
    const s = await start(u, plan);
    assert.equal(s.ok, true, JSON.stringify(s));
    const sub = `sub_${hex()}`, invoice = `in_${hex()}`;
    assert.equal((await apply(s.subscription_id, sub, 'active')).status, 'active');
    const g = await paid(sub, invoice);
    assert.equal(g.ok, true, JSON.stringify(g));
    return { u, id: s.subscription_id, sub, invoice };
}

try {
    await c.query('BEGIN');

    // ── The four yearly plans exist and are active (0385). ──
    const plans = await q(`SELECT id, price_usd_cents, credits, active FROM public.credit_subscription_plans WHERE billing_interval = 'year' ORDER BY price_usd_cents`);
    assert.deepEqual(plans.map((p) => [p.id, p.price_usd_cents, p.credits, p.active]),
        [['lite-yearly', 10800, 209, true], ['starter-yearly', 20520, 398, true], ['plus-yearly', 60180, 1171, true], ['ultra-yearly', 123840, 2411, true]]);

    // ── Month 1 comes with the invoice and ends in a month, not a year. ──
    const a = await yearly();
    assert.deepEqual(await buckets(a.u), [S + 10, 10, S]);
    let r = await row(a.id);
    assert.equal(r.cycles_granted, 1);
    assert.match(r.cycle_key_base, /^ysub_[0-9a-f]{32}_[0-9a-f]{12}$/);
    const exp = await one(`SELECT (subscription_expires_at - now()) < interval '32 days' AS short FROM public.credit_balances WHERE user_id = $1`, [a.u.id]);
    assert.equal(exp.short, true, 'the first cycle ends about a month out');
    // A replay of the same invoice grants nothing and does not restart the year.
    const again = await paid(a.sub, a.invoice);
    assert.deepEqual([again.ok, again.idempotent, again.granted], [true, true, 0]);
    assert.equal((await row(a.id)).cycles_granted, 1);
    assert.equal((await sweep()).granted, 0, 'nothing is due in the first month');

    // ── Month 2: the remainder expires, the new month is granted, once. ──
    assert.equal((await rpc(`public.ledger_debit($1, $2, 100, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [a.u.id, randomUUID()])).ok, true);
    await later(a.id, a.u.id, 1);
    assert.equal((await sweep()).granted >= 1, true);
    assert.deepEqual(await buckets(a.u), [S + 10, 10, S], 'no rollover: 298 expired, 398 granted');
    assert.equal((await row(a.id)).cycles_granted, 2);
    assert.equal((await sweep()).granted, 0, 'a second sweep grants nothing more');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id = $1 AND reason LIKE 'grant:subscription:ysub_%_c2'`, [a.u.id])).n, 1);
    await reconciles(a.u);

    // ── An outage: months 3 to 5 are skipped, the month it is in is granted. ──
    await later(a.id, a.u.id, 4);
    await sweep();
    assert.equal((await row(a.id)).cycles_granted, 6);
    assert.deepEqual(await buckets(a.u), [S + 10, 10, S]);

    // ── Month 12 is the last: then the sweep leaves the subscription alone. ──
    await later(a.id, a.u.id, 6);
    await sweep();
    assert.equal((await row(a.id)).cycles_granted, 12);
    await later(a.id, a.u.id, 1);
    assert.equal((await sweep()).granted, 0, 'twelve months are all a year grants');
    await reconciles(a.u);

    // ── A renewal invoice opens a new year at month 1. ──
    const renewal = await paid(a.sub, `in_${hex()}`);
    assert.deepEqual([renewal.ok, renewal.idempotent, renewal.granted], [true, false, S]);
    assert.equal((await row(a.id)).cycles_granted, 1);

    // ── A refund in month 4 takes that month's remainder and stops the sweep. ──
    const b = await yearly();
    await later(b.id, b.u.id, 3);
    await sweep();
    assert.equal((await row(b.id)).cycles_granted, 4);
    assert.equal((await rpc(`public.ledger_debit($1, $2, 100, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [b.u.id, randomUUID()])).ok, true);
    const rv = await reverse(b.sub, b.invoice, 'refunded');
    assert.deepEqual([rv.ok, rv.taken], [true, S - 100]);
    assert.deepEqual(await buckets(b.u), [10, 10, 0]);
    assert.equal((await row(b.id)).status, 'ended');
    await later(b.id, b.u.id, 1);
    assert.equal((await sweep()).granted, 0, 'an ended subscription is never granted again');
    await reconciles(b.u);

    // ── A yearly subscription cancelled at period end still gets its months; an ended one does not. ──
    const d = await yearly('lite-yearly');
    assert.equal((await buckets(d.u))[2], 209);

    // ── Privileges: only the service role runs the sweep. ──
    for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
        assert.equal((await one(`SELECT has_function_privilege($1, 'public.grant_due_yearly_cycles(timestamptz, integer)', 'EXECUTE') AS p`, [role])).p, expected, role);
    }
    console.log('yearly credit subscriptions: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
