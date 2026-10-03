#!/usr/bin/env node
// 0183/0184 (ADR-0064, IMPLEMENTATION-PLAN C2/C3): the Subscription Credit
// bucket. Runs against the full migration replay (ledger-tests.yml), after
// the Cinema scripts, so a published title exists to unlock. Every fixture is
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
const key = () => `in_${randomUUID().replace(/-/g, '')}`;
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
const parts = async (entryWhere, args) => {
    const r = await one(`SELECT delta, free_delta, subscription_delta FROM public.ledger_entries WHERE ${entryWhere} ORDER BY created_at DESC, id DESC LIMIT 1`, args);
    return [r.delta, r.free_delta, r.subscription_delta];
};
const debit = (u, credits) => rpc(`public.ledger_debit($1, $2, $3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [u.id, randomUUID(), credits]);
const refund = (u, job, credits) => rpc(`public.ledger_refund($1, $2, $3, 'refund:provider_failed')`, [job, u.id, credits]);
const grant = (u, credits, end, k = key()) => rpc('public.subscription_grant($1, $2, $3, $4)', [u.id, credits, end, k]);
const pack = (u, credits) => rpc(`public.ledger_grant($1, $2, 'grant:test')`, [u.id, credits]);
const endCycle = (u) => q(`UPDATE public.credit_balances SET subscription_expires_at = now() - interval '1 hour' WHERE user_id = $1`, [u.id]);
const reconciles = async (u) => {
    for (const fn of ['reconcile_subscription_credits', 'reconcile_free_credits', 'reconcile_balances']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}() WHERE user_id = $1`, [u.id]), [], fn);
    }
};
const refused = async (sql, args, code) => {
    await c.query('SAVEPOINT r');
    try { await c.query(sql, args); assert.fail(`expected ${code}`); }
    catch (err) { assert.equal(err.code, code, err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

try {
    // Both migrations are safe to apply twice.
    for (const f of ['0183_subscription_credit_bucket.sql', '0184_subscription_credit_cycle.sql']) {
        const sql = await readFile(new URL(`../packages/db/schema/supabase/${f}`, import.meta.url), 'utf8');
        await c.query('BEGIN'); await c.query(sql); await c.query(sql); await c.query('ROLLBACK');
    }

    await c.query('BEGIN');

    // ── With no subscription, nothing changes: Free first, then Pack. ──
    const a = await user(); // the confirmed insert grants 10 Free Credits
    await pack(a, 20);
    assert.deepEqual(await buckets(a), [30, 10, 0]);
    const d0 = await debit(a, 4);
    assert.equal(d0.balance_after, 26);
    assert.deepEqual(await parts('job_id = $1', [d0.job_id]), [-4, -4, 0]);

    // ── subscription_grant: validates, grants once per key. ──
    for (const [args, code] of [
        [[a.id, 0, inDays(30), key()], 'INVALID_CREDITS'],
        [[a.id, 100001, inDays(30), key()], 'INVALID_CREDITS'],
        [[a.id, 100, inDays(-1), key()], 'INVALID_PERIOD_END'],
        [[a.id, 100, inDays(500), key()], 'INVALID_PERIOD_END'],
        [[a.id, 100, null, key()], 'INVALID_PERIOD_END'],
        [[a.id, 100, inDays(30), 'bad key!'], 'INVALID_GRANT_KEY'],
        [[a.id, 100, inDays(30), null], 'INVALID_GRANT_KEY'],
        [[randomUUID(), 100, inDays(30), key()], 'USER_NOT_FOUND'],
    ]) {
        const r = await rpc('public.subscription_grant($1, $2, $3, $4)', args);
        assert.deepEqual([r.ok, r.code], [false, code]);
    }
    assert.deepEqual(await buckets(a), [26, 6, 0]);

    const k1 = key();
    const g1 = await grant(a, 100, inDays(30), k1);
    assert.deepEqual([g1.ok, g1.idempotent, g1.expired, g1.balance_after], [true, false, 0, 126]);
    assert.deepEqual(await buckets(a), [126, 6, 100]);
    assert.deepEqual(await parts('id = $1', [g1.entry_id]), [100, 0, 100]);

    const replay = await grant(a, 100, inDays(30), k1);
    assert.deepEqual([replay.ok, replay.idempotent, replay.entry_id], [true, true, g1.entry_id]);
    assert.deepEqual(await buckets(a), [126, 6, 100]);

    // The same invoice can never credit a second account, and the refusal
    // leaves that account's previous cycle alone.
    const thief = await user();
    await grant(thief, 40, inDays(30));
    const stolen = await grant(thief, 100, inDays(30), k1);
    assert.deepEqual([stolen.ok, stolen.code], [false, 'GRANT_KEY_REUSED']);
    assert.deepEqual(await buckets(thief), [50, 10, 40]);
    await reconciles(thief);

    // ── Spend order: Subscription, then Free, then Pack. ──
    const d1 = await debit(a, 105);
    assert.equal(d1.balance_after, 21);
    assert.deepEqual(await parts('job_id = $1 AND delta < 0', [d1.job_id]), [-105, -5, -100]);
    assert.deepEqual(await buckets(a), [21, 1, 0]);

    // ── A Credit Refund returns each part to its own bucket. ──
    const r1 = await refund(a, d1.job_id, 105);
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.deepEqual(await parts('id = $1', [r1.entry_id]), [105, 5, 100]);
    assert.deepEqual(await buckets(a), [126, 6, 100]);
    const r1again = await refund(a, d1.job_id, 105);
    assert.deepEqual([r1again.idempotent, r1again.entry_id], [true, r1.entry_id]);
    assert.deepEqual(await buckets(a), [126, 6, 100]);

    // A partial refund returns Subscription Credits first.
    const d2 = await debit(a, 110); // 100 subscription, 6 free, 4 pack
    assert.deepEqual(await parts('job_id = $1 AND delta < 0', [d2.job_id]), [-110, -6, -100]);
    const r2 = await refund(a, d2.job_id, 103);
    assert.deepEqual(await parts('id = $1', [r2.entry_id]), [103, 3, 100]);
    assert.deepEqual(await buckets(a), [119, 3, 100]);
    await reconciles(a);

    // ── A Pack clawback takes Pack Credits only. ──
    const buyer = await user();
    const start = await rpc(`public.create_pending_top_up($1, 'web-270', $2, 'supply-consent-v1', 10, 600)`, [buyer.auth, `test-${randomUUID()}`]);
    assert.equal(start.ok, true, JSON.stringify(start));
    const order = `pi_3Q${randomUUID().replace(/-/g, '')}`;
    const credited = await rpc(`public.credit_top_up($1, $2, $3, 'USD', NULL)`, [start.top_up_id, order, start.price_usd_cents]);
    assert.equal(credited.ok, true, JSON.stringify(credited));
    await grant(buyer, 500, inDays(30));
    assert.deepEqual(await buckets(buyer), [780, 10, 500]);
    await debit(buyer, 600); // 500 subscription, 10 free, 90 pack: 180 pack left
    assert.deepEqual(await buckets(buyer), [180, 0, 0]);
    await grant(buyer, 500, inDays(30));
    assert.deepEqual(await buckets(buyer), [680, 0, 500]);
    const claw = await rpc('public.apply_top_up_refund($1, $2, $3, $4)', [order, start.price_usd_cents, start.price_usd_cents, start.top_up_id]);
    assert.deepEqual([claw.ok, claw.taken, claw.shortfall], [true, 180, 90]);
    assert.deepEqual(await buckets(buyer), [500, 0, 500]);
    await reconciles(buyer);

    // ── Credits past their cycle end cannot be spent; the sweep removes them. ──
    const b = await user();
    await pack(b, 5);
    await grant(b, 50, inDays(30));
    const spent = await debit(b, 20); // 20 subscription
    assert.deepEqual(await buckets(b), [45, 10, 30]);
    await endCycle(b);
    assert.equal(await rpc('public.read_user_balance($1)', [b.auth]), 15);
    const read = await rpc('public.read_user_credits($1)', [b.auth]);
    assert.deepEqual([read.balance, read.free_credits, read.subscription_credits, read.subscription_expires_at], [15, 10, 0, null]);
    const tooMuch = await debit(b, 16);
    assert.deepEqual([tooMuch.ok, tooMuch.code, tooMuch.balance], [false, 'INSUFFICIENT_BALANCE', 15]);
    const within = await debit(b, 12); // 10 free, 2 pack, no subscription
    assert.equal(within.balance_after, 3);
    assert.deepEqual(await parts('job_id = $1', [within.job_id]), [-12, -10, 0]);
    assert.deepEqual(await buckets(b), [33, 0, 30]);

    const swept = await rpc('public.expire_subscription_credits()');
    assert.ok(swept.expired_users >= 1 && swept.expired_credits >= 30, JSON.stringify(swept));
    assert.deepEqual(await buckets(b), [3, 0, 0]);
    assert.deepEqual(await parts(`user_id = $1 AND reason = 'expire:subscription'`, [b.id]), [-30, 0, -30]);
    await reconciles(b);

    // A refund that lands after the cycle returns to the bucket, unspendable,
    // and the next sweep removes it: it never becomes permanent credit.
    const late = await refund(b, spent.job_id, 20);
    assert.deepEqual(await parts('id = $1', [late.entry_id]), [20, 0, 20]);
    assert.deepEqual(await buckets(b), [23, 0, 20]);
    assert.equal(await rpc('public.read_user_balance($1)', [b.auth]), 3);
    assert.equal((await debit(b, 4)).code, 'INSUFFICIENT_BALANCE');
    await rpc('public.expire_subscription_credits()');
    assert.deepEqual(await buckets(b), [3, 0, 0]);
    const idle = await one(`SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id = $1 AND reason = 'expire:subscription'`, [b.id]);
    await rpc('public.expire_subscription_credits()');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id = $1 AND reason = 'expire:subscription'`, [b.id])).n, idle.n);
    await reconciles(b);

    // A sweep "as of" an earlier time leaves a live cycle alone.
    const live = await user();
    await grant(live, 70, inDays(10));
    await rpc('public.expire_subscription_credits()');
    assert.deepEqual(await buckets(live), [80, 10, 70]);
    await rpc('public.expire_subscription_credits($1, 10)', [inDays(11)]);
    assert.deepEqual(await buckets(live), [10, 10, 0]);

    // ── No rollover: a renewal expires what the last cycle left. ──
    const s = await user();
    await grant(s, 100, inDays(30));
    await debit(s, 30);
    const renewed = await grant(s, 100, inDays(60));
    assert.deepEqual([renewed.ok, renewed.expired, renewed.balance_after], [true, 70, 110]);
    assert.deepEqual(await buckets(s), [110, 10, 100]);
    assert.equal(new Date((await rpc('public.read_user_credits($1)', [s.auth])).subscription_expires_at).getTime() > Date.now() + 50 * 86400000, true);
    await reconciles(s);

    // ── Cinema unlocks spend and return the same way. ──
    const title = await one(`SELECT id FROM public.cinema_content ORDER BY created_at LIMIT 1`);
    assert.ok(title, 'the Cinema scripts left a title to unlock');
    const viewer = await user();
    await grant(viewer, 4, inDays(30));
    const unlocked = await rpc(`public.ledger_unlock($1, $2, 6, 'test-consent')`, [viewer.id, title.id]);
    assert.equal(unlocked.ok, true, JSON.stringify(unlocked));
    assert.deepEqual(await parts('id = $1', [unlocked.entry_id]), [-6, -2, -4]);
    assert.deepEqual(await buckets(viewer), [8, 8, 0]);
    const reversed = await rpc(`public.reverse_cinema_unlocks($1, 'test operator', 'subscription bucket test')`, [title.id]);
    assert.equal(reversed.ok, true, JSON.stringify(reversed));
    assert.deepEqual(await buckets(viewer), [14, 10, 4]);
    await reconciles(viewer);

    // ── ledger_grant cannot mint or expire Subscription Credits. ──
    await refused(`SELECT public.ledger_grant($1, 5, 'grant:subscription:in_forged')`, [a.id], '23514');
    await refused(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason) VALUES ($1, -5, 0, 0, 'expire:subscription')`, [a.id], '23514');
    // The tracked parts can never exceed the row.
    await refused(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason) VALUES ($1, 5, 3, 3, 'refund:forged')`, [a.id], '23514');
    await refused(`INSERT INTO public.ledger_entries (user_id, delta, free_delta, subscription_delta, reason) VALUES ($1, 5, 0, -1, 'refund:forged')`, [a.id], '23514');
    // Nor can the buckets exceed the balance, or Subscription Credits lack an end.
    await refused('UPDATE public.credit_balances SET subscription_balance = balance + 1 WHERE user_id = $1', [a.id], '23514');
    await refused('UPDATE public.credit_balances SET subscription_expires_at = NULL WHERE user_id = $1', [a.id], '23514');

    // ── The reconciler sees drift. ──
    await c.query('SAVEPOINT drift');
    await q('UPDATE public.credit_balances SET subscription_balance = subscription_balance - 1 WHERE user_id = $1', [a.id]);
    assert.equal((await q('SELECT * FROM public.reconcile_subscription_credits() WHERE user_id = $1', [a.id])).length, 1);
    await c.query('ROLLBACK TO SAVEPOINT drift');
    await c.query('SAVEPOINT stale');
    await q(`UPDATE public.credit_balances SET subscription_expires_at = now() - interval '3 days' WHERE user_id = $1`, [a.id]);
    assert.equal((await q('SELECT * FROM public.reconcile_subscription_credits() WHERE user_id = $1', [a.id])).length, 1, 'a dead sweep is drift');
    await c.query('ROLLBACK TO SAVEPOINT stale');

    // ── Only the Worker's role may call the new functions. ──
    for (const fn of ['public.subscription_grant(uuid, integer, timestamptz, text)',
        'public.expire_subscription_credits(timestamptz, integer)', 'public.reconcile_subscription_credits()']) {
        const p = await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
            has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [fn]);
        assert.deepEqual([p.anon, p.authed, p.service], [false, false, true], fn);
    }

    await c.query('ROLLBACK');
    console.log('subscription credits: ok');
} catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exitCode = 1;
} finally {
    await c.end();
}
