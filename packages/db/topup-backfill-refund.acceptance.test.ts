/**
 * Backfilling a refunded or partly refunded order — acceptance tests (#142).
 *
 * Exercises credit_top_up_with_refund from
 * schema/supabase/0063_credit_top_up_with_refund.sql: credit_top_up and, when
 * the re-fetched order has a refund, apply_top_up_refund, in one transaction.
 * Built on 0037/0038 (Free Credits), 0041 (top_ups), 0054 (credit_top_up),
 * 0058/0059/0062 (clawback, Freeze) and 0060 (backfill batch), applied twice
 * to prove idempotency. Skipped unless DATABASE_URL is set.
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
    "0054_credit_top_up.sql",
    "0058_top_up_refund_clawback.sql",
    "0059_chargeback_freeze.sql",
    "0060_top_up_backfill.sql",
    "0062_freeze_credits_taken.sql",
    "0063_credit_top_up_with_refund.sql",
    "0066_freeze_since_purchase.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));
const FN = "public.credit_top_up_with_refund(uuid,text,integer,text,text,bigint,bigint)";

// A 300-credit pack at $25.00 pre-tax, $30.00 total with tax.
const CREDITS = 300;
const PRICE = 2500;
const TOTAL = 3000;

describe("Backfilling a refunded order", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    const orderId = () => String(randomInt(1e9, 2e9));

    /** A signed-up user (50 Free Credits) with a pending Top-up returned from checkout long enough ago to be due. */
    async function pendingTopUp() {
        const authId = `sb_${randomUUID()}`;
        const userId = (await pool.query(`SELECT public.signup_grant($1, $2) AS id`,
            [authId, `${randomUUID()}@test.veyrnox.ai`])).rows[0].id as string;
        const packId = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true)`, [packId, CREDITS, PRICE, variant]);
        const res = (await pool.query(
            `SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).rows[0].r;
        assert.equal(res.ok, true);
        const order = orderId();
        assert.equal((await pool.query(`SELECT public.record_top_up_return($1, $2, $3, $4) AS r`,
            [authId, res.top_up_id, order, randomUUID()])).rows[0].r.ok, true);
        await pool.query(`UPDATE public.top_ups SET returned_at = now() - interval '11 minutes' WHERE id = $1`, [res.top_up_id]);
        return { userId, topUpId: res.top_up_id as string, variant, order };
    }

    type T = Awaited<ReturnType<typeof pendingTopUp>>;

    async function backfill(t: T, refunded: number, over: { cents?: number; total?: number; order?: string } = {}) {
        return (await pool.query(`SELECT public.credit_top_up_with_refund($1, $2, $3, 'USD', $4, $5, $6) AS r`,
            [t.topUpId, over.order ?? t.order, over.cents ?? PRICE, t.variant, refunded, over.total ?? TOTAL])).rows[0].r;
    }

    async function state(t: T) {
        const bal = (await pool.query(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [t.userId])).rows[0];
        const rows = (await pool.query(
            `SELECT reason, delta, free_delta FROM ledger_entries WHERE user_id = $1 AND reason <> 'grant:signup' ORDER BY created_at, delta DESC`,
            [t.userId])).rows;
        const topUp = (await pool.query(
            `SELECT status, order_id, refunded_cents, clawed_back_credits FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
        return { balance: bal.balance as number, free: bal.free_balance as number, rows, topUp };
    }

    async function assertInvariants(userId: string) {
        const sums = (await pool.query(
            `SELECT COALESCE(SUM(delta), 0)::int AS total, COALESCE(SUM(COALESCE(free_delta, delta)), 0)::int AS free_total
             FROM ledger_entries WHERE user_id = $1`, [userId])).rows[0];
        const bal = (await pool.query(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId])).rows[0];
        assert.equal(bal.balance, sums.total, "balance = SUM(delta)");
        assert.equal(bal.free_balance, sums.free_total, "free_balance = SUM(free part)");
        const drift = await pool.query(`SELECT 1 FROM public.reconcile_free_credits() WHERE user_id = $1`, [userId]);
        assert.equal(drift.rowCount, 0, "reconcile_free_credits clean");
    }

    it("a partly refunded order is credited, then its refunded share is clawed back", async () => {
        const t = await pendingTopUp();
        const res = await backfill(t, 1500); // half of the $30.00 total
        assert.equal(res.ok, true);
        assert.equal(res.idempotent, false);
        assert.equal(res.refund.ok, true);
        assert.equal(res.refund.taken, 150);

        const s = await state(t);
        assert.deepEqual(s.rows.map((r) => [r.reason, r.delta, r.free_delta]),
            [["grant:topup", 300, 0], ["reverse:topup_refund", -150, 0]]);
        assert.equal(s.balance, 50 + 300 - 150);
        assert.equal(s.free, 50, "Free Credits untouched");
        assert.deepEqual(s.topUp, { status: "credited", order_id: t.order, refunded_cents: 1500, clawed_back_credits: 150 });
        await assertInvariants(t.userId);
    });

    it("running it again changes nothing", async () => {
        const t = await pendingTopUp();
        await backfill(t, 1500);
        const again = await backfill(t, 1500);
        assert.equal(again.ok, true);
        assert.equal(again.idempotent, true);
        assert.equal(again.refund.idempotent, true);
        const s = await state(t);
        assert.equal(s.rows.length, 2);
        assert.equal(s.balance, 200);
        await assertInvariants(t.userId);
    });

    it("a fully refunded order nets to zero Pack Credits and leaves the backfill queue", async () => {
        const t = await pendingTopUp();
        const res = await backfill(t, TOTAL);
        assert.equal(res.refund.taken, 300);
        const s = await state(t);
        assert.equal(s.balance, 50);
        // next_top_up_backfill_batch hands out pending rows only, so it is not retried.
        assert.equal(s.topUp.status, "credited");
        await assertInvariants(t.userId);
    });

    it("generating after checkout started, then a backfilled refund, Freezes the account", async () => {
        const t = await pendingTopUp();
        // 30 Free Credits spent while the order_created webhook is lost.
        const job = (await pool.query(
            `SELECT public.ledger_debit($1, $2, 30, 'debit:generation', 'test-model', '{}'::jsonb) AS r`,
            [t.userId, randomUUID()])).rows[0].r;
        assert.equal(job.ok, true);
        const res = await backfill(t, TOTAL);
        assert.equal(res.refund.frozen, true);
        assert.equal(res.refund.taken, 300);
        assert.equal(res.refund.shortfall, 0);
        const frozen = (await pool.query(`SELECT frozen_at IS NOT NULL AS f FROM public.users WHERE id = $1`, [t.userId])).rows[0].f;
        assert.equal(frozen, true);
        const logged = (await pool.query(
            `SELECT action, top_up_id, credits_taken, credits_shortfall FROM public.account_actions WHERE user_id = $1`,
            [t.userId])).rows;
        assert.deepEqual(logged, [{ action: "freeze", top_up_id: t.topUpId, credits_taken: 300, credits_shortfall: 0 }]);
        await assertInvariants(t.userId);
    });

    it("a backfilled refund with no generation since checkout started does not Freeze", async () => {
        const t = await pendingTopUp();
        const res = await backfill(t, TOTAL);
        assert.equal(res.refund.frozen, false);
        const frozen = (await pool.query(`SELECT frozen_at IS NOT NULL AS f FROM public.users WHERE id = $1`, [t.userId])).rows[0].f;
        assert.equal(frozen, false);
    });

    it("an order without a refund is just credited, with no refund call", async () => {
        const t = await pendingTopUp();
        const res = await backfill(t, 0);
        assert.equal(res.ok, true);
        assert.equal(res.refund, undefined);
        const s = await state(t);
        assert.deepEqual(s.rows.map((r) => r.reason), ["grant:topup"]);
        assert.equal(s.balance, 350);
        await assertInvariants(t.userId);
    });

    it("if the clawback can't be applied, the credit is rolled back and the Top-up stays pending", async () => {
        const t = await pendingTopUp();
        // A refunded amount above the total is refused by apply_top_up_refund.
        await assert.rejects(backfill(t, TOTAL + 1), /credit_top_up_with_refund/);
        const s = await state(t);
        assert.equal(s.rows.length, 0, "no grant left behind without its clawback");
        assert.equal(s.balance, 50);
        assert.equal(s.topUp.status, "pending", "the next run retries it");
        await assertInvariants(t.userId);
    });

    it("the webhook already credited it: the refund is still applied, once", async () => {
        const t = await pendingTopUp();
        assert.equal((await pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [t.topUpId, t.order, PRICE, t.variant])).rows[0].r.ok, true);
        const res = await backfill(t, 1500);
        assert.equal(res.idempotent, true);
        assert.equal(res.refund.taken, 150);
        const s = await state(t);
        assert.equal(s.balance, 200);
        await assertInvariants(t.userId);
    });

    it("a mismatched order is flagged and nothing is granted or clawed back", async () => {
        const t = await pendingTopUp();
        const res = await backfill(t, 1500, { cents: PRICE - 1 });
        assert.equal(res.ok, false);
        assert.equal(res.code, "AMOUNT_MISMATCH");
        assert.equal(res.refund, undefined);
        const s = await state(t);
        assert.equal(s.rows.length, 0);
        assert.equal(s.topUp.status, "pending");
        await assertInvariants(t.userId);
    });

    it("leaves the function to service_role only, with an empty search_path", async () => {
        const priv = (await pool.query(
            `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                    has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                    has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [FN])).rows[0];
        assert.deepEqual(priv, { anon: false, authed: false, service: true });
        const def = (await pool.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [FN])).rows[0];
        assert.equal(def.prosecdef, true);
        assert.deepEqual(def.proconfig, ['search_path=""']);
    });
});
