#!/usr/bin/env node
// 0186/0187 (ADR-0064, IMPLEMENTATION-PLAN C4): credit Subscriptions. Runs
// against the full migration replay (ledger-tests.yml). Every fixture is
// rolled back.
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
const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
let clock = Date.now() - 3600000;
const tick = () => new Date(clock += 1000).toISOString();

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const buckets = async (u) => {
    const b = await one('SELECT balance, free_balance, subscription_balance FROM public.credit_balances WHERE user_id = $1', [u.id]);
    return [b.balance, b.free_balance, b.subscription_balance];
};
const start = (u, plan, key = `key-${randomUUID()}`) =>
    rpc(`public.start_credit_subscription($1, $2, $3, 'sub-consent-v1', 5, 600)`, [u.auth, plan, key]);
const event = (rowId, sub, status, { type = 'customer.subscription.updated', end = inDays(30), cancel = false, at = tick(), evt = id('evt') } = {}) =>
    rpc('public.apply_credit_subscription_event($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [evt, type, rowId, sub, id('cus'), status, end, cancel, at]);
const paid = (sub, { invoice = id('in'), cents = 1900, end = inDays(30), plan = null } = {}) =>
    rpc('public.grant_credit_subscription_invoice($1, $2, $3, $4, $5, $6)', [sub, invoice, cents, end, plan, tick()]);
const status = async (rowId) => (await one('SELECT status, plan_id, credits_per_cycle, end_reason, cancel_at_period_end FROM public.credit_subscriptions WHERE id = $1', [rowId]));
const clean = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);
    }
    assert.deepEqual(await q('SELECT * FROM public.reconcile_credit_subscriptions() WHERE user_id = $1', [u.id]), []);
};
/** A live Subscription on `plan`, with its first cycle granted. */
async function subscribed(plan = 'starter-monthly', cents = 1900) {
    const u = await user();
    const s = await start(u, plan);
    const sub = id('sub');
    await event(s.subscription_id, sub, 'active', { type: 'customer.subscription.created' });
    const invoice = id('in');
    const g = await paid(sub, { invoice, cents });
    assert.equal(g.ok, true, JSON.stringify(g));
    return { u, row: s.subscription_id, sub, invoice };
}

