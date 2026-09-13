/**
 * Operator Top-up reads and Top-up reconciliation — acceptance tests (#98).
 *
 * Exercises schema/supabase/0065_operator_top_up_reads.sql on top of 0037/0038
 * (Free Credits), 0041 (top_ups), 0054 (credit_top_up), 0058/0059/0062
 * (clawback, Freeze) and 0060 (backfill columns), applied twice to prove
 * idempotency. Skipped unless DATABASE_URL is set.
 *
 * Drift is seeded inside a transaction that is rolled back, so the shared
 * test database never keeps an inconsistent row. Some checks guard states a
 * CHECK constraint already forbids; those cases drop the constraint inside the
 * same rolled-back transaction.
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
    "0065_operator_top_up_reads.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

// A 300-credit pack at $25.00 pre-tax, $30.00 total with tax.
const CREDITS = 300;
const PRICE = 2500;
const TOTAL = 3000;

describe("Operator Top-up reads and reconciliation", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
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

    const orderId = () => String(randomInt(1e9, 2e9));

    /** A signed-up user (50 Free Credits) with a pack and a pending Top-up. */
    async function pendingTopUp(existing?: { authId: string; userId: string; packId: string; variant: string }) {
        let u = existing;
        if (!u) {
            const authId = `sb_${randomUUID()}`;
            const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`,
                [authId, `${randomUUID()}@test.veyrnox.ai`])).id as string;
            const packId = `test-${randomUUID().slice(0, 8)}`;
            const variant = String(randomInt(1e9, 2e9));
            await pool.query(
                `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
                 VALUES ($1, 'web', $2, $3, $4, true)`, [packId, CREDITS, PRICE, variant]);
            u = { authId, userId, packId, variant };
        }
        const res = (await one(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [u.authId, u.packId, `test-${randomUUID()}`])).r;
        assert.equal(res.ok, true);
        return { ...u, topUpId: res.top_up_id as string, order: orderId() };
    }

    type T = Awaited<ReturnType<typeof pendingTopUp>>;

    async function credit(t: T) {
        const res = (await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [t.topUpId, t.order, PRICE, t.variant])).r;
        assert.equal(res.ok, true);
        return t;
    }

    async function debit(userId: string, credits: number) {
        return (await one(
            `SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb) AS r`,
            [userId, randomUUID(), credits])).r;
    }

    async function refund(t: T, refundedCents: number) {
        return (await one(`SELECT public.apply_top_up_refund($1, $2, $3) AS r`, [t.order, refundedCents, TOTAL])).r;
    }

    async function problems(userId: string) {
        return (await pool.query(
            `SELECT problem, top_up_id FROM public.reconcile_top_ups() WHERE user_id = $1 ORDER BY problem`,
            [userId])).rows;
    }

    /** Run `seed` and read reconcile_top_ups for the user in one transaction, then roll it back. */
    async function problemsAfter(userId: string, seed: (c: pg.PoolClient) => Promise<unknown>) {
        const c = await pool.connect();
        try {
            await c.query("BEGIN");
            await seed(c);
            return (await c.query(
                `SELECT problem, top_up_id FROM public.reconcile_top_ups() WHERE user_id = $1 ORDER BY problem`,
                [userId])).rows;
        } finally {
            await c.query("ROLLBACK");
            c.release();
        }
    }

    // ── Reads ────────────────────────────────────────────────────────────

    it("operator_user_top_ups lists a user's Top-ups with status, order, refund totals and backfill state", async () => {
        const a = await credit(await pendingTopUp());
        await refund(a, 1500); // half of the total: 150 of 300 credits back
        const b = await pendingTopUp(a);
        await one(`SELECT public.record_top_up_return($1, $2, $3, $4) AS r`, [b.authId, b.topUpId, b.order, randomUUID()]);
        const other = await pendingTopUp();

        const rows = (await pool.query(`SELECT * FROM public.operator_user_top_ups($1)`, [a.userId])).rows;
        const byId = Object.fromEntries(rows.map((r) => [r.top_up_id, r]));
        assert.deepEqual(Object.keys(byId).sort(), [a.topUpId, b.topUpId].sort(), "only this user's Top-ups");
        assert.equal(byId[other.topUpId], undefined);

        const credited = byId[a.topUpId];
        assert.equal(credited.status, "credited");
        assert.equal(credited.order_id, a.order);
        assert.equal(credited.credits, CREDITS);
        assert.equal(credited.price_usd_cents, PRICE);
        assert.equal(credited.refunded_cents, 1500);
        assert.equal(credited.clawed_back_credits, 150);
        assert.ok(credited.credited_at instanceof Date);

        const pending = byId[b.topUpId];
        assert.equal(pending.status, "pending");
        assert.equal(pending.order_id, null);
        assert.equal(pending.return_order_id, b.order);
        assert.ok(pending.returned_at instanceof Date);
        assert.equal(pending.backfill_attempts, 0);

        assert.equal("email" in credited, false, "no PII beyond ids");
        assert.equal((await pool.query(`SELECT * FROM public.operator_user_top_ups($1)`, [randomUUID()])).rowCount, 0);
    });

    it("operator_top_up_generated_since uses the Freeze definition: a job after crediting that was not refunded", async () => {
        const t = await credit(await pendingTopUp());
        const read = async (id: string) => (await one(`SELECT public.operator_top_up_generated_since($1) AS r`, [id])).r;

        let r = await read(t.topUpId);
        assert.equal(r.ok, true);
        assert.equal(r.user_id, t.userId);
        assert.equal(r.generated_since, false, "nothing generated");

        const job = await debit(t.userId, 60);
        await one(`SELECT public.ledger_refund($1, $2, 60, 'refund:job_failed') AS r`, [job.job_id, t.userId]);
        assert.equal((await read(t.topUpId)).generated_since, false, "a Credit Refunded job does not count");

        await debit(t.userId, 10);
        r = await read(t.topUpId);
        assert.equal(r.generated_since, true);

        const pending = await pendingTopUp();
        assert.deepEqual(await read(pending.topUpId), { ok: false, code: "NOT_CREDITED" });
        assert.deepEqual(await read(randomUUID()), { ok: false, code: "TOP_UP_NOT_FOUND" });
    });

    it("operator_pending_top_ups lists Top-ups pending longer than N minutes, never credited ones", async () => {
        const old = await pendingTopUp();
        await pool.query(`UPDATE public.top_ups SET created_at = now() - interval '30 minutes' WHERE id = $1`, [old.topUpId]);
        const fresh = await pendingTopUp();
        const credited = await credit(await pendingTopUp());
        await pool.query(`UPDATE public.top_ups SET created_at = now() - interval '30 minutes' WHERE id = $1`, [credited.topUpId]);

        const ids = async (minutes: number) => (await pool.query(
            `SELECT top_up_id FROM public.operator_pending_top_ups($1, 500)`, [minutes])).rows.map((r) => r.top_up_id);
        const at20 = await ids(20);
        assert.ok(at20.includes(old.topUpId));
        assert.ok(!at20.includes(fresh.topUpId), "not pending long enough");
        assert.ok(!at20.includes(credited.topUpId), "credited");
        assert.ok(!(await ids(40)).includes(old.topUpId));
    });

    it("operator_flagged_orders lists paid orders that were never granted", async () => {
        const t = await pendingTopUp();
        const flagged = (await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [t.topUpId, t.order, PRICE - 1, t.variant])).r;
        assert.equal(flagged.code, "AMOUNT_MISMATCH");

        const rows = (await pool.query(`SELECT * FROM public.operator_flagged_orders($1, 100)`, [t.userId])).rows;
        assert.deepEqual(rows.map((r) => [r.order_id, r.top_up_id, r.reason, r.paid_usd_cents]),
            [[t.order, t.topUpId, "amount_mismatch", PRICE - 1]]);
        const all = (await pool.query(`SELECT order_id FROM public.operator_flagged_orders(NULL, 500)`)).rows;
        assert.ok(all.some((r) => r.order_id === t.order), "NULL user lists every user's");
    });

    it("operator_account_actions lists Freezes and unfreezes with credits taken and written off", async () => {
        const t = await credit(await pendingTopUp());
        await debit(t.userId, 60); // 50 Free Credits then 10 Pack Credits
        assert.equal((await refund(t, TOTAL)).frozen, true);
        assert.equal((await one(`SELECT public.unfreeze_account($1, 'Al Jobson', 'Reviewed') AS r`, [t.userId])).r.ok, true);

        const rows = (await pool.query(`SELECT * FROM public.operator_account_actions($1, 100)`, [t.userId])).rows;
        assert.deepEqual(rows.map((r) => [r.action, r.actor, r.top_up_id, r.credits_taken, r.credits_shortfall]), [
            ["unfreeze", "Al Jobson", null, null, null],
            ["freeze", "system", t.topUpId, 290, 10],
        ], "newest first");
        assert.equal(rows[0].frozen, false, "current Frozen state of the user");
    });

    // ── Reconciliation ───────────────────────────────────────────────────

    it("reconcile_top_ups is clean after credit, partial refunds, Freeze and unfreeze", async () => {
        const t = await credit(await pendingTopUp());
        await debit(t.userId, 60);
        await refund(t, 1000);
        await refund(t, TOTAL);
        await one(`SELECT public.unfreeze_account($1, 'Al Jobson', 'Reviewed') AS r`, [t.userId]);
        await credit(await pendingTopUp(t));
        await pendingTopUp(t);
        assert.deepEqual(await problems(t.userId), []);

        const freshUser = await pendingTopUp();
        assert.deepEqual(await problems(freshUser.userId), [], "a user with only a pending Top-up");
    });

    it("reports a credited Top-up whose grant entry is not its grant:topup row of its credits", async () => {
        const t = await credit(await pendingTopUp());
        const rows = await problemsAfter(t.userId, (c) => c.query(
            `UPDATE public.top_ups SET grant_entry_id =
                 (SELECT id FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup')
             WHERE id = $2`, [t.userId, t.topUpId]));
        assert.deepEqual(rows, [
            { problem: "grant_entry_mismatch", top_up_id: t.topUpId },
            { problem: "unlinked_topup_grant", top_up_id: null },
        ]);
    });

    it("reports a grant:topup ledger row that no Top-up links to", async () => {
        const t = await credit(await pendingTopUp());
        const rows = await problemsAfter(t.userId, (c) =>
            c.query(`SELECT public.ledger_grant($1, 100, 'grant:topup')`, [t.userId]));
        assert.deepEqual(rows, [{ problem: "unlinked_topup_grant", top_up_id: null }]);
    });

    it("reports credits clawed back that do not match the user's reverse:topup_refund rows", async () => {
        const t = await credit(await pendingTopUp());
        await refund(t, 1500);
        const rows = await problemsAfter(t.userId, (c) =>
            c.query(`UPDATE public.top_ups SET clawed_back_credits = clawed_back_credits + 1 WHERE id = $1`, [t.topUpId]));
        assert.deepEqual(rows, [{ problem: "clawback_ledger_mismatch", top_up_id: null }]);
    });

    it("reports credits clawed back exceeding the Top-up's credits", async () => {
        const t = await credit(await pendingTopUp());
        const rows = await problemsAfter(t.userId, async (c) => {
            await c.query(`ALTER TABLE public.top_ups DROP CONSTRAINT top_ups_refund_amounts`);
            await c.query(`UPDATE public.top_ups SET clawed_back_credits = credits + 1 WHERE id = $1`, [t.topUpId]);
        });
        assert.ok(rows.some((r) => r.problem === "clawback_exceeds_credits" && r.top_up_id === t.topUpId), JSON.stringify(rows));
    });

    it("reports a credited Top-up without an order id", async () => {
        const t = await credit(await pendingTopUp());
        const rows = await problemsAfter(t.userId, async (c) => {
            await c.query(`ALTER TABLE public.top_ups DROP CONSTRAINT top_ups_credited_complete`);
            await c.query(`UPDATE public.top_ups SET order_id = NULL WHERE id = $1`, [t.topUpId]);
        });
        assert.deepEqual(rows, [{ problem: "credited_without_order", top_up_id: t.topUpId }]);
    });

    it("reports a Frozen marker that disagrees with the account-action log, either way", async () => {
        const clean = await pendingTopUp();
        assert.deepEqual(await problemsAfter(clean.userId, (c) =>
            c.query(`UPDATE public.users SET frozen_at = now() WHERE id = $1`, [clean.userId])),
        [{ problem: "frozen_state_mismatch", top_up_id: null }], "frozen with no Freeze logged");

        const t = await credit(await pendingTopUp());
        await debit(t.userId, 10);
        assert.equal((await refund(t, TOTAL)).frozen, true);
        assert.deepEqual(await problems(t.userId), [], "a logged Freeze is consistent");
        assert.deepEqual(await problemsAfter(t.userId, (c) =>
            c.query(`UPDATE public.users SET frozen_at = NULL WHERE id = $1`, [t.userId])),
        [{ problem: "frozen_state_mismatch", top_up_id: null }], "last logged action is a Freeze but not frozen");
    });

    it("does not report a Freeze and an unfreeze in one transaction, which share a timestamp", async () => {
        const t = await credit(await pendingTopUp());
        await debit(t.userId, 10);
        const rows = await problemsAfter(t.userId, async (c) => {
            const res = (await c.query(`SELECT public.apply_top_up_refund($1, $2, $3) AS r`, [t.order, TOTAL, TOTAL])).rows[0].r;
            assert.equal(res.frozen, true);
            assert.equal((await c.query(`SELECT public.unfreeze_account($1, 'Al Jobson', 'Reviewed') AS r`, [t.userId])).rows[0].r.ok, true);
            const tie = (await c.query(
                `SELECT count(DISTINCT created_at)::int AS n FROM public.account_actions WHERE user_id = $1`, [t.userId])).rows[0];
            assert.equal(tie.n, 1, "same transaction time");
        });
        assert.deepEqual(rows, []);
    });

    it("keeps the new functions service_role only, SECURITY DEFINER with an empty search_path", async () => {
        for (const fn of [
            "public.operator_user_top_ups(uuid)",
            "public.operator_top_up_generated_since(uuid)",
            "public.operator_pending_top_ups(integer,integer)",
            "public.operator_flagged_orders(uuid,integer)",
            "public.operator_account_actions(uuid,integer)",
            "public.reconcile_top_ups()",
        ]) {
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
    });
});
