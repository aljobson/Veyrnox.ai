/**
 * Top-up backfill — acceptance tests (#94, ADR-0018 decision 5).
 *
 * Exercises record_top_up_return and next_top_up_backfill_batch from
 * schema/supabase/0060_top_up_backfill.sql, and the backfill racing the
 * webhook through credit_top_up (0054). Migrations are applied twice to
 * prove idempotency. Skipped unless DATABASE_URL is set.
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
    "0060_top_up_backfill.sql",
    "0064_flag_second_paid_order.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("Top-up backfill", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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
        // Other suites leave due rows behind; only this suite's rows matter.
        await pool.query(`UPDATE public.top_ups SET return_order_id = NULL, return_order_identifier = NULL, returned_at = NULL
                          WHERE status = 'pending' AND return_order_id IS NOT NULL`);
    });

    after(async () => {
        if (pool) await pool.end();
    });

    const orderId = () => String(randomInt(1e9, 2e9));

    async function pendingTopUp({ credits = 300, price = 2500 } = {}) {
        const authId = `sb_${randomUUID()}`;
        const userId = (await pool.query(`SELECT public.signup_grant($1, $2) AS id`,
            [authId, `${randomUUID()}@test.veyrnox.ai`])).rows[0].id as string;
        const packId = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true)`, [packId, credits, price, variant]);
        const res = (await pool.query(
            `SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).rows[0].r;
        assert.equal(res.ok, true);
        return { authId, userId, topUpId: res.top_up_id as string, variant, credits, price };
    }

    async function recordReturn(authId: string, topUpId: string, order: string, identifier: string | null) {
        return (await pool.query(`SELECT public.record_top_up_return($1, $2, $3, $4) AS r`,
            [authId, topUpId, order, identifier])).rows[0].r;
    }

    /** Move a Top-up's clock back, as if created/returned `minutes` ago. */
    async function age(topUpId: string, { createdMin, returnedMin }: { createdMin: number; returnedMin: number }) {
        await pool.query(
            `UPDATE public.top_ups SET created_at = now() - make_interval(mins => $2),
                                       returned_at = now() - make_interval(mins => $3)
             WHERE id = $1`, [topUpId, createdMin, returnedMin]);
    }

    async function batch(limit = 100) {
        return (await pool.query(`SELECT * FROM public.next_top_up_backfill_batch($1)`, [limit])).rows as
            { top_up_id: string; order_id: string; order_identifier: string }[];
    }

    async function credit(topUpId: string, order: string, cents: number, variant: string) {
        return (await pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [topUpId, order, cents, variant])).rows[0].r;
    }

    async function closeReturn(topUpId: string, order: string, identifier?: string) {
        const current = identifier ?? (await pool.query(
            `SELECT return_order_identifier FROM public.top_ups WHERE id = $1`, [topUpId])).rows[0].return_order_identifier;
        return (await pool.query(`SELECT public.close_top_up_return($1, $2, $3) AS r`, [topUpId, order, current])).rows[0].r;
    }

    async function grants(userId: string) {
        return (await pool.query(`SELECT delta FROM ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`, [userId])).rows;
    }

    async function assertBalanceInvariant(userId: string) {
        const r = (await pool.query(
            `SELECT b.balance, (SELECT COALESCE(SUM(delta), 0)::int FROM ledger_entries WHERE user_id = $1) AS total
             FROM credit_balances b WHERE b.user_id = $1`, [userId])).rows[0];
        assert.equal(r.balance, r.total, "balance = SUM(delta)");
    }

    it("records the returned order on the caller's own pending Top-up only", async () => {
        const t = await pendingTopUp();
        const other = await pendingTopUp();
        const order = orderId();
        const identifier = randomUUID();

        assert.deepEqual(await recordReturn(other.authId, t.topUpId, order, identifier),
            { ok: false, code: "TOP_UP_NOT_FOUND" }, "another user's Top-up looks missing");
        assert.deepEqual(await recordReturn(t.authId, randomUUID(), order, identifier), { ok: false, code: "TOP_UP_NOT_FOUND" });
        assert.deepEqual(await recordReturn(t.authId, t.topUpId, "12a", identifier), { ok: false, code: "INVALID_ORDER_ID" });
        assert.deepEqual(await recordReturn(t.authId, t.topUpId, order, null), { ok: false, code: "INVALID_ORDER_IDENTIFIER" });

        assert.deepEqual(await recordReturn(t.authId, t.topUpId, order, identifier), { ok: true });
        const row = (await pool.query(`SELECT * FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
        assert.equal(row.return_order_id, order);
        assert.equal(row.return_order_identifier, identifier);
        assert.ok(row.returned_at);
        assert.equal(row.status, "pending", "recording a return never credits");
        assert.equal((await grants(t.userId)).length, 0);
    });

    it("a repeated return doesn't push the backfill back; a different one resets it", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        const identifier = randomUUID();
        await recordReturn(t.authId, t.topUpId, order, identifier);
        await age(t.topUpId, { createdMin: 30, returnedMin: 20 });
        await recordReturn(t.authId, t.topUpId, order, identifier);
        assert.ok((await batch()).some((r) => r.top_up_id === t.topUpId), "reload of the return page keeps it due");

        const other = orderId();
        await recordReturn(t.authId, t.topUpId, other, identifier);
        const row = (await pool.query(`SELECT return_order_id, backfill_attempts, backfill_checked_at FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
        assert.equal(row.return_order_id, other);
        assert.equal(row.backfill_attempts, 0);
        assert.equal(row.backfill_checked_at, null);
        assert.ok(!(await batch()).some((r) => r.top_up_id === t.topUpId), "a fresh return waits 10 minutes again");
    });

    it("a credited Top-up ignores a return of the order that credited it", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        assert.equal((await credit(t.topUpId, order, t.price, t.variant)).ok, true);
        assert.deepEqual(await recordReturn(t.authId, t.topUpId, order, randomUUID()), { ok: true });
        const row = (await pool.query(`SELECT return_order_id FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
        assert.equal(row.return_order_id, null);
    });

    // #143: a second paid order whose own webhook is lost must still be flagged.
    it("a credited Top-up records a return of a different order, so the backfill can flag it", async () => {
        const t = await pendingTopUp();
        const credited = orderId();
        const second = orderId();
        const identifier = randomUUID();
        assert.equal((await credit(t.topUpId, credited, t.price, t.variant)).ok, true);
        assert.deepEqual(await recordReturn(t.authId, t.topUpId, second, identifier), { ok: true });
        const row = (await pool.query(`SELECT status, order_id, return_order_id FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
        assert.deepEqual(row, { status: "credited", order_id: credited, return_order_id: second });
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });
        const due = (await batch()).find((b) => b.top_up_id === t.topUpId);
        assert.deepEqual(due, { top_up_id: t.topUpId, order_id: second, order_identifier: identifier });
    });

    it("the returned second order is flagged once, grants nothing, and is never handed out again", async () => {
        const t = await pendingTopUp();
        const credited = orderId();
        const second = orderId();
        // Order A returned first and its webhook was lost; order B's webhook credited the Top-up.
        await recordReturn(t.authId, t.topUpId, second, randomUUID());
        assert.equal((await credit(t.topUpId, credited, t.price, t.variant)).ok, true);
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });

        const row = (await batch()).find((b) => b.top_up_id === t.topUpId)!;
        assert.equal(row.order_id, second, "the return survives the Top-up being credited");
        const res = await credit(row.top_up_id, row.order_id, t.price, t.variant);
        assert.deepEqual(res, { ok: false, code: "ALREADY_CREDITED", flagged: true });
        assert.deepEqual(await closeReturn(t.topUpId, second), { ok: true });

        const flags = (await pool.query(`SELECT order_id, reason FROM public.top_up_flagged_orders WHERE top_up_id = $1`, [t.topUpId])).rows;
        assert.deepEqual(flags, [{ order_id: second, reason: "already_credited" }]);
        assert.equal((await grants(t.userId)).length, 1, "only the crediting order granted");
        await assertBalanceInvariant(t.userId);

        await pool.query(`UPDATE public.top_ups SET backfill_checked_at = NULL WHERE id = $1`, [t.topUpId]);
        assert.ok(!(await batch()).some((b) => b.top_up_id === t.topUpId), "closed: no further LemonSqueezy call");
    });

    it("a returned order already flagged (say by its own late webhook) is not handed out", async () => {
        const t = await pendingTopUp();
        const credited = orderId();
        const second = orderId();
        assert.equal((await credit(t.topUpId, credited, t.price, t.variant)).ok, true);
        await recordReturn(t.authId, t.topUpId, second, randomUUID());
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });
        assert.equal((await credit(t.topUpId, second, t.price, t.variant)).flagged, true);
        assert.ok(!(await batch()).some((b) => b.top_up_id === t.topUpId));
    });

    it("closing a return stops the scan; a stale close is ignored and a new return reopens it", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await recordReturn(t.authId, t.topUpId, order, randomUUID());
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });

        assert.deepEqual(await closeReturn(t.topUpId, orderId()), { ok: false, code: "NOT_CURRENT" }, "a close for an older return");
        assert.deepEqual(await closeReturn(t.topUpId, order, randomUUID()), { ok: false, code: "NOT_CURRENT" },
            "same order id, different identifier: a different return");
        assert.ok((await batch()).some((b) => b.top_up_id === t.topUpId));

        assert.deepEqual(await closeReturn(t.topUpId, order), { ok: true });
        await pool.query(`UPDATE public.top_ups SET backfill_checked_at = NULL WHERE id = $1`, [t.topUpId]);
        assert.ok(!(await batch()).some((b) => b.top_up_id === t.topUpId), "closed rows are skipped");

        const next = orderId();
        await recordReturn(t.authId, t.topUpId, next, randomUUID());
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });
        assert.ok((await batch()).some((b) => b.top_up_id === t.topUpId && b.order_id === next), "a different return reopens it");
    });

    it("picks pending returned Top-ups older than 10 minutes and younger than 7 days", async () => {
        const due = await pendingTopUp();
        const tooFresh = await pendingTopUp();
        const tooOld = await pendingTopUp();
        const noReturn = await pendingTopUp();
        const credited = await pendingTopUp();
        for (const t of [due, tooFresh, tooOld, credited]) await recordReturn(t.authId, t.topUpId, orderId(), randomUUID());
        await age(due.topUpId, { createdMin: 60, returnedMin: 11 });
        await age(tooFresh.topUpId, { createdMin: 60, returnedMin: 9 });
        await age(tooOld.topUpId, { createdMin: 7 * 24 * 60 + 1, returnedMin: 7 * 24 * 60 });
        await pool.query(`UPDATE public.top_ups SET created_at = now() - interval '1 hour' WHERE id = $1`, [noReturn.topUpId]);
        await age(credited.topUpId, { createdMin: 60, returnedMin: 30 });
        const r = (await pool.query(`SELECT return_order_id FROM public.top_ups WHERE id = $1`, [credited.topUpId])).rows[0];
        // Credited by the order it returned with: nothing left to check.
        await credit(credited.topUpId, r.return_order_id, credited.price, credited.variant);
        assert.ok(r.return_order_id);

        const ids = (await batch()).map((b) => b.top_up_id);
        assert.ok(ids.includes(due.topUpId));
        for (const t of [tooFresh, tooOld, noReturn, credited]) assert.ok(!ids.includes(t.topUpId));
    });

    it("returns our row's order and identifier, and backs off a row it just handed out", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        const identifier = randomUUID();
        await recordReturn(t.authId, t.topUpId, order, identifier);
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });

        const first = (await batch()).find((b) => b.top_up_id === t.topUpId);
        assert.deepEqual(first, { top_up_id: t.topUpId, order_id: order, order_identifier: identifier });
        assert.ok(!(await batch()).some((b) => b.top_up_id === t.topUpId), "not handed out again straight away");

        // After the backoff it is due again, and each check waits longer.
        await pool.query(`UPDATE public.top_ups SET backfill_checked_at = now() - interval '6 minutes' WHERE id = $1`, [t.topUpId]);
        assert.ok((await batch()).some((b) => b.top_up_id === t.topUpId));
        await pool.query(`UPDATE public.top_ups SET backfill_checked_at = now() - interval '6 minutes' WHERE id = $1`, [t.topUpId]);
        assert.ok(!(await batch()).some((b) => b.top_up_id === t.topUpId), "second retry waits 10 minutes");
        const row = (await pool.query(`SELECT backfill_attempts FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
        assert.equal(row.backfill_attempts, 2);
    });

    it("bounds the batch and never hands the same row to two concurrent runs", async () => {
        const ts = await Promise.all(Array.from({ length: 6 }, () => pendingTopUp()));
        for (const t of ts) {
            await recordReturn(t.authId, t.topUpId, orderId(), randomUUID());
            await age(t.topUpId, { createdMin: 60, returnedMin: 20 });
        }
        assert.equal((await batch(2)).length, 2);
        const [a, b] = await Promise.all([batch(100), batch(100)]);
        const ids = [...a, ...b].map((r) => r.top_up_id).filter((id) => ts.some((t) => t.topUpId === id));
        assert.equal(ids.length, 4, "the other four, once each");
        assert.equal(new Set(ids).size, ids.length);
    });

    it("backfill racing the webhook for the same order grants exactly once", async () => {
        for (let round = 0; round < 5; round++) {
            const t = await pendingTopUp();
            const order = orderId();
            await recordReturn(t.authId, t.topUpId, order, randomUUID());
            await age(t.topUpId, { createdMin: 60, returnedMin: 15 });
            const row = (await batch()).find((b) => b.top_up_id === t.topUpId)!;

            // Webhook: Top-up id from signed custom data. Backfill: from our row.
            const results = await Promise.all([
                credit(t.topUpId, order, t.price, t.variant),
                credit(row.top_up_id, row.order_id, t.price, t.variant),
                credit(t.topUpId, order, t.price, t.variant),
            ]);
            assert.ok(results.every((r) => r.ok === true));
            assert.equal(results.filter((r) => r.idempotent === false).length, 1);
            assert.equal((await grants(t.userId)).length, 1);
            const s = (await pool.query(`SELECT balance FROM credit_balances WHERE user_id = $1`, [t.userId])).rows[0];
            assert.equal(s.balance, 50 + t.credits);
            await assertBalanceInvariant(t.userId);
            assert.ok(!(await batch()).some((b) => b.top_up_id === t.topUpId), "credited rows leave the backfill");
        }
    });

    it("a webhook replay after the backfill credited is a no-op", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await recordReturn(t.authId, t.topUpId, order, randomUUID());
        await age(t.topUpId, { createdMin: 60, returnedMin: 15 });
        const row = (await batch()).find((b) => b.top_up_id === t.topUpId)!;
        assert.equal((await credit(row.top_up_id, row.order_id, t.price, t.variant)).idempotent, false);
        const replay = await credit(t.topUpId, order, t.price, t.variant);
        assert.equal(replay.ok, true);
        assert.equal(replay.idempotent, true);
        assert.equal((await grants(t.userId)).length, 1);
        await assertBalanceInvariant(t.userId);
    });

    it("the new functions are service_role only", async () => {
        for (const fn of ["public.record_top_up_return(text,uuid,text,uuid)", "public.next_top_up_backfill_batch(integer)",
                          "public.close_top_up_return(uuid,text,uuid)"]) {
            for (const role of ["anon", "authenticated"]) {
                const r = (await pool.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, fn])).rows[0];
                assert.equal(r.ok, false, `${role} on ${fn}`);
            }
            const s = (await pool.query(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok`, [fn])).rows[0];
            assert.equal(s.ok, true);
        }
    });
});
