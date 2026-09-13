/**
 * Chargeback Freeze — acceptance tests (#97, ADR-0018 decision 8, ADR-0019).
 *
 * Exercises schema/supabase/0059_chargeback_freeze.sql and
 * 0062_freeze_credits_taken.sql on top of 0037/0038 (Free Credits), 0041
 * (top_ups), 0054 (credit_top_up) and 0058 (apply_top_up_refund), applied
 * twice to prove idempotency. Skipped unless DATABASE_URL is set.
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
    "0062_freeze_credits_taken.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

const CREDITS = 300;
const PRICE = 2500;
const TOTAL = 3000;

describe("Chargeback Freeze", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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
        const pending = (await one(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).r;
        const order = String(randomInt(1e9, 2e9));
        const credited = (await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [pending.top_up_id, order, PRICE, variant])).r;
        assert.equal(credited.ok, true);
        return { authId, userId, packId, topUpId: pending.top_up_id as string, order };
    }

    async function debit(userId: string, credits: number, key = randomUUID()) {
        return (await one(
            `SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb) AS r`,
            [userId, key, credits])).r;
    }

    async function refund(order: string, refundedCents = TOTAL) {
        return (await one(`SELECT public.apply_top_up_refund($1, $2, $3) AS r`, [order, refundedCents, TOTAL])).r;
    }

    async function dispute(order: string, event: "created" | "resolved", reference = `dsp_${randomInt(1e6, 9e6)}`) {
        return (await one(`SELECT public.apply_dispute_event($1, $2, $3) AS r`, [order, event, reference])).r;
    }

    async function unfreeze(userId: string, operator: string | null, reason: string | null) {
        return (await one(`SELECT public.unfreeze_account($1, $2, $3) AS r`, [userId, operator, reason])).r;
    }

    async function frozen(userId: string) {
        return (await one(`SELECT frozen_at IS NOT NULL AS f FROM public.users WHERE id = $1`, [userId])).f as boolean;
    }

    async function actions(userId: string) {
        return (await pool.query(
            `SELECT action, actor, top_up_id FROM public.account_actions WHERE user_id = $1 ORDER BY created_at, id`,
            [userId])).rows;
    }

    async function assertInvariants(userId: string) {
        const sums = await one(
            `SELECT COALESCE(SUM(delta), 0)::int AS total, COALESCE(SUM(COALESCE(free_delta, delta)), 0)::int AS free_total
             FROM ledger_entries WHERE user_id = $1`, [userId]);
        const b = await one(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId]);
        assert.equal(b.balance, sums.total, "balance = SUM(delta)");
        assert.equal(b.free_balance, sums.free_total, "free_balance = SUM(free part)");
        const drift = await pool.query(`SELECT 1 FROM public.reconcile_free_credits() WHERE user_id = $1`, [userId]);
        assert.equal(drift.rowCount, 0, "reconcile_free_credits clean");
    }

    it("a refund after generating since the Top-up Freezes the account", async () => {
        const t = await creditedTopUp();
        assert.equal((await debit(t.userId, 60)).ok, true);
        const res = await refund(t.order);
        assert.equal(res.ok, true);
        assert.equal(res.frozen, true);
        assert.equal(await frozen(t.userId), true);
        assert.deepEqual(await actions(t.userId), [{ action: "freeze", actor: "system", top_up_id: t.topUpId }]);
        // 60 generated: 50 Free Credits then 10 Pack Credits. The full refund
        // owes 300 but only 290 Pack Credits are left: 10 written off.
        assert.equal(res.taken, 290);
        assert.equal(res.shortfall, 10);
        const logged = await one(
            `SELECT credits_taken, credits_shortfall FROM public.account_actions WHERE user_id = $1 AND action = 'freeze'`,
            [t.userId]);
        assert.deepEqual(logged, { credits_taken: 290, credits_shortfall: 10 });
        await assertInvariants(t.userId);
    });

    it("a refund with no generation since the Top-up does not Freeze", async () => {
        const t = await creditedTopUp();
        const res = await refund(t.order);
        assert.equal(res.frozen, false);
        assert.equal(await frozen(t.userId), false);
        assert.deepEqual(await actions(t.userId), []);
    });

    it("a job that ended in a Credit Refund does not count as generated", async () => {
        const t = await creditedTopUp();
        const job = await debit(t.userId, 60);
        await one(`SELECT public.ledger_refund($1, $2, 60, 'refund:job_failed') AS r`, [job.job_id, t.userId]);
        assert.equal((await refund(t.order)).frozen, false);
        assert.equal(await frozen(t.userId), false);
    });

    it("a Frozen account's debit returns ACCOUNT_FROZEN; a pre-Freeze key still replays its job", async () => {
        const t = await creditedTopUp();
        const key = randomUUID();
        const before = await debit(t.userId, 10, key);
        await refund(t.order);
        assert.equal(await frozen(t.userId), true);

        const blocked = await debit(t.userId, 10);
        assert.equal(blocked.ok, false);
        assert.equal(blocked.code, "ACCOUNT_FROZEN");

        const replay = await debit(t.userId, 10, key);
        assert.equal(replay.ok, true);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.job_id, before.job_id);
        await assertInvariants(t.userId);
    });

    it("a Frozen account cannot start a Top-up", async () => {
        const t = await creditedTopUp();
        await debit(t.userId, 10);
        await refund(t.order);
        const res = (await one(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [t.authId, t.packId, `test-${randomUUID()}`])).r;
        assert.equal(res.ok, false);
        assert.equal(res.code, "ACCOUNT_FROZEN");
    });

    it("a replayed refund does not re-Freeze an unfrozen account; a larger one does", async () => {
        const t = await creditedTopUp();
        await debit(t.userId, 10);
        await refund(t.order, 1500);
        assert.equal((await unfreeze(t.userId, "Al Jobson", "Dispute withdrawn by the buyer")).ok, true);

        await refund(t.order, 1500);
        assert.equal(await frozen(t.userId), false, "replay is a no-op");
        await refund(t.order, TOTAL);
        assert.equal(await frozen(t.userId), true, "a new refund amount after spending Freezes again");
    });

    it("unfreeze needs an Operator name and a reason, logs it, and debits spend Free Credits first again", async () => {
        const t = await creditedTopUp();
        await debit(t.userId, 10); // takes 10 of the 50 Free Credits
        await refund(t.order);

        for (const [op, why] of [[null, "Buyer withdrew the dispute"], ["  ", "Buyer withdrew the dispute"], ["Al Jobson", ""], ["Al Jobson", "   "], ["Al Jobson", null]]) {
            const res = await unfreeze(t.userId, op, why);
            assert.equal(res.ok, false, `${op} / ${why}`);
            assert.equal(res.code, "OPERATOR_AND_REASON_REQUIRED");
        }
        assert.equal(await frozen(t.userId), true);

        const res = await unfreeze(t.userId, "Al Jobson", "Buyer withdrew the dispute");
        assert.equal(res.ok, true);
        assert.equal(await frozen(t.userId), false);
        assert.deepEqual((await actions(t.userId)).map((a) => [a.action, a.actor]),
            [["freeze", "system"], ["unfreeze", "Al Jobson"]]);
        assert.equal((await unfreeze(t.userId, "Al Jobson", "Again")).code, "NOT_FROZEN");

        const after = await debit(t.userId, 25);
        assert.equal(after.ok, true);
        const b = await one(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [t.userId]);
        assert.deepEqual({ balance: b.balance, free: b.free_balance }, { balance: 15, free: 15 }, "25 of the 40 Free Credits left");
        await assertInvariants(t.userId);
    });

    it("dispute_created Freezes the order's owner; freezing again only appends to the log", async () => {
        const t = await creditedTopUp();
        const res = await dispute(t.order, "created");
        assert.equal(res.ok, true);
        assert.equal(res.user_id, t.userId);
        assert.equal(res.already_frozen, false);
        const firstFrozenAt = (await one(`SELECT frozen_at FROM public.users WHERE id = $1`, [t.userId])).frozen_at;

        const again = await dispute(t.order, "created");
        assert.equal(again.already_frozen, true);
        const stillFrozenAt = (await one(`SELECT frozen_at FROM public.users WHERE id = $1`, [t.userId])).frozen_at;
        assert.equal(stillFrozenAt.getTime(), firstFrozenAt.getTime(), "frozen_at unchanged");
        assert.deepEqual((await actions(t.userId)).map((a) => a.action), ["freeze", "freeze"]);
    });

    it("dispute_resolved only appends to the log and never unfreezes", async () => {
        const t = await creditedTopUp();
        await dispute(t.order, "created");
        const res = await dispute(t.order, "resolved");
        assert.equal(res.ok, true);
        assert.equal(await frozen(t.userId), true);
        assert.deepEqual((await actions(t.userId)).map((a) => [a.action, a.actor]),
            [["freeze", "system"], ["dispute_resolved", "system"]]);
    });

    it("a dispute for an order with no credited Top-up Freezes nobody", async () => {
        const res = await dispute(String(randomInt(1e9, 2e9)), "created");
        assert.equal(res.ok, false);
        assert.equal(res.code, "TOP_UP_NOT_FOUND");
        assert.equal((await dispute("not-a-number", "created")).code, "INVALID_ORDER_ID");
    });

    it("the account-action log is append-only", async () => {
        const t = await creditedTopUp();
        await dispute(t.order, "created");
        await assert.rejects(pool.query(`UPDATE public.account_actions SET reason = 'x' WHERE user_id = $1`, [t.userId]), /append-only/i);
        await assert.rejects(pool.query(`DELETE FROM public.account_actions WHERE user_id = $1`, [t.userId]), /append-only/i);
    });

    it("keeps new objects service_role only, SECURITY DEFINER with an empty search_path, RLS forced", async () => {
        for (const fn of ["public.apply_dispute_event(text,text,text)", "public.unfreeze_account(uuid,text,text)"]) {
            const row = await one(
                `SELECT p.prosecdef, p.proconfig,
                        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                        has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
                 FROM pg_proc p WHERE p.oid = $1::regprocedure`, [fn]);
            assert.equal(row.prosecdef, true, fn);
            assert.deepEqual(row.proconfig, ['search_path=""'], fn);
            assert.deepEqual([row.anon, row.auth, row.svc], [false, false, true], fn);
        }
        const internal = await one(
            `SELECT has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS svc,
                    has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth`,
            ["public.freeze_account(uuid,text,uuid,integer,integer)"]);
        assert.deepEqual([internal.svc, internal.auth], [false, false], "freeze_account is internal");
        const rls = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.account_actions'::regclass`);
        assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, true]);
    });
});
