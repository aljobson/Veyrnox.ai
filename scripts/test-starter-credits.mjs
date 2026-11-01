#!/usr/bin/env node
// 0422 (ADR-0313): the first 10 credits arrive with the first paid subscription, not at sign-up.
// Runs against the full migration replay (ledger-tests.yml). Everything is rolled back, and the
// migration is re-applied inside the transaction as its idempotency proof.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const S = 398; // starter-monthly credits
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
const hex = () => randomUUID().replace(/-/g, '');
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const setSwitch = (on) => rpc('public.set_starter_credits_on_subscription($1)', [on]);

async function user({ confirmed = true } = {}) {
    const auth = randomUUID();
    const email = `${auth}@example.invalid`;
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, $3)', [auth, email, confirmed ? new Date() : null]);
    const id = (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id;
    return { auth, id, email };
}
const buckets = async (u) => {
    const b = await one('SELECT balance, free_balance, subscription_balance FROM public.credit_balances WHERE user_id = $1', [u.id]);
    return [b.balance, b.free_balance, b.subscription_balance];
};
const signupRows = async (u) => Number((await one(`SELECT count(*) AS n FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`, [u.id])).n);
const reconciles = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);
    }
};
const start = (u, plan = 'starter-monthly') => rpc('public.start_credit_subscription($1, $2, $3, $4, 5, 600)', [u.auth, plan, `k-${hex()}`, 'subscription-test-1']);
const apply = (id, sub, status, end = inDays(30)) =>
    rpc('public.apply_credit_subscription_event($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [`evt_${hex()}`, 'customer.subscription.updated', id, sub, `cus_${hex()}`, status, end, false, new Date().toISOString()]);
const paid = (sub, invoice, end = inDays(30), cents = 1900) =>
    rpc('public.grant_credit_subscription_invoice($1, $2, $3, $4, $5, now())', [sub, invoice, `evt_${hex()}`, cents, end]);
const reverse = (sub, invoice, reason) =>
    rpc('public.reverse_credit_subscription_invoice($1, $2, $3, $4, $5, now())', [sub, invoice, `evt_${hex()}`, reason, 'ref_1']);
async function subscribe(u, plan) {
    const s = await start(u, plan);
    assert.equal(s.ok, true, JSON.stringify(s));
    const sub = `sub_${hex()}`;
    assert.equal((await apply(s.subscription_id, sub, 'active')).status, 'active');
    return { id: s.subscription_id, sub };
}

try {
    await c.query('BEGIN');

    // ── The migration re-applies cleanly, and ships OFF. ──
    const migration = await readFile(new URL('../packages/db/schema/supabase/0422_starter_credits_on_first_subscription.sql', import.meta.url), 'utf8');
    await c.query(migration);
    await c.query(migration);
    assert.equal(await rpc('public.starter_credits_on_subscription_enabled()'), false, 'ships off');
    assert.equal((await one('SELECT count(*) AS n FROM public.starter_credit_config')).n, '1');

    // ── Switch OFF: sign-up behaves exactly as before (0071). ──
    const a = await user();
    assert.deepEqual(await buckets(a), [10, 10, 0], 'confirmed sign-up still grants 10 Free Credits');
    const b = await user({ confirmed: false });
    assert.deepEqual(await buckets(b), [0, 0, 0], 'unconfirmed sign-up holds the grant');
    await q('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [b.auth]);
    assert.deepEqual(await buckets(b), [10, 10, 0], 'confirmation grants it');
    // Subscribing with the switch off adds nothing beyond the plan.
    {
        const s = await subscribe(a);
        const g = await paid(s.sub, `in_${hex()}`);
        assert.equal(g.ok, true, JSON.stringify(g));
        assert.deepEqual(await buckets(a), [10 + S, 10, S]);
        assert.equal(await signupRows(a), 1);
        assert.deepEqual(await rpc('public.grant_starter_credits($1)', [a.id]), { ok: true, granted: 0, skipped: 'DISABLED' });
    }

    // ── The switch: validated, replay-safe, and callable by service_role only. ──
    assert.equal((await setSwitch(null)).code, 'INVALID_VALUE');
    assert.deepEqual(await setSwitch(true), { ok: true, enabled: true });
    assert.deepEqual(await setSwitch(true), { ok: true, enabled: true });
    assert.equal(await rpc('public.starter_credits_on_subscription_enabled()'), true);
    for (const role of ['anon', 'authenticated', 'PUBLIC']) {
        for (const sig of ['public.set_starter_credits_on_subscription(boolean)', 'public.grant_starter_credits(uuid)',
            'public.starter_credits_on_subscription_enabled()', 'public.subscription_grant(uuid,integer,timestamptz,text)']) {
            const has = role === 'PUBLIC'
                ? await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS x`, [sig])
                : await one(`SELECT has_function_privilege($2, $1, 'EXECUTE') AS x`, [sig, role]);
            assert.equal(has.x, false, `${role} must not execute ${sig}`);
        }
    }
    for (const sig of ['public.set_starter_credits_on_subscription(boolean)', 'public.grant_starter_credits(uuid)']) {
        assert.equal((await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS x`, [sig])).x, true);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await one(`SELECT has_table_privilege($1, 'public.starter_credit_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS x`, [role])).x, false, role);
    }

    // ── Switch ON: sign-up provisions and grants nothing. ──
    const n = await user();
    assert.deepEqual(await buckets(n), [0, 0, 0], 'a confirmed sign-up gets a zero balance');
    assert.equal(await signupRows(n), 0);
    const m = await user({ confirmed: false });
    await q('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [m.auth]);
    assert.deepEqual(await buckets(m), [0, 0, 0], 'confirmation grants nothing either');

    // ── First paid invoice grants the plan and the 10 starter credits, once. ──
    const s1 = await subscribe(n);
    const inv1 = `in_${hex()}`;
    const g1 = await paid(s1.sub, inv1);
    assert.equal(g1.ok, true, JSON.stringify(g1));
    assert.deepEqual(await buckets(n), [S + 10, 10, S]);
    assert.equal(g1.balance_after, S + 10, 'the reported balance includes the starter credits');
    assert.equal(await signupRows(n), 1);
    const free = await one(`SELECT free_delta, delta FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`, [n.id]);
    assert.deepEqual([free.delta, free.free_delta], [10, 10], 'they are ordinary Free Credits (ADR-0013)');
    await reconciles(n);

    // Replaying the same invoice, a renewal, and the direct call add nothing.
    const again = await paid(s1.sub, inv1);
    assert.deepEqual([again.ok, again.idempotent, again.granted], [true, true, 0]);
    const renewal = await paid(s1.sub, `in_${hex()}`, inDays(60));
    assert.equal(renewal.ok, true, JSON.stringify(renewal));
    assert.deepEqual(await buckets(n), [S + 10, 10, S], 'a renewal replaces the cycle and mints no starter credits');
    assert.equal((await rpc('public.grant_starter_credits($1)', [n.id])).granted, 0);
    assert.equal(await signupRows(n), 1);
    await reconciles(n);

    // ── One grant per user, not per subscription. ──
    await q(`UPDATE public.credit_subscriptions SET status = 'ended', ended_at = now(), end_reason = 'subscription_ended' WHERE id = $1`, [s1.id]);
    const s1b = await subscribe(n, 'lite-monthly');
    assert.equal((await paid(s1b.sub, `in_${hex()}`, inDays(90))).ok, true);
    assert.equal(await signupRows(n), 1, 'a second subscription does not grant again');
    assert.equal((await buckets(n))[1], 10);

    // ── A full refund of the first invoice takes the subscription bucket, not the starter credits. ──
    const r = await user();
    const sr = await subscribe(r);
    const invR = `in_${hex()}`;
    assert.equal((await paid(sr.sub, invR)).ok, true);
    assert.deepEqual(await buckets(r), [S + 10, 10, S]);
    const rev = await reverse(sr.sub, invR, 'refunded');
    assert.equal(rev.ok, true, JSON.stringify(rev));
    assert.deepEqual(await buckets(r), [10, 10, 0], 'the 10 Free Credits stay; they expire on their own clock');
    assert.equal(await signupRows(r), 1);
    await reconciles(r);

    // ── Accounts that already got the sign-up grant keep it and get no second one. ──
    await setSwitch(false);
    const old = await user();
    assert.deepEqual(await buckets(old), [10, 10, 0]);
    await setSwitch(true);
    const so = await subscribe(old);
    assert.equal((await paid(so.sub, `in_${hex()}`)).ok, true);
    assert.deepEqual(await buckets(old), [S + 10, 10, S], 'still 10 Free Credits, not 20');
    assert.equal(await signupRows(old), 1);
    await reconciles(old);

    // ── Frozen accounts get nothing; the first paid cycle after an unfreeze does. ──
    // A Frozen account cannot start a subscription, so it is frozen between start and first payment.
    const f = await user();
    const sf = await subscribe(f);
    // freeze_account answers whether the account was already Frozen.
    assert.equal(await rpc('public.freeze_account($1, $2, NULL)', [f.id, 'test']), false);
    assert.notEqual((await one('SELECT frozen_at FROM public.users WHERE id = $1', [f.id])).frozen_at, null);
    assert.equal((await paid(sf.sub, `in_${hex()}`)).ok, true);
    assert.deepEqual(await buckets(f), [S, 0, S], 'frozen: plan credits only');
    assert.equal(await signupRows(f), 0);
    assert.equal((await rpc('public.unfreeze_account($1, $2, $3)', [f.id, 'test-operator', 'test'])).ok, true);
    assert.equal((await paid(sf.sub, `in_${hex()}`, inDays(60))).ok, true);
    assert.deepEqual(await buckets(f), [S + 10, 10, S], 'granted once, at the first cycle after the unfreeze');
    await reconciles(f);

    // ── An erased email gets no starter credits (0347 guard), and the call is still ok. ──
    const e = await user();
    const eraser = await user();
    await q(`INSERT INTO public.account_deletions (user_id, auth_id, token_hash, token_expires_at, state, erased_at, email_sha256)
             VALUES ($1, $2, decode(repeat('ab', 32), 'hex'), now() + interval '1 day', 'erased', now(), sha256(convert_to(lower(btrim($3::text)), 'UTF8')))`,
        [eraser.id, eraser.auth, e.email]);
    const ge = await rpc('public.grant_starter_credits($1)', [e.id]);
    assert.deepEqual([ge.ok, ge.granted], [true, 0]);
    assert.equal(await signupRows(e), 0);
    assert.equal((await rpc('public.grant_starter_credits($1)', [randomUUID()])).code, 'USER_NOT_FOUND');

    // ── The App Store / Play path calls the same subscription_grant. ──
    const st = await user();
    const customer = (await rpc('public.get_or_create_store_customer($1)', [st.auth])).rc_customer_id;
    const event = (extra = {}) => rpc('public.apply_store_generation_event($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [customer, 'ios', 'ai.veyrnox.generation.starter.monthly', `otx_${hex()}`.slice(0, 40), `evt_${hex()}`, 'activate', 'initial_purchase', inDays(30), new Date().toISOString()]);
    const ev = await event();
    assert.equal(ev.ok, true, JSON.stringify(ev));
    assert.deepEqual(await buckets(st), [S + 10, 10, S]);
    await reconciles(st);

    // ── Switch OFF again: a fresh sign-up is granted as before, and subscribing adds nothing. ──
    await setSwitch(false);
    const z = await user();
    assert.deepEqual(await buckets(z), [10, 10, 0]);

    console.log('starter credits on first subscription: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