try {
    // Both migrations are safe to apply twice.
    for (const f of ['0186_credit_subscriptions.sql', '0187_credit_subscription_money.sql']) {
        const sql = await readFile(new URL(`../packages/db/schema/supabase/${f}`, import.meta.url), 'utf8');
        await c.query('BEGIN'); await c.query(sql); await c.query(sql); await c.query('ROLLBACK');
    }

    await c.query('BEGIN');

    // ── Plans: the three accepted tiers, cheapest first, above the price floor. ──
    const plans = await rpc('public.list_credit_subscription_plans()');
    assert.deepEqual(plans.map((p) => [p.id, p.tier, p.price_usd_cents, p.credits_per_cycle]),
        [['starter-monthly', 1, 1900, 270], ['plus-monthly', 2, 5900, 1200], ['ultra-monthly', 3, 12900, 3000]]);
    await c.query('SAVEPOINT floor');
    await assert.rejects(q(`INSERT INTO public.credit_subscription_plans (id, tier, billing_interval, price_usd_cents, credits_per_cycle)
        VALUES ('too-cheap', 9, 'month', 100, 100000)`), /price_floor/);
    await c.query('ROLLBACK TO SAVEPOINT floor');

    // ── start: validates, is idempotent on the key, refuses a second live one. ──
    const a = await user();
    for (const [args, code] of [
        [['not-a-uuid', 'starter-monthly', 'key-12345678', 'v1', 5, 600], 'USER_NOT_FOUND'],
        [[randomUUID(), 'starter-monthly', 'key-12345678', 'v1', 5, 600], 'USER_NOT_FOUND'],
        [[a.auth, 'starter-monthly', 'short', 'v1', 5, 600], 'IDEMPOTENCY_KEY_REQUIRED'],
        [[a.auth, 'starter-monthly', 'key-12345678', null, 5, 600], 'CONSENT_VERSION_REQUIRED'],
        [[a.auth, 'no-such-plan', 'key-12345678', 'v1', 5, 600], 'PLAN_NOT_FOUND'],
        [[a.auth, 'starter-monthly', 'key-12345678', 'v1', 0, 600], 'BAD_LIMIT'],
    ]) {
        const r = await rpc('public.start_credit_subscription($1, $2, $3, $4, $5, $6)', args);
        assert.deepEqual([r.ok, r.code], [false, code]);
    }
    const key = `key-${randomUUID()}`;
    const s1 = await start(a, 'starter-monthly', key);
    assert.deepEqual([s1.ok, s1.idempotent, s1.status, s1.price_usd_cents, s1.credits_per_cycle], [true, false, 'pending', 1900, 270]);
    const s1again = await start(a, 'starter-monthly', key);
    assert.deepEqual([s1again.idempotent, s1again.subscription_id], [true, s1.subscription_id]);
    assert.equal((await start(a, 'plus-monthly', key)).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.deepEqual(await buckets(a), [10, 10, 0], 'starting a checkout grants nothing');

    // ── The first event binds the pending row; an unsigned unknown one is not ours. ──
    const subA = id('sub');
    assert.equal((await event(null, subA, 'active')).code, 'SUBSCRIPTION_NOT_FOUND');
    const bound = await event(s1.subscription_id, subA, 'active', { type: 'customer.subscription.created' });
    assert.deepEqual([bound.ok, bound.status, bound.flagged, bound.user_id], [true, 'active', false, a.id]);
    assert.deepEqual(await buckets(a), [10, 10, 0], 'a status event grants nothing');
    assert.equal((await event(randomUUID(), subA, 'active')).code, 'SUBSCRIPTION_MISMATCH');
    assert.equal((await start(a, 'plus-monthly')).code, 'SUBSCRIPTION_ALREADY_ACTIVE');

    // ── A paid invoice grants one cycle, once. ──
    assert.equal((await paid(id('sub'))).code, 'SUBSCRIPTION_NOT_FOUND');
    for (const bad of [{ cents: 0 }, { cents: null }, { invoice: 'not_an_invoice' }, { end: null }]) {
        assert.equal((await paid(subA, bad)).code, 'INVALID_INVOICE');
    }
    const inv1 = id('in');
    const g1 = await paid(subA, { invoice: inv1 });
    assert.deepEqual([g1.ok, g1.granted, g1.idempotent, g1.credits, g1.expired, g1.balance_after], [true, true, false, 270, 0, 280]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    const g1again = await paid(subA, { invoice: inv1 });
    assert.deepEqual([g1again.ok, g1again.idempotent, g1again.credits], [true, true, 270]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.credit_subscription_events WHERE invoice_id = $1`, [inv1])).n, 1);
    await clean(a);

    // ── Renewal: the next invoice replaces the cycle; nothing rolls over. ──
    await rpc(`public.ledger_debit($1, $2, 100, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [a.id, randomUUID()]);
    const g2 = await paid(subA, { end: inDays(60) });
    assert.deepEqual([g2.ok, g2.credits, g2.expired], [true, 270, 170]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);

    // An invoice whose period does not end later is refused, logged once, and grants nothing.
    const stale = id('in');
    const r1 = await paid(subA, { invoice: stale, end: inDays(45) });
    assert.deepEqual([r1.ok, r1.code, r1.granted], [false, 'PERIOD_NOT_NEWER', false]);
    await paid(subA, { invoice: stale, end: inDays(45) });
    assert.deepEqual(await q(`SELECT outcome, credits FROM public.credit_subscription_events WHERE invoice_id = $1`, [stale]),
        [{ outcome: 'PERIOD_NOT_NEWER', credits: 0 }]);
    assert.deepEqual(await buckets(a), [280, 10, 270]);
    await clean(a);

    // ── An invoice can never credit a second Subscription. ──
    const other = await subscribed();
    assert.equal((await paid(other.sub, { invoice: inv1, end: inDays(90) })).code, 'GRANT_KEY_REUSED');
    assert.deepEqual(await buckets(other.u), [280, 10, 270]);

    // ── Upgrade: a higher plan on the invoice moves the row and grants its credits. ──
    const up = await paid(subA, { end: inDays(90), plan: 'plus-monthly', cents: 4100 });
    assert.deepEqual([up.ok, up.credits, up.expired], [true, 1200, 270]);
    assert.deepEqual(await buckets(a), [1210, 10, 1200]);
    assert.deepEqual([(await status(s1.subscription_id)).plan_id, (await status(s1.subscription_id)).credits_per_cycle], ['plus-monthly', 1200]);
    // A lower plan on an invoice never downgrades mid-flight: the row keeps its plan and credits.
    const down = await paid(subA, { end: inDays(120), plan: 'starter-monthly' });
    assert.deepEqual([down.ok, down.credits], [true, 1200]);
    assert.equal((await status(s1.subscription_id)).plan_id, 'plus-monthly');
    assert.equal((await paid(subA, { end: inDays(150), plan: 'no-such-plan' })).code, 'PLAN_NOT_FOUND');
    await clean(a);

    // ── Cancelling keeps the credits to the period end; resuming undoes it. ──
    const cancelled = await rpc(`public.mark_credit_subscription_renewal($1, $2, 'cancel')`, [a.auth, s1.subscription_id]);
    assert.deepEqual([cancelled.ok, cancelled.cancel_at_period_end], [true, true]);
    assert.deepEqual(await buckets(a), [1210, 10, 1200]);
    assert.equal((await start(a, 'starter-monthly')).code, 'SUBSCRIPTION_ALREADY_ACTIVE', 'cancelled but still running');
    assert.equal((await rpc(`public.mark_credit_subscription_renewal($1, $2, 'resume')`, [a.auth, s1.subscription_id])).cancel_at_period_end, false);
    assert.equal((await rpc(`public.mark_credit_subscription_renewal($1, $2, 'pause')`, [a.auth, s1.subscription_id])).code, 'INVALID_MODE');
    assert.equal((await rpc(`public.mark_credit_subscription_renewal($1, $2, 'cancel')`, [other.u.auth, s1.subscription_id])).code, 'SUBSCRIPTION_NOT_FOUND', 'not the owner');

    // ── Events: replay is a no-op, an older one cannot regress, ended stays ended. ──
    const evt = id('evt');
    const pastDue = await event(null, subA, 'past_due', { evt });
    assert.deepEqual([pastDue.status, pastDue.idempotent], ['past_due', false]);
    assert.deepEqual([(await event(null, subA, 'active', { evt })).idempotent, (await status(s1.subscription_id)).status], [true, 'past_due']);
    const older = await event(null, subA, 'active', { at: new Date(Date.now() - 7200000).toISOString() });
    assert.deepEqual([older.stale, (await status(s1.subscription_id)).status], [true, 'past_due']);
    assert.equal((await paid(subA, { end: inDays(200) })).ok, true, 'past_due is still live: a late payment grants');
    await event(null, subA, 'ended', { type: 'customer.subscription.deleted' });
    assert.deepEqual([(await status(s1.subscription_id)).status, (await status(s1.subscription_id)).end_reason], ['ended', 'subscription_ended']);
    assert.equal((await event(null, subA, 'active')).stale, true);
    assert.equal((await status(s1.subscription_id)).status, 'ended');
    const late = await paid(subA, { end: inDays(300) });
    assert.deepEqual([late.ok, late.code], [false, 'SUBSCRIPTION_NOT_LIVE']);
    // An ended Subscription leaves its paid cycle to run out, and a new one may start.
    assert.equal((await buckets(a))[2], 1200);
    assert.equal((await start(a, 'starter-monthly')).ok, true);
    await clean(a);

    // ── A second Subscription paid while one is live is flagged and never grants. ──
    const d = await subscribed();
    const second = await one(`INSERT INTO public.credit_subscriptions (user_id, plan_id, idempotency_key, price_usd_cents, credits_per_cycle, consent_version)
        VALUES ($1, 'ultra-monthly', $2, 12900, 3000, 'v1') RETURNING id`, [d.u.id, `key-${randomUUID()}`]);
    const sub2 = id('sub');
    const flagged = await event(second.id, sub2, 'active', { type: 'customer.subscription.created' });
    assert.deepEqual([flagged.status, flagged.flagged], ['flagged', true]);
    assert.equal((await paid(sub2, { cents: 12900, end: inDays(90) })).code, 'SUBSCRIPTION_NOT_LIVE');
    assert.deepEqual(await buckets(d.u), [280, 10, 270]);
    // Refunding the flagged one takes nothing from the live one.
    const refundFlagged = await rpc(`public.end_credit_subscription($1, $2, 'refunded', NULL, $3)`, [sub2, id('evt'), tick()]);
    assert.deepEqual([refundFlagged.ok, refundFlagged.revoked, refundFlagged.frozen], [true, 0, false]);
    assert.deepEqual(await buckets(d.u), [280, 10, 270]);
    await clean(d.u);

    // ── Refund: the Subscription ends and what is left of the cycle goes. ──
    const r = await subscribed();
    const spent = await rpc(`public.ledger_debit($1, $2, 70, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [r.u.id, randomUUID()]);
    const refundEvt = id('evt');
    const refunded = await rpc(`public.end_credit_subscription($1, $2, 'refunded', NULL, $3)`, [r.sub, refundEvt, tick()]);
    assert.deepEqual([refunded.ok, refunded.revoked, refunded.frozen], [true, 200, false]);
    assert.deepEqual(await buckets(r.u), [10, 10, 0]);
    assert.deepEqual([(await status(r.row)).status, (await status(r.row)).end_reason], ['ended', 'refunded']);
    assert.deepEqual((await rpc(`public.end_credit_subscription($1, $2, 'refunded', NULL, $3)`, [r.sub, refundEvt, tick()])).idempotent, true);
    assert.deepEqual(await buckets(r.u), [10, 10, 0]);
    // A job the revoked cycle paid for, refunded afterwards, does not bring credits back.
    await rpc(`public.ledger_refund($1, $2, 70, 'refund:provider_failed')`, [spent.job_id, r.u.id]);
    assert.deepEqual(await buckets(r.u), [10, 10, 0]);
    assert.equal((await one('SELECT frozen_at FROM public.users WHERE id = $1', [r.u.id])).frozen_at, null);
    await clean(r.u);

    // A refund on an old, ended Subscription does not empty the one now live.
    const o = await subscribed();
    await event(null, o.sub, 'ended', { type: 'customer.subscription.deleted' });
    await q(`UPDATE public.credit_balances SET subscription_expires_at = now() - interval '1 hour' WHERE user_id = $1`, [o.u.id]);
    await rpc('public.expire_subscription_credits()');
    const s2 = await start(o.u, 'plus-monthly');
    const newSub = id('sub');
    await event(s2.subscription_id, newSub, 'active', { type: 'customer.subscription.created' });
    assert.equal((await paid(newSub, { cents: 5900 })).credits, 1200);
    const oldRefund = await rpc(`public.end_credit_subscription($1, $2, 'refunded', NULL, $3)`, [o.sub, id('evt'), tick()]);
    assert.deepEqual([oldRefund.ok, oldRefund.revoked], [true, 0]);
    assert.deepEqual(await buckets(o.u), [1210, 10, 1200]);
    await clean(o.u);

    // ── Dispute: the same, and the account is Frozen. ──
    const x = await subscribed();
    const disputed = await rpc(`public.end_credit_subscription($1, $2, 'disputed', 'dp_test', $3)`, [x.sub, id('evt'), tick()]);
    assert.deepEqual([disputed.ok, disputed.revoked, disputed.frozen], [true, 270, true]);
    assert.deepEqual(await buckets(x.u), [10, 10, 0]);
    assert.notEqual((await one('SELECT frozen_at FROM public.users WHERE id = $1', [x.u.id])).frozen_at, null);
    assert.match((await one(`SELECT reason FROM public.account_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [x.u.id])).reason, /dispute dp_test on credit Subscription/);
    assert.equal((await start(x.u, 'starter-monthly')).code, 'ACCOUNT_FROZEN');
    for (const [args, code] of [[[x.sub, 'bad', 'refunded', null, tick()], 'INVALID_EVENT'], [[x.sub, id('evt'), 'gifted', null, tick()], 'INVALID_EVENT'],
        [['nope', id('evt'), 'refunded', null, tick()], 'INVALID_SUBSCRIPTION'], [[id('sub'), id('evt'), 'refunded', null, tick()], 'SUBSCRIPTION_NOT_FOUND']]) {
        assert.equal((await rpc('public.end_credit_subscription($1, $2, $3, $4, $5)', args)).code, code);
    }
    await clean(x.u);

    // ── read_own: the live one first, with what the route needs. ──
    const mine = (await rpc('public.read_own_credit_subscription($1)', [d.u.auth])).subscription;
    assert.deepEqual([mine.status, mine.plan_id, mine.credits_per_cycle, mine.stripe_subscription_id], ['active', 'starter-monthly', 270, d.sub]);
    assert.equal((await rpc('public.read_own_credit_subscription($1)', [(await user()).auth])).subscription, null);

    // ── Checkout attempts are rate limited per account. ──
    const many = await user();
    for (let i = 0; i < 5; i++) assert.equal((await start(many, 'starter-monthly')).ok, true);
    const limited = await start(many, 'starter-monthly');
    assert.deepEqual([limited.code, limited.retry_after_seconds > 0], ['RATE_LIMITED', true]);

    // ── The reconciler sees a grant with no invoice behind it, and a log entry with no grant. ──
    await c.query('SAVEPOINT orphan');
    await rpc('public.subscription_grant($1, 50, $2, $3)', [d.u.id, inDays(400 - 1), id('in')]);
    assert.equal((await q('SELECT * FROM public.reconcile_credit_subscriptions() WHERE user_id = $1', [d.u.id])).length, 1);
    await c.query('ROLLBACK TO SAVEPOINT orphan');
    await c.query('SAVEPOINT phantom');
    await q(`INSERT INTO public.credit_subscription_events (subscription_id, type, invoice_id, credits, outcome, occurred_at)
             VALUES ($1, 'invoice.grant', $2, 270, 'GRANTED', now())`, [d.row, id('in')]);
    assert.equal((await q('SELECT * FROM public.reconcile_credit_subscriptions() WHERE user_id = $1', [d.u.id])).length, 1);
    await c.query('ROLLBACK TO SAVEPOINT phantom');

    // ── The event log is append-only, and one live Subscription per account is enforced. ──
    await c.query('SAVEPOINT guard');
    await assert.rejects(q('UPDATE public.credit_subscription_events SET credits = 1'), /append-only/);
    await c.query('ROLLBACK TO SAVEPOINT guard');
    await assert.rejects(q(`INSERT INTO public.credit_subscriptions (user_id, plan_id, idempotency_key, price_usd_cents, credits_per_cycle, consent_version, status)
        VALUES ($1, 'starter-monthly', $2, 1900, 270, 'v1', 'active')`, [d.u.id, `key-${randomUUID()}`]), /one_live_per_user/);
    await c.query('ROLLBACK TO SAVEPOINT guard');

    // ── Only the Worker's role may call these; no role may touch the tables or the internal revoke. ──
    for (const fn of ['public.list_credit_subscription_plans()', 'public.start_credit_subscription(text, text, text, text, integer, integer)',
        'public.record_credit_subscription_session(text, uuid, text)',
        'public.apply_credit_subscription_event(text, text, uuid, text, text, text, timestamptz, boolean, timestamptz)',
        'public.grant_credit_subscription_invoice(text, text, integer, timestamptz, text, timestamptz)',
        'public.end_credit_subscription(text, text, text, text, timestamptz)', 'public.read_own_credit_subscription(text)',
        'public.mark_credit_subscription_renewal(text, uuid, text)', 'public.reconcile_credit_subscriptions()']) {
        const p = await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
            has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [fn]);
        assert.deepEqual([p.anon, p.authed, p.service], [false, false, true], fn);
    }
    const internal = await one(`SELECT has_function_privilege('service_role', 'public.revoke_subscription_credits(uuid)', 'EXECUTE') AS service,
        has_function_privilege('authenticated', 'public.revoke_subscription_credits(uuid)', 'EXECUTE') AS authed`);
    assert.deepEqual([internal.service, internal.authed], [false, false]);
    for (const t of ['credit_subscription_plans', 'credit_subscriptions', 'credit_subscription_events']) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
            const p = await one(`SELECT has_table_privilege($1, $2, 'SELECT') AS r, has_table_privilege($1, $2, 'INSERT') AS w`, [role, `public.${t}`]);
            assert.deepEqual([p.r, p.w], [false, false], `${role} on ${t}`);
        }
        assert.equal((await one(`SELECT relrowsecurity AND relforcerowsecurity AS rls FROM pg_class WHERE oid = $1::regclass`, [`public.${t}`])).rls, true, t);
    }

    await c.query('ROLLBACK');
    console.log('credit subscriptions: ok');
} catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exitCode = 1;
} finally {
    await c.end();
}
