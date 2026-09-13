/**
 * Order sweep for credited Top-ups — acceptance tests (#143).
 *
 * A second paid order for a credited Top-up whose webhook is lost, and whose
 * buyer never came back from checkout, is found by listing the owner's
 * LemonSqueezy orders. Exercises next_top_up_order_sweep_batch and
 * flag_swept_top_up_order from schema/supabase/0068_backfill_order_binding.sql:
 * the sweep only ever flags, never grants. Applied twice to prove
 * idempotency. Skipped unless DATABASE_URL is set.
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
    "0064_flag_second_paid_order.sql",
    "0065_operator_top_up_reads.sql",
    "0066_freeze_since_purchase.sql",
    "0068_backfill_order_binding.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

const PRICE = 2500;

describe("Order sweep for credited Top-ups", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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
        // Other suites leave credited rows behind; only this suite's rows matter.
        await pool.query(`UPDATE public.top_ups SET order_sweeps = 4 WHERE status = 'credited'`);
    });

    after(async () => {
        if (pool) await pool.end();
    });

    const orderId = () => String(randomInt(1e9, 2e9));

    async function user() {
        const authId = `sb_${randomUUID()}`;
        const email = `${randomUUID()}@test.veyrnox.ai`;
        const userId = (await pool.query(`SELECT public.signup_grant($1, $2) AS id`, [authId, email])).rows[0].id as string;
        return { authId, email, userId };
    }

    /** A Top-up for `owner`, created `ageMin` minutes ago. */
    async function topUp(owner?: Awaited<ReturnType<typeof user>>, { variant = String(randomInt(1e9, 2e9)), ageMin = 120 } = {}) {
        const u = owner ?? await user();
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', 300, $2, $3, true) ON CONFLICT (sales_channel, variant_id) DO NOTHING`,
            [`test-${randomUUID().slice(0, 8)}`, PRICE, variant]);
        const packId = (await pool.query(`SELECT id FROM public.credit_packs WHERE variant_id = $1`, [variant])).rows[0].id;
        const res = (await pool.query(
            `SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 100, 600) AS r`,
            [u.authId, packId, `test-${randomUUID()}`])).rows[0].r;
        assert.equal(res.ok, true);
        await pool.query(`UPDATE public.top_ups SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [res.top_up_id, ageMin]);
        return { ...u, topUpId: res.top_up_id as string, variant };
    }

    type T = Awaited<ReturnType<typeof topUp>>;

    async function credit(t: T, order = orderId()) {
        const r = (await pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`, [t.topUpId, order, PRICE, t.variant])).rows[0].r;
        assert.equal(r.ok, true);
        return order;
    }

    async function sweepBatch(limit = 100) {
        return (await pool.query(`SELECT * FROM public.next_top_up_order_sweep_batch($1)`, [limit])).rows as
            { top_up_id: string; order_id: string; variant_id: string; created_at: Date; user_email: string }[];
    }

    async function flag(t: T, order: string, over: { email?: string; createdAt?: string; variant?: string } = {}) {
        return (await pool.query(`SELECT public.flag_swept_top_up_order($1, $2, $3, $4, $5, 'USD', $6) AS r`,
            [t.topUpId, order, over.email ?? t.email, over.createdAt ?? new Date().toISOString(), PRICE, over.variant ?? t.variant])).rows[0].r;
    }

    async function flags(order: string) {
        return (await pool.query(`SELECT top_up_id, reason, paid_usd_cents FROM public.top_up_flagged_orders WHERE order_id = $1`, [order])).rows;
    }

    async function grants(userId: string) {
        return (await pool.query(`SELECT 1 FROM ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`, [userId])).rowCount;
    }

    const setSweeps = (t: T, n: number) => pool.query(`UPDATE public.top_ups SET order_sweeps = $2 WHERE id = $1`, [t.topUpId, n]);

    it("hands out credited Top-ups on a fixed schedule from creation: 70 minutes, 6 hours, 1 day, 3 days", async () => {
        const t = await topUp(undefined, { ageMin: 71 });
        const order = await credit(t);
        const fresh = await topUp(undefined, { ageMin: 60 });
        await credit(fresh);
        const pending = await topUp(undefined, { ageMin: 200 });
        const old = await topUp(undefined, { ageMin: 7 * 24 * 60 + 1 });
        await credit(old);

        const first = await sweepBatch();
        const mine = first.find((r) => r.top_up_id === t.topUpId)!;
        assert.equal(mine.order_id, order);
        assert.equal(mine.variant_id, t.variant);
        assert.equal(mine.user_email, t.email);
        for (const x of [fresh, pending, old]) assert.ok(!first.some((r) => r.top_up_id === x.topUpId));
        assert.ok(!(await sweepBatch()).some((r) => r.top_up_id === t.topUpId), "next sweep waits for 6 hours");

        for (const [ageMin, sweeps] of [[6 * 60 + 1, 1], [24 * 60 + 1, 2], [72 * 60 + 1, 3]]) {
            await pool.query(`UPDATE public.top_ups SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [t.topUpId, ageMin]);
            const row = (await pool.query(`SELECT order_sweeps FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
            assert.equal(row.order_sweeps, sweeps);
            assert.ok((await sweepBatch()).some((r) => r.top_up_id === t.topUpId), `sweep ${sweeps + 1}`);
        }
        await pool.query(`UPDATE public.top_ups SET created_at = now() - interval '6 days' WHERE id = $1`, [t.topUpId]);
        assert.ok(!(await sweepBatch()).some((r) => r.top_up_id === t.topUpId), "four sweeps, then never again");
    });

    it("bounds the batch and never hands the same Top-up to two concurrent runs", async () => {
        const ts = await Promise.all(Array.from({ length: 6 }, () => topUp(undefined, { ageMin: 90 })));
        for (const t of ts) await credit(t);
        assert.equal((await sweepBatch(2)).length, 2);
        const [a, b] = await Promise.all([sweepBatch(100), sweepBatch(100)]);
        const ids = [...a, ...b].map((r) => r.top_up_id).filter((id) => ts.some((t) => t.topUpId === id));
        assert.equal(ids.length, 4);
        assert.equal(new Set(ids).size, 4);
    });

    it("flags a second paid order as already_credited once, and grants nothing", async () => {
        const t = await topUp();
        await credit(t);
        const second = orderId();
        assert.deepEqual(await flag(t, second), { ok: true, flagged: true, idempotent: false });
        assert.deepEqual(await flag(t, second), { ok: true, flagged: true, idempotent: true });
        assert.deepEqual(await flags(second), [{ top_up_id: t.topUpId, reason: "already_credited", paid_usd_cents: PRICE }]);
        assert.equal(await grants(t.userId), 1);
        const seen = (await pool.query(`SELECT order_id, top_up_id, reason FROM public.operator_flagged_orders($1, 10)`, [t.userId])).rows;
        assert.deepEqual(seen, [{ order_id: second, top_up_id: t.topUpId, reason: "already_credited" }], "#98's Operator read shows it");

        // Its late refund takes nothing back: it was never granted.
        const refund = (await pool.query(`SELECT public.apply_top_up_refund($1, 3000, 3000) AS r`, [second])).rows[0].r;
        assert.equal(refund.flagged, true);
        assert.equal(refund.taken, 0);
    });

    it("an order already credited to any Top-up is known, never flagged", async () => {
        const t = await topUp();
        const own = await credit(t);
        const sibling = await topUp(t, { variant: t.variant });
        const siblings = await credit(sibling);
        assert.deepEqual(await flag(t, own), { ok: false, code: "KNOWN_ORDER" });
        assert.deepEqual(await flag(t, siblings), { ok: false, code: "KNOWN_ORDER" });
        assert.equal((await flags(own)).length + (await flags(siblings)).length, 0);
    });

    it("an order that could pay the owner's pending Top-up of the same pack is ambiguous, never flagged", async () => {
        const t = await topUp(undefined, { ageMin: 300 });
        await credit(t);
        const pending = await topUp(t, { variant: t.variant, ageMin: 30 });
        const order = orderId();
        assert.deepEqual(await flag(t, order), { ok: false, code: "AMBIGUOUS" });
        assert.equal((await flags(order)).length, 0);

        // A pending Top-up started after the order, or for another pack, can't be its Top-up.
        const other = orderId();
        assert.equal((await flag(t, other, { createdAt: new Date(Date.now() - 3 * 3600e3).toISOString() })).flagged, true);
        const otherPack = await topUp(undefined, { ageMin: 300 });
        await credit(otherPack);
        await topUp(otherPack, { ageMin: 30 });
        assert.equal((await flag(otherPack, orderId())).flagged, true);

        // Once that pending Top-up is credited by this order, it's known.
        await credit(pending, order);
        assert.deepEqual(await flag(t, order), { ok: false, code: "KNOWN_ORDER" });
    });

    it("refuses an order that isn't the owner's, isn't this pack, predates the Top-up, or a Top-up not credited", async () => {
        const t = await topUp();
        await credit(t);
        assert.deepEqual(await flag(t, orderId(), { email: "someone@else.test" }), { ok: false, code: "EMAIL_MISMATCH" });
        assert.deepEqual(await flag(t, orderId(), { variant: "1" }), { ok: false, code: "VARIANT_MISMATCH" });
        const before = new Date(Date.now() - 3 * 3600e3).toISOString();
        assert.deepEqual(await flag(t, orderId(), { createdAt: before }), { ok: false, code: "ORDER_BEFORE_TOP_UP" });
        // A few minutes of clock skew between LemonSqueezy and us is tolerated.
        const skewed = new Date(Date.now() - 124 * 60e3).toISOString();
        assert.equal((await flag(t, orderId(), { createdAt: skewed })).flagged, true);

        const p = await topUp();
        assert.deepEqual(await flag(p, orderId()), { ok: false, code: "NOT_CREDITED" });
        assert.deepEqual(await flag({ ...p, topUpId: randomUUID() }, orderId()), { ok: false, code: "TOP_UP_NOT_FOUND" });
        assert.deepEqual(await flag(t, "12a"), { ok: false, code: "INVALID_ORDER_ID" });
    });

    it("the sweep racing the webhook that credits the owner's pending Top-up: never both credited and flagged", async () => {
        for (let round = 0; round < 10; round++) {
            const t = await topUp(undefined, { ageMin: 300 });
            await credit(t);
            const pending = await topUp(t, { variant: t.variant, ageMin: 20 });
            const order = orderId();
            const [swept, webhook] = await Promise.all([
                flag(t, order),
                pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`, [pending.topUpId, order, PRICE, pending.variant]),
            ]);
            assert.equal(webhook.rows[0].r.ok, true);
            assert.ok(["AMBIGUOUS", "KNOWN_ORDER"].includes(swept.code), JSON.stringify(swept));
            assert.equal((await flags(order)).length, 0);
            assert.equal(await grants(t.userId), 2);
        }
    });

    it("the sweep functions are service_role only, SECURITY DEFINER with an empty search_path", async () => {
        for (const fn of [
            "public.next_top_up_order_sweep_batch(integer)",
            "public.flag_swept_top_up_order(uuid,text,text,timestamptz,integer,text,text)",
        ]) {
            const priv = (await pool.query(
                `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                        has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                        has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [fn])).rows[0];
            assert.deepEqual(priv, { anon: false, authed: false, service: true }, fn);
            const def = (await pool.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [fn])).rows[0];
            assert.equal(def.prosecdef, true, fn);
            assert.deepEqual(def.proconfig, ['search_path=""'], fn);
        }
    });
});
