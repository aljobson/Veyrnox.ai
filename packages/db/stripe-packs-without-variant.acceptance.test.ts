/**
 * Credit Packs with no provider variant can be bought (0167, ADR-0031/0037),
 * and a flagged order is an append-only record (0174).
 *
 * 0121 added web-270, web-1200 and web-3000 with variant_id NULL. Before 0167,
 * create_pending_top_up returned PACK_NOT_FOUND for them. These tests buy a
 * NULL-variant pack the way the checkout route does, credit it the way the
 * Stripe webhook does, and check the guards that remain. Migrations are
 * applied twice to prove idempotency.
 *
 * Skipped unless DATABASE_URL is set.
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
    "0066_freeze_since_purchase.sql",
    "0097_stripe_money_path_ids.sql",
    "0167_stripe_packs_without_variant.sql",
    "0174_flagged_orders_append_only.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("Credit Packs without a variant (0167)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const round of [1, 2]) { // migrations must be idempotent
            for (const m of MIGRATIONS) await pool.query(await readFile(m, "utf8"));
        }
    });

    after(async () => { if (pool) await pool.end(); });

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

    const newUser = async () => {
        const authId = `sb_${randomUUID()}`;
        const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [authId, `${randomUUID()}@test.veyrnox.ai`])).id as string;
        return { authId, userId };
    };

    /**
     * A pack shaped like 0121's rows: active, priced, no variant. 200 for
     * $19 clears both the 0041 floor this file applies and 0121's.
     */
    async function pack({ variant = null as string | null, active = true, credits = 200, price = 1900 } = {}) {
        const id = `test-${randomUUID().slice(0, 8)}`;
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, $5)`, [id, credits, price, variant, active]);
        return id;
    }

    /** The checkout route's call (app/api/v1/top-ups/route.js). */
    const start = async (authId: string, packId: string, key = `test-${randomUUID()}`) =>
        (await one(`SELECT public.create_pending_top_up($1, $2, $3, 'supply-consent-v1', 10, 600) AS r`,
            [authId, packId, key])).r;

    /** The Stripe webhook's call: no variant to compare. */
    const credit = async (topUpId: string, cents: number, currency = "USD") =>
        (await one(`SELECT public.credit_top_up($1, $2, $3, $4, NULL) AS r`,
            [topUpId, `pi_3Q${randomUUID().replace(/-/g, "")}`, cents, currency])).r;

    const balance = async (userId: string) =>
        Number((await one(`SELECT balance FROM public.credit_balances WHERE user_id = $1`, [userId])).balance);

    it("starts a Top-up for an active pack with no variant", async () => {
        const { authId } = await newUser();
        const res = await start(authId, await pack());
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.credits, 200);
        assert.equal(res.price_usd_cents, 1900);
        assert.equal(res.variant_id, null);
        const row = await one(`SELECT status, variant_id FROM public.top_ups WHERE id = $1`, [res.top_up_id]);
        assert.deepEqual(row, { status: "pending", variant_id: null });
    });

    it("replays the same idempotency key as a no-op", async () => {
        const { authId } = await newUser();
        const packId = await pack();
        const key = `test-${randomUUID()}`;
        const first = await start(authId, packId, key);
        const again = await start(authId, packId, key);
        assert.equal(again.ok, true);
        assert.equal(again.idempotent, true);
        assert.equal(again.top_up_id, first.top_up_id);
    });

    it("credits the paid Top-up exactly once", async () => {
        const { authId, userId } = await newUser();
        const before = await balance(userId);
        const { top_up_id } = await start(authId, await pack());
        const res = await credit(top_up_id, 1900);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(await balance(userId), before + 200);
    });

    it("still flags a payment that does not match the price", async () => {
        const { authId, userId } = await newUser();
        const before = await balance(userId);
        const { top_up_id } = await start(authId, await pack());
        const res = await credit(top_up_id, 1);
        assert.deepEqual([res.ok, res.code, res.flagged], [false, "AMOUNT_MISMATCH", true]);
        assert.equal(await balance(userId), before);
    });

    it("keeps a flagged order as an append-only record (0174)", async () => {
        const { authId } = await newUser();
        const { top_up_id } = await start(authId, await pack());
        assert.equal((await credit(top_up_id, 1)).code, "AMOUNT_MISMATCH");
        const row = await one(`SELECT order_id FROM public.top_up_flagged_orders WHERE top_up_id = $1`, [top_up_id]);
        assert.ok(row, "the mismatch was flagged");
        await assert.rejects(pool.query(`UPDATE public.top_up_flagged_orders SET reason = 'amount_mismatch' WHERE order_id = $1`, [row.order_id]),
            /append-only \(attempted UPDATE\)/);
        await assert.rejects(pool.query(`DELETE FROM public.top_up_flagged_orders WHERE order_id = $1`, [row.order_id]),
            /append-only \(attempted DELETE\)/);
        assert.ok(await one(`SELECT 1 AS ok FROM public.top_up_flagged_orders WHERE order_id = $1`, [row.order_id]));
    });

    it("still refuses an inactive pack", async () => {
        const { authId } = await newUser();
        const res = await start(authId, await pack({ active: false }));
        assert.deepEqual([res.ok, res.code], [false, "PACK_NOT_FOUND"]);
    });

    it("still sells a pack that carries a variant", async () => {
        const { authId } = await newUser();
        const variant = String(randomInt(1e9, 2e9));
        const res = await start(authId, await pack({ variant }));
        assert.equal(res.ok, true);
        assert.equal(res.variant_id, variant);
    });

    it("keeps create_pending_top_up service-role only", async () => {
        const sig = "public.create_pending_top_up(text, text, text, text, integer, integer)";
        for (const role of ["anon", "authenticated"]) {
            const r = await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig]);
            assert.equal(r.ok, false, `${role} must not execute`);
        }
        const sr = await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok`, [sig]);
        assert.equal(sr.ok, true);
    });
});
