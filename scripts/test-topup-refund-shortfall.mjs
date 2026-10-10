#!/usr/bin/env node
// A Top-up Refund that cannot take back every credit it is owed Freezes the
// account, whatever the credits were spent on (0257, audit 2026-10-09 D-02).
// Runs on the full replayed chain, because the spend path that exposed the
// gap, ledger_unlock, lives far later than the refund acceptance tests'
// fixed migration lists. Throwaway LOCAL database only; everything rolls back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('Refund tests refuse remote databases and non-test database names');
}
const db = new pg.Client({ connectionString });
await db.connect();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const val = async (sql, args = []) => Object.values(await one(sql, args))[0];

// A 300-credit pack at $25.00 pre-tax, $30.00 with tax (the refund
// acceptance tests' fixture).
const CREDITS = 300, PRICE = 2500, TOTAL = 3000;

/** A signed-up user (50 Free Credits) holding a credited 300-credit Top-up. */
async function creditedTopUp() {
    const authId = randomUUID(); // the tenant trigger casts auth_id to uuid
    const userId = await val('SELECT public.signup_grant($1, $2)', [authId, `${randomUUID()}@test.veyrnox.ai`]);
    const packId = `test-${randomUUID().slice(0, 8)}`;
    await db.query(`INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active) VALUES ($1, 'web', $2, $3, true)`, [packId, CREDITS, PRICE]);
    const pending = await val(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600)`, [authId, packId, `test-${randomUUID()}`]);
    const order = `pi_${randomInt(1e9, 2e9)}`;
    const credited = await val(`SELECT public.credit_top_up($1, $2, $3, 'USD', NULL)`, [pending.top_up_id, order, PRICE]);
    assert.equal(credited.ok, true, JSON.stringify(credited));
    // The sign-up grant is whatever signup_grant gives today (10 at the time
    // of writing); every expectation below is relative to it.
    // Everything here runs in one transaction, so now() is frozen: date the
    // purchase a minute back so a job created next counts as "since purchase".
    await db.query("UPDATE public.top_ups SET created_at = now() - interval '1 minute' WHERE id = $1", [pending.top_up_id]);
    const free = (await balances(userId)).free;
    assert.ok(free > 0 && free < CREDITS);
    return { userId, topUpId: pending.top_up_id, order, free };
}
const refund = (order, cents) => val('SELECT public.apply_top_up_refund($1, $2, $3)', [order, cents, TOTAL]);
const frozen = (userId) => val('SELECT frozen_at IS NOT NULL FROM public.users WHERE id = $1', [userId]);
const balances = async (userId) => {
    const b = await one('SELECT balance, free_balance FROM public.credit_balances WHERE user_id = $1', [userId]);
    return { balance: b.balance, free: b.free_balance };
};
const topUp = (id) => one('SELECT clawed_back_credits, shortfall_credits FROM public.top_ups WHERE id = $1', [id]);
const freezes = (userId) => db.query(
    "SELECT credits_taken, credits_shortfall FROM public.account_actions WHERE user_id = $1 AND action = 'freeze' ORDER BY created_at", [userId],
).then((r) => r.rows);
const invariants = async (userId) => {
    const sums = await one('SELECT COALESCE(SUM(delta),0)::int AS total FROM public.ledger_entries WHERE user_id = $1', [userId]);
    assert.equal((await balances(userId)).balance, sums.total, 'balance = SUM(delta)');
    assert.equal((await db.query('SELECT 1 FROM public.reconcile_free_credits() WHERE user_id = $1', [userId])).rowCount, 0);
};

try {
    await db.query('BEGIN');

    await check('a Pack spent on Cinema unlocks and then refunded Freezes the account and records the shortfall', async () => {
        const t = await creditedTopUp();
        // cinema_content hangs off a creator profile, so the buyer is also the creator here.
        await db.query(
            "INSERT INTO public.cinema_profiles(user_id, username, display_name, create_key) VALUES ($1, $2, 'Creator', $3)",
            [t.userId, `c${randomUUID().replace(/-/g, '').slice(0, 20)}`, randomUUID()],
        );
        const content = await val(
            "INSERT INTO public.cinema_content(creator_id, content_type, title, language) VALUES ($1, 'SHORT', 'Unlocked short', 'en') RETURNING id", [t.userId],
        );
        // Free first, then all but 30 of the Pack. No jobs row.
        const spent = t.free + CREDITS - 30;
        const unlock = await val("SELECT public.ledger_unlock($1, $2, $3, 'v1')", [t.userId, content, spent]);
        assert.equal(unlock.ok, true, JSON.stringify(unlock));
        assert.deepEqual(await balances(t.userId), { balance: 30, free: 0 });
        assert.equal(Number(await val('SELECT count(*) FROM public.jobs WHERE user_id = $1', [t.userId])), 0, 'no job to trip the old test');

        const res = await refund(t.order, TOTAL);
        assert.equal(res.ok, true);
        assert.equal(res.taken, 30, 'the 30 Pack Credits still held');
        assert.equal(res.shortfall, 270, 'the 270 spent on the unlock');
        assert.equal(res.frozen, true, 'Frozen on the shortfall (D-02)');
        assert.equal(await frozen(t.userId), true);
        assert.deepEqual(await topUp(t.topUpId), { clawed_back_credits: 30, shortfall_credits: 270 });
        assert.deepEqual(await freezes(t.userId), [{ credits_taken: 30, credits_shortfall: 270 }]);
        assert.deepEqual(await balances(t.userId), { balance: 0, free: 0 });
        // The unlock itself stands; the Freeze is the control, and it stops
        // the next unlock (ledger_unlock checks frozen_at).
        const next = await val("SELECT public.ledger_unlock($1, $2, 1, 'v1')", [t.userId, randomUUID()]).catch((e) => ({ ok: false, code: e.code }));
        assert.notEqual(next.ok, true);
        await invariants(t.userId);
    });

    await check('a replay of that refund changes nothing and does not Freeze again', async () => {
        const t = await creditedTopUp();
        // Free plus all but 20 of the Pack.
        await db.query("SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb)", [t.userId, randomUUID(), t.free + CREDITS - 20]);
        const first = await refund(t.order, TOTAL);
        assert.equal(first.frozen, true);
        const again = await refund(t.order, TOTAL);
        assert.equal(again.idempotent, true);
        assert.equal(again.frozen, false);
        assert.equal((await freezes(t.userId)).length, 1);
        assert.deepEqual(await topUp(t.topUpId), { clawed_back_credits: 20, shortfall_credits: 280 });
    });

    await check('a full refund of an untouched Pack takes everything back and Freezes nobody', async () => {
        const t = await creditedTopUp();
        const res = await refund(t.order, TOTAL);
        assert.equal(res.taken, 300);
        assert.equal(res.shortfall, 0);
        assert.equal(res.frozen, false);
        assert.equal(await frozen(t.userId), false);
        assert.deepEqual(await topUp(t.topUpId), { clawed_back_credits: 300, shortfall_credits: 0 });
        assert.deepEqual(await balances(t.userId), { balance: t.free, free: t.free });
        await invariants(t.userId);
    });

    await check('a job in flight still Freezes even when the clawback takes everything (the pre-0257 rule holds)', async () => {
        const t = await creditedTopUp();
        // The debit comes out of the Free bucket, so the Pack is whole and the
        // clawback has no shortfall; the job alone must trip the Freeze.
        await db.query("SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb)", [t.userId, randomUUID(), t.free]);
        const res = await refund(t.order, TOTAL);
        assert.equal(res.taken, 300);
        assert.equal(res.shortfall, 0);
        assert.equal(res.frozen, true);
        assert.deepEqual(await topUp(t.topUpId), { clawed_back_credits: 300, shortfall_credits: 0 });
        await invariants(t.userId);
    });

    await check('two partial refunds accumulate the shortfall on the Top-up', async () => {
        const t = await creditedTopUp();
        await db.query("SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb)", [t.userId, randomUUID(), t.free + CREDITS - 10]);
        // 10 Pack Credits left. Share of $10 is 100: takes 10, short 90.
        const a = await refund(t.order, 1000);
        assert.deepEqual([a.taken, a.shortfall, a.frozen], [10, 90, true]);
        // Share of the next $20 is 200 more: nothing left, short 200.
        const b = await refund(t.order, TOTAL);
        assert.deepEqual([b.taken, b.shortfall], [0, 200]);
        assert.deepEqual(await topUp(t.topUpId), { clawed_back_credits: 10, shortfall_credits: 290 });
        // freeze_account logs every call, so the second refund leaves a second
        // account_actions row with its own taken/shortfall; the account was
        // already Frozen, so nothing else changes.
        assert.deepEqual(await freezes(t.userId), [{ credits_taken: 10, credits_shortfall: 90 }, { credits_taken: 0, credits_shortfall: 200 }]);
        assert.equal(await frozen(t.userId), true);
        await invariants(t.userId);
    });
} finally {
    await db.query('ROLLBACK');
    await db.end();
}
console.log(`${passed} Top-up Refund shortfall checks passed (fixtures rolled back)`);
