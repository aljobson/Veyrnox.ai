#!/usr/bin/env node
// 0186/0187 (ADR-0064, IMPLEMENTATION-PLAN C4): the Subscription and the
// functions that join it to the ledger. Runs against the full migration
// replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const hex = () => randomUUID().replace(/-/g, '');
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const buckets = async (u) => {
    const b = await one('SELECT balance, free_balance, subscription_balance FROM public.credit_balances WHERE user_id = $1', [u.id]);
    return [b.balance, b.free_balance, b.subscription_balance];
};
const start = (u, plan = 'starter-monthly', key = `k-${hex()}`, limit = 5) =>
    rpc('public.start_credit_subscription($1, $2, $3, $4, $5, 600)', [u.auth, plan, key, 'subscription-test-1', limit]);
const apply = (id, sub, status, { at = new Date().toISOString(), end = inDays(30), type = 'customer.subscription.updated', cancel = false } = {}) =>
    rpc('public.apply_credit_subscription_event($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [`evt_${hex()}`, type, id, sub, `cus_${hex()}`, status, end, cancel, at]);
const paid = (sub, invoice, { event = `evt_${hex()}`, cents = 1900, end = inDays(30) } = {}) =>
    rpc('public.grant_credit_subscription_invoice($1, $2, $3, $4, $5, now())', [sub, invoice, event, cents, end]);
const reverse = (sub, invoice, reason, event = `evt_${hex()}`) =>
    rpc('public.reverse_credit_subscription_invoice($1, $2, $3, $4, $5, now())', [sub, invoice, event, reason, 'ref_1']);
const debit = (u, credits) => rpc(`public.ledger_debit($1, $2, $3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [u.id, randomUUID(), credits]);
const refund = (u, job, credits) => rpc(`public.ledger_refund($1, $2, $3, 'refund:provider_failed')`, [job, u.id, credits]);
const reconciles = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);
    }
};
/** A user with a live Starter subscription and its first invoice paid. */
async function subscribed(plan = 'starter-monthly') {
    const u = await user();
    const s = await start(u, plan);
    const sub = `sub_${hex()}`;
    const invoice = `in_${hex()}`;
    assert.equal((await apply(s.subscription_id, sub, 'active')).status, 'active');
    const g = await paid(sub, invoice);
    assert.equal(g.ok, true, JSON.stringify(g));
    return { u, id: s.subscription_id, sub, invoice, credits: s.credits };
}

try {
    // Both migrations are safe to apply twice.
    for (const f of ['0186_credit_subscriptions.sql', '0187_credit_subscription_money.sql', '0188_credit_subscription_webhooks.sql']) {
        const sql = await readFile(new URL(`../packages/db/schema/supabase/${f}`, import.meta.url), 'utf8');
        await c.query('BEGIN'); await c.query(sql); await c.query(sql); await c.query('ROLLBACK');
    }

    await c.query('BEGIN');

    // ── Plans: the three accepted tiers, cheapest first. ──
    assert.deepEqual((await rpc('public.list_credit_subscription_plans()')).map((p) => [p.id, p.price_usd_cents, p.credits]),
        [['starter-monthly', 1900, 270], ['plus-monthly', 5900, 1200], ['ultra-monthly', 12900, 3000]]);

    // ── Start: idempotent on its key; the key cannot be moved to another plan. ──
    const a = await user();
    const k = `k-${hex()}`;
    const s1 = await start(a, 'starter-monthly', k);
    assert.deepEqual([s1.ok, s1.idempotent, s1.status, s1.price_usd_cents, s1.credits], [true, false, 'pending', 1900, 270]);
    const s1again = await start(a, 'starter-monthly', k);
    assert.deepEqual([s1again.idempotent, s1again.subscription_id], [true, s1.subscription_id]);
    assert.equal((await start(a, 'plus-monthly', k)).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await start(a, 'no-such-plan')).code, 'PLAN_NOT_FOUND');
    assert.equal((await start(a, 'starter-monthly', 'short')).code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await start(a, 'starter-monthly', `k-${hex()}`, 1)).code, 'RATE_LIMITED');
    assert.equal((await start({ auth: randomUUID() })).code, 'USER_NOT_FOUND');
    // A pending checkout grants nothing.
    assert.deepEqual(await buckets(a), [10, 10, 0]);

    // ── An invoice ahead of its binding is not recorded, so Stripe's retry works. ──
    const subA = `sub_${hex()}`;
    const inA = `in_${hex()}`;
    const early = `evt_${hex()}`;
    assert.equal((await paid(subA, inA, { event: early })).code, 'SUBSCRIPTION_NOT_FOUND');
    assert.equal((await apply(s1.subscription_id, subA, 'incomplete')).status, 'pending');
    assert.equal((await paid(subA, inA, { event: early })).code, 'SUBSCRIPTION_NOT_READY');
    assert.equal((await one('SELECT count(*)::int AS n FROM public.credit_subscription_events WHERE stripe_event_id = $1', [early])).n, 0);

    // ── Active, then the paid invoice grants the cycle, once. ──
    assert.equal((await apply(null, subA, 'active')).status, 'active');
    assert.deepEqual(await buckets(a), [10, 10, 0], 'activation alone grants nothing');
    const g1 = await paid(subA, inA, { event: early });
    assert.deepEqual([g1.ok, g1.idempotent, g1.granted, g1.balance_after], [true, false, 270, 280]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    const g1replay = await paid(subA, inA, { event: early });
    assert.deepEqual([g1replay.ok, g1replay.idempotent, g1replay.granted], [true, true, 0]);
    // A second event for the same invoice (Stripe sends more than one) grants nothing more.
    const g1other = await paid(subA, inA);
    assert.deepEqual([g1other.ok, g1other.idempotent, g1other.granted], [true, true, 0]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    assert.equal((await start(a)).code, 'SUBSCRIPTION_ALREADY_ACTIVE');

    // Webhooks read the durable binding without gaining raw table access.
    const binding = await rpc('public.read_credit_subscription_binding($1)', [subA]);
    assert.deepEqual([binding.id, binding.plan_id, binding.price_usd_cents, binding.credits, binding.status],
        [s1.subscription_id, 'starter-monthly', 1900, 270, 'active']);
    assert.equal(binding.stripe_subscription_id, subA);
    assert.equal((await rpc('public.read_own_credit_subscription_by_id($1,$2)', [a.auth, s1.subscription_id])).subscription.id, s1.subscription_id);
    assert.equal(await rpc('public.read_own_credit_subscription_by_id($1,$2)', [randomUUID(), s1.subscription_id]), null);
    assert.equal(await rpc('public.read_own_credit_subscription_by_id($1,$2)', [a.auth, randomUUID()]), null);
    assert.equal(await rpc('public.read_credit_subscription_binding($1)', ['sub_unknown']), null);
    assert.equal(await rpc('public.read_credit_subscription_binding($1)', [null]), null);
    assert.equal((await one("SELECT has_function_privilege('service_role', 'public.read_credit_subscription_binding(text)', 'EXECUTE') AS p")).p, true);
    assert.equal((await one("SELECT has_table_privilege('service_role', 'public.credit_subscriptions', 'SELECT') AS p")).p, false);
    await c.query('SET LOCAL ROLE service_role');
    assert.equal((await rpc('public.read_credit_subscription_binding($1)', [subA])).id, s1.subscription_id);
    await c.query('RESET ROLE');

    // ── Renewal: the leftover expires, the new cycle is granted (no rollover). ──
    assert.equal((await debit(a, 100)).ok, true);
    assert.deepEqual(await buckets(a), [180, 10, 170]);
    const g2 = await paid(subA, `in_${hex()}`, { end: inDays(60) });
    assert.deepEqual([g2.ok, g2.granted, g2.expired], [true, 270, 170]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);

    // ── An invoice the ledger refuses is recorded for an Operator, and stays refused. ──
    const refusedEvent = `evt_${hex()}`;
    const r1 = await paid(subA, `in_${hex()}`, { event: refusedEvent, end: inDays(45) });
    assert.deepEqual([r1.ok, r1.code, r1.refused], [false, 'PERIOD_NOT_NEWER', true]);
    const r1again = await paid(subA, `in_${hex()}`, { event: refusedEvent, end: inDays(90) });
    assert.deepEqual([r1again.ok, r1again.code, r1again.refused, r1again.idempotent], [false, 'PERIOD_NOT_NEWER', true, true]);
    assert.equal((await paid(subA, `in_${hex()}`, { cents: 0, end: inDays(90) })).code, 'INVOICE_NOT_PAID');
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    assert.equal((await paid(subA, 'not-an-invoice')).code, 'INVALID_INVOICE');

    // ── Cancel at period end: it stops renewing, the credits stay. ──
    const cancel = await rpc('public.mark_credit_subscription_cancelled($1, $2)', [a.auth, s1.subscription_id]);
    assert.equal(cancel.ok, true);
    const read = (await rpc('public.read_own_credit_subscription($1)', [a.auth])).subscription;
    assert.deepEqual([read.status, read.cancel_at_period_end, read.credits, read.stripe_subscription_id], ['active', true, 270, subA]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    assert.equal((await rpc('public.mark_credit_subscription_cancelled($1, $2)', [(await user()).auth, s1.subscription_id])).code, 'SUBSCRIPTION_NOT_FOUND');
    // Ended at Stripe: terminal, and a late invoice for it is refused.
    assert.equal((await apply(null, subA, 'ended', { type: 'customer.subscription.deleted' })).status, 'ended');
    assert.equal((await apply(null, subA, 'active')).stale, true);
    assert.equal((await paid(subA, `in_${hex()}`, { end: inDays(120) })).code, 'SUBSCRIPTION_NOT_LIVE');
    await reconciles(a);

    // ── An older event cannot regress a newer state. ──
    const o = await subscribed();
    await apply(null, o.sub, 'past_due', { at: new Date().toISOString() });
    const stale = await apply(null, o.sub, 'active', { at: ago(60) });
    assert.deepEqual([stale.stale, stale.status], [true, 'past_due']);

    // 'incomplete' never takes a live row back to pending, even with the same
    // or a later timestamp: a new subscription's created and updated events
    // can share a second, and a pending row would allow a second checkout.
    const regress = await apply(null, o.sub, 'incomplete');
    assert.deepEqual([regress.stale, regress.status], [true, 'past_due']);
    assert.equal((await start(o.u)).code, 'SUBSCRIPTION_ALREADY_ACTIVE');
    // An event dated in the future is refused: it would make every later one stale.
    assert.equal((await apply(null, o.sub, 'active', { at: inDays(1) })).code, 'INVALID_EVENT');

    // The second of two first events finds the row the first one bound.
    const twin = await user();
    const ts = await start(twin);
    const twinSub = `sub_${hex()}`;
    assert.equal((await apply(ts.subscription_id, twinSub, 'incomplete', { type: 'customer.subscription.created' })).status, 'pending');
    assert.equal((await apply(ts.subscription_id, twinSub, 'active')).status, 'active');
    assert.equal((await apply(ts.subscription_id, `sub_${hex()}`, 'active')).code, 'SUBSCRIPTION_MISMATCH');

    // One Stripe event id is one log row. Passing an id that a state change
    // already used to the grant is an error, never a silent "already granted".
    const shared = `evt_${hex()}`;
    await rpc('public.apply_credit_subscription_event($1, $2, $3, $4, $5, $6, $7, $8, now())',
        [shared, 'invoice.paid', null, twinSub, `cus_${hex()}`, 'active', inDays(30), false]);
    const clash = await paid(twinSub, `in_${hex()}`, { event: shared });
    assert.deepEqual([clash.ok, clash.code], [false, 'EVENT_ID_ALREADY_USED']);
    assert.equal((await paid(twinSub, `in_${hex()}`)).granted, 270);

    // No plan below ADR-0014's 3.3 cents a credit.
    await c.query('SAVEPOINT floor');
    await assert.rejects(q(`INSERT INTO public.credit_subscription_plans (id, billing_interval, price_usd_cents, credits)
        VALUES ('too-cheap', 'month', 3299, 1000)`), /price_floor/);
    await c.query('ROLLBACK TO SAVEPOINT floor');

    // ── A second subscription paid while one is live is flagged and never grants. ──
    const second = await one(
        `INSERT INTO public.credit_subscriptions (user_id, plan_id, idempotency_key, price_usd_cents, credits, consent_version)
         VALUES ($1, 'plus-monthly', $2, 5900, 1200, 'subscription-test-1') RETURNING id`, [o.u.id, `k-${hex()}`]);
    const sub2 = `sub_${hex()}`;
    const flagged = await apply(second.id, sub2, 'active');
    assert.deepEqual([flagged.status, flagged.flagged], ['flagged', true]);
    assert.equal((await paid(sub2, `in_${hex()}`, { cents: 5900, end: inDays(90) })).code, 'SUBSCRIPTION_NOT_LIVE');
    assert.deepEqual(await buckets(o.u), [280, 10, 270]);

    // ── Refund: what is left of that cycle goes; Free and Pack Credits stay. ──
    const f = await subscribed();
    assert.equal((await rpc(`public.ledger_grant($1, 50, 'grant:test')`, [f.u.id])).ok, true);
    const job = await debit(f.u, 70);
    assert.deepEqual(await buckets(f.u), [260, 10, 200]);
    assert.equal((await reverse(f.sub, f.invoice, 'partially_refunded')).taken, 0);
    assert.deepEqual(await buckets(f.u), [260, 10, 200]);
    const refundEvent = `evt_${hex()}`;
    const rv = await reverse(f.sub, f.invoice, 'refunded', refundEvent);
    assert.deepEqual([rv.ok, rv.taken, rv.frozen], [true, 200, false]);
    assert.deepEqual(await buckets(f.u), [60, 10, 0]);
    assert.equal((await reverse(f.sub, f.invoice, 'refunded', refundEvent)).idempotent, true);
    assert.equal((await reverse(f.sub, f.invoice, 'refunded')).taken, 0, 'a second refund event takes nothing more');
    // The refund ends the row atomically, before Stripe cancellation arrives.
    assert.equal((await rpc('public.read_own_credit_subscription($1)', [f.u.auth])).subscription.status, 'ended');
    assert.equal((await paid(f.sub, `in_${hex()}`, { end: inDays(60) })).code, 'SUBSCRIPTION_NOT_LIVE');
    // A job that cycle paid for fails afterwards: returned and expired at once.
    assert.equal((await refund(f.u, job.job_id, 70)).ok, true);
    assert.deepEqual(await buckets(f.u), [60, 10, 0]);
    await reconciles(f.u);
    // A new subscription's paid invoice starts a clean cycle.
    const replacement = await start(f.u);
    const replacementSub = `sub_${hex()}`;
    assert.equal((await apply(replacement.subscription_id, replacementSub, 'active')).status, 'active');
    assert.equal((await paid(replacementSub, `in_${hex()}`, { end: inDays(60) })).granted, 270);
    assert.deepEqual(await buckets(f.u), [330, 10, 270]);
    // A refund of the OLD invoice now touches nothing: its cycle was replaced.
    assert.equal((await reverse(f.sub, f.invoice, 'refunded')).taken, 0);
    assert.deepEqual(await buckets(f.u), [330, 10, 270]);
    await reconciles(f.u);

    // A refund can beat invoice.paid. It still ends the row, so the late
    // invoice never grants credits for a payment already returned.
    const earlyRefundUser = await user();
    const earlyRefundStart = await start(earlyRefundUser);
    const earlyRefundSub = `sub_${hex()}`, earlyRefundInvoice = `in_${hex()}`;
    await apply(earlyRefundStart.subscription_id, earlyRefundSub, 'active');
    assert.equal((await reverse(earlyRefundSub, earlyRefundInvoice, 'refunded')).ok, true);
    assert.equal((await paid(earlyRefundSub, earlyRefundInvoice)).code, 'SUBSCRIPTION_NOT_LIVE');
    assert.deepEqual(await buckets(earlyRefundUser), [10, 10, 0]);
    await reconciles(earlyRefundUser);

    // ── Dispute: credits go, the subscription ends, the account is Frozen. ──
    const d = await subscribed('plus-monthly');
    const dv = await reverse(d.sub, d.invoice, 'disputed');
    assert.deepEqual([dv.taken, dv.frozen], [1200, true]);
    assert.deepEqual(await buckets(d.u), [10, 10, 0]);
    const dRow = await one('SELECT status, end_reason FROM public.credit_subscriptions WHERE id = $1', [d.id]);
    assert.deepEqual([dRow.status, dRow.end_reason], ['ended', 'disputed']);
    assert.notEqual((await one('SELECT frozen_at FROM public.users WHERE id = $1', [d.u.id])).frozen_at, null);
    assert.equal((await start(d.u)).code, 'ACCOUNT_FROZEN');
    await reconciles(d.u);
    // An invoice that never granted has nothing to take, and that is not an error.
    assert.deepEqual([(await reverse(o.sub, `in_${hex()}`, 'refunded')).taken], [0]);

    // ── Cooling-off: full while nothing is spent, refused once anything is. ──
    const w = await subscribed();
    const co = await rpc('public.cancel_credit_subscription_cooling_off($1, $2)', [w.u.auth, w.id]);
    assert.deepEqual([co.ok, co.idempotent, co.taken, co.invoice_id, co.stripe_subscription_id], [true, false, 270, w.invoice, w.sub]);
    assert.deepEqual(await buckets(w.u), [10, 10, 0]);
    const coAgain = await rpc('public.cancel_credit_subscription_cooling_off($1, $2)', [w.u.auth, w.id]);
    assert.deepEqual([coAgain.ok, coAgain.idempotent, coAgain.invoice_id], [true, true, w.invoice]);
    assert.equal((await one('SELECT end_reason FROM public.credit_subscriptions WHERE id = $1', [w.id])).end_reason, 'cancelled_cooling_off');
    await reconciles(w.u);

    const spent = await subscribed();
    await debit(spent.u, 1);
    assert.equal((await rpc('public.cancel_credit_subscription_cooling_off($1, $2)', [spent.u.auth, spent.id])).code, 'CREDITS_SPENT');
    assert.deepEqual(await buckets(spent.u), [279, 10, 269]);

    const late = await subscribed();
    await q(`UPDATE public.credit_subscriptions SET started_at = now() - interval '15 days' WHERE id = $1`, [late.id]);
    assert.equal((await rpc('public.cancel_credit_subscription_cooling_off($1, $2)', [late.u.auth, late.id])).code, 'COOLING_OFF_OVER');
    assert.equal((await rpc('public.cancel_credit_subscription_cooling_off($1, $2)', [w.u.auth, late.id])).code, 'SUBSCRIPTION_NOT_FOUND');

    // ── The event log is append-only; the browser roles reach nothing. ──
    for (const sql of ['UPDATE public.credit_subscription_events SET type = type', 'DELETE FROM public.credit_subscription_events']) {
        await c.query('SAVEPOINT r');
        await assert.rejects(c.query(sql), /append-only/);
        await c.query('ROLLBACK TO SAVEPOINT r');
    }
    for (const role of ['anon', 'authenticated']) {
        for (const fn of ['subscription_grant(uuid,integer,timestamptz,text)', 'reverse_subscription_grant(uuid,text)',
            'grant_credit_subscription_invoice(text,text,text,integer,timestamptz,timestamptz)',
            'start_credit_subscription(text,text,text,text,integer,integer)', 'read_credit_subscription_binding(text)',
            'read_own_credit_subscription_by_id(text,uuid)']) {
            assert.equal((await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`, [role, `public.${fn}`])).p, false, `${role} ${fn}`);
        }
        for (const t of ['credit_subscriptions', 'credit_subscription_plans', 'credit_subscription_events']) {
            assert.equal((await one(`SELECT has_table_privilege($1, $2, 'SELECT') AS p`, [role, `public.${t}`])).p, false, `${role} ${t}`);
        }
    }

    console.log('credit subscriptions: ok');
} finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
}
