/**
 * Top-up Refund clawback — acceptance tests (#96, ADR-0018 decision 7).
 *
 * Exercises apply_top_up_refund from schema/supabase/0054_top_up_refund_clawback.sql
 * on top of 0037/0038 (Free Credits), 0041 (top_ups) and 0052 (credit_top_up),
 * applied twice to prove idempotency. Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = [
    "0037_free_credit_expiry.sql",
    "0038_free_credit_sweep_fixes.sql",
    "0041_credit_packs_and_top_ups.sql",
    "0052_credit_top_up.sql",
    "0054_top_up_refund_clawback.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

// A 300-credit pack at $25.00 pre-tax, $30.00 total with tax.
const CREDITS = 300;
const PRICE = 2500;
const TOTAL = 3000;

describe("Top-up Refund clawback", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const round of [1, 2]) {
            for (const m of MIGRATIONS) await pool.query(await readFile(m, "utf8"));
        }
    });

    after(async () => {
        if (pool) await pool.end();
    });

    async function one(sql: string, params: unknown[] = []) {
        return (await pool.query(sql, params)).rows[0];
    }

    /** A signed-up user (50 Free Credits) with a credited 300-credit Top-up. */
    async function creditedTopUp() {
        const authId = `sb_${randomUUID()}`;
        const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [authId, `${randomUUID()}@test.veyrnox.ai`])).id as string;
        const packId = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true)`, [packId, CREDITS, PRICE, variant]);
        const pending = (await one(
            `SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).r;
        const order = String(randomInt(1e9, 2e9));
        const credited = (await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [pending.top_up_id, order, PRICE, variant])).r;
        assert.equal(credited.ok, true);
        return { userId, topUpId: pending.top_up_id as string, order };
    }

    async function refund(order: string, refundedCents: number, totalCents = TOTAL) {
        return (await one(`SELECT public.apply_top_up_refund($1, $2, $3) AS r`, [order, refundedCents, totalCents])).r;
    }

    async function debit(userId: string, credits: number) {
        const r = (await one(
            `SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb) AS r`,
            [userId, randomUUID(), credits])).r;
        assert.equal(r.ok, true);
        return r.job_id as string;
    }

    async function balances(userId: string) {
        const b = await one(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId]);
        return { balance: b.balance as number, free: b.free_balance as number };
    }

    async function clawbacks(userId: string) {
        return (await pool.query(
            `SELECT delta, free_delta FROM ledger_entries WHERE user_id = $1 AND reason = 'reverse:topup_refund' ORDER BY created_at`,
            [userId])).rows;
    }

    async function topUp(topUpId: string) {
        return one(`SELECT refunded_cents, clawed_back_credits FROM public.top_ups WHERE id = $1`, [topUpId]);
    }

    /** balance = SUM(delta), free_balance = SUM(free part), reconcile clean. */
    async function assertInvariants(userId: string) {
        const sums = await one(
            `SELECT COALESCE(SUM(delta), 0)::int AS total, COALESCE(SUM(COALESCE(free_delta, delta)), 0)::int AS free_total
             FROM ledger_entries WHERE user_id = $1`, [userId]);
        const b = await balances(userId);
        assert.equal(b.balance, sums.total, "balance = SUM(delta)");
        assert.equal(b.free, sums.free_total, "free_balance = SUM(free part)");
        assert.ok(b.balance >= 0, "balance never below zero");
        const drift = await pool.query(`SELECT 1 FROM public.reconcile_free_credits() WHERE user_id = $1`, [userId]);
        assert.equal(drift.rowCount, 0, "reconcile_free_credits clean");
    }

    it("a full refund claws back every Pack Credit of the Top-up and leaves Free Credits alone", async () => {
        const t = await creditedTopUp();
        const res = await refund(t.order, TOTAL);
        assert.equal(res.ok, true);
        assert.equal(res.idempotent, false);
        assert.equal(res.taken, 300);
        assert.equal(res.shortfall, 0);
        assert.deepEqual(await balances(t.userId), { balance: 50, free: 50 });
        assert.deepEqual(await clawbacks(t.userId), [{ delta: -300, free_delta: 0 }]);
        assert.deepEqual(await topUp(t.topUpId), { refunded_cents: TOTAL, clawed_back_credits: 300 });
        await assertInvariants(t.userId);
    });

    it("two successive partial refunds take only the incremental share, rounded down", async () => {
        const t = await creditedTopUp();
        assert.equal((await refund(t.order, 1000)).taken, 100); // floor(300 * 1000 / 3000)
        assert.equal((await refund(t.order, 2050)).taken, 105); // floor(300 * 2050 / 3000) = 205, less 100
        assert.deepEqual(await clawbacks(t.userId), [{ delta: -100, free_delta: 0 }, { delta: -105, free_delta: 0 }]);
        assert.deepEqual(await topUp(t.topUpId), { refunded_cents: 2050, clawed_back_credits: 205 });
        assert.deepEqual(await balances(t.userId), { balance: 145, free: 50 });
        await assertInvariants(t.userId);
    });

    it("caps the clawback at balance - free_balance: 50 Free + 30 Pack against 300 takes 30", async () => {
        const t = await creditedTopUp();
        // Free first, then Pack; a Credit Refund of the first job puts the
        // 50 Free Credits back while the 270 Pack Credits stay spent.
        const freeJob = await debit(t.userId, 50);
        await debit(t.userId, 270);
        await one(`SELECT public.ledger_refund($1, $2, 50, 'refund:job_failed') AS r`, [freeJob, t.userId]);
        assert.deepEqual(await balances(t.userId), { balance: 80, free: 50 });

        const res = await refund(t.order, TOTAL);
        assert.equal(res.ok, true);
        assert.equal(res.taken, 30);
        assert.equal(res.shortfall, 270);
        assert.deepEqual(await balances(t.userId), { balance: 50, free: 50 });
        assert.deepEqual(await topUp(t.topUpId), { refunded_cents: TOTAL, clawed_back_credits: 30 });
        await assertInvariants(t.userId);
    });

    it("never goes below zero: nothing left to take writes no ledger row", async () => {
        const t = await creditedTopUp();
        await debit(t.userId, 350);
        const res = await refund(t.order, TOTAL);
        assert.equal(res.ok, true);
        assert.equal(res.taken, 0);
        assert.equal(res.shortfall, 300);
        assert.deepEqual(await clawbacks(t.userId), []);
        assert.deepEqual(await balances(t.userId), { balance: 0, free: 0 });
        assert.deepEqual(await topUp(t.topUpId), { refunded_cents: TOTAL, clawed_back_credits: 0 });
        await assertInvariants(t.userId);
    });

    it("a shortfall is not collected from a later refund of the same Top-up", async () => {
        const t = await creditedTopUp();
        await debit(t.userId, 330); // 50 free + 280 pack: 20 Pack Credits left
        assert.equal((await refund(t.order, 1500)).taken, 20); // share 150, capped at 20
        await one(`SELECT public.ledger_grant($1, 500, 'grant:topup') AS r`, [t.userId]); // a later purchase
        assert.equal((await refund(t.order, TOTAL)).taken, 150, "only the new share, not the earlier shortfall");
        assert.deepEqual(await balances(t.userId), { balance: 350, free: 0 });
        await assertInvariants(t.userId);
    });

    it("replaying the same or an older refund amount is a no-op", async () => {
        const t = await creditedTopUp();
        await refund(t.order, 1500);
        const replay = await refund(t.order, 1500);
        assert.equal(replay.ok, true);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.taken, 0);
        const stale = await refund(t.order, 1000);
        assert.equal(stale.idempotent, true);
        assert.equal((await clawbacks(t.userId)).length, 1);
        assert.deepEqual(await topUp(t.topUpId), { refunded_cents: 1500, clawed_back_credits: 150 });
        await assertInvariants(t.userId);
    });

    it("concurrent deliveries of one refund claw back exactly once", async () => {
        const t = await creditedTopUp();
        const results = await Promise.all(Array.from({ length: 8 }, () => refund(t.order, TOTAL)));
        assert.equal(results.filter((r) => r.ok && !r.idempotent).length, 1);
        assert.deepEqual(await clawbacks(t.userId), [{ delta: -300, free_delta: 0 }]);
        assert.deepEqual(await balances(t.userId), { balance: 50, free: 50 });
        await assertInvariants(t.userId);
    });

    it("refuses an unknown order and invalid amounts without moving credits", async () => {
        assert.equal((await refund(String(randomInt(1e9, 2e9)), 100)).code, "ORDER_NOT_FOUND");
        assert.equal((await refund("12ab", 100)).code, "INVALID_ORDER_ID");
        const t = await creditedTopUp();
        for (const [refunded, total] of [[-1, TOTAL], [TOTAL + 1, TOTAL], [100, 0]]) {
            assert.equal((await refund(t.order, refunded, total)).code, "INVALID_AMOUNT", `${refunded}/${total}`);
        }
        assert.deepEqual(await clawbacks(t.userId), []);
        assert.deepEqual(await balances(t.userId), { balance: 350, free: 50 });
        await assertInvariants(t.userId);
    });

    it("a refund for a Top-up not credited yet asks for a retry, then applies once credited", async () => {
        const authId = `sb_${randomUUID()}`;
        const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [authId, `${randomUUID()}@test.veyrnox.ai`])).id as string;
        const packId = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true)`, [packId, CREDITS, PRICE, variant]);
        const pending = (await one(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).r;
        const order = String(randomInt(1e9, 2e9));

        const early = (await one(`SELECT public.apply_top_up_refund($1, $2, $3, $4) AS r`,
            [order, TOTAL, TOTAL, pending.top_up_id])).r;
        assert.equal(early.code, "NOT_CREDITED_YET");

        await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`, [pending.top_up_id, order, PRICE, variant]);
        const late = (await one(`SELECT public.apply_top_up_refund($1, $2, $3, $4) AS r`,
            [order, TOTAL, TOTAL, pending.top_up_id])).r;
        assert.equal(late.taken, 300);
        assert.deepEqual(await balances(userId), { balance: 50, free: 50 });
        await assertInvariants(userId);
    });

    it("a refunded flagged order has nothing to claw back", async () => {
        const t = await creditedTopUp();
        const variant = (await one(`SELECT variant_id FROM public.top_ups WHERE id = $1`, [t.topUpId])).variant_id;
        const second = String(randomInt(1e9, 2e9));
        const flagged = (await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [t.topUpId, second, PRICE, variant])).r;
        assert.equal(flagged.code, "ALREADY_CREDITED");

        const res = await refund(second, TOTAL);
        assert.equal(res.ok, true);
        assert.equal(res.taken, 0);
        assert.equal(res.flagged, true);
        assert.deepEqual(await clawbacks(t.userId), []);
        assert.deepEqual(await balances(t.userId), { balance: 350, free: 50 });
    });
});
