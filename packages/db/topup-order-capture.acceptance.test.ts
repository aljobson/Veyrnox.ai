/**
 * Recording a Top-up's order from the checkout redirect — acceptance tests
 * (#94, ADR-0018 decision 5).
 *
 * Exercises record_top_up_order from schema/supabase/0060_top_up_checkout_order.sql
 * on top of 0037/0038 (Free Credits), 0041 (top_ups) and 0054 (credit_top_up),
 * applied twice to prove idempotency. The backfill credits a recorded order
 * through credit_top_up, so that path is covered here too. Skipped unless
 * DATABASE_URL is set.
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
    "0060_top_up_checkout_order.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));
const RECORD_FN = "public.record_top_up_order(text,uuid,text,integer,text,text)";

describe("Recording a Top-up's checkout order", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    /** A signed-up user with a pending Top-up for a fresh pack. */
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

    type T = Awaited<ReturnType<typeof pendingTopUp>>;

    async function record(t: T, order: string, over: { authId?: string; cents?: number; currency?: string; variant?: string } = {}) {
        return (await pool.query(`SELECT public.record_top_up_order($1, $2, $3, $4, $5, $6) AS r`, [
            over.authId ?? t.authId, t.topUpId, order, over.cents ?? t.price, over.currency ?? "USD", over.variant ?? t.variant,
        ])).rows[0].r;
    }

    async function recorded(topUpId: string) {
        return (await pool.query(`SELECT checkout_order_id, status FROM public.top_ups WHERE id = $1`, [topUpId])).rows[0];
    }

    it("records the order on the caller's own pending Top-up", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        const res = await record(t, order);
        assert.deepEqual(res, { ok: true, idempotent: false });
        assert.deepEqual(await recorded(t.topUpId), { checkout_order_id: order, status: "pending" });
    });

    it("recording the same order again is an idempotent no-op", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await record(t, order);
        assert.deepEqual(await record(t, order), { ok: true, idempotent: true });
    });

    it("never records on another user's Top-up", async () => {
        const t = await pendingTopUp();
        const other = await pendingTopUp();
        const res = await record(t, orderId(), { authId: other.authId });
        assert.equal(res.code, "TOP_UP_NOT_FOUND");
        assert.equal((await recorded(t.topUpId)).checkout_order_id, null);
    });

    it("keeps the first recorded order: a different one is refused", async () => {
        const t = await pendingTopUp();
        const first = orderId();
        await record(t, first);
        assert.equal((await record(t, orderId())).code, "ORDER_ALREADY_RECORDED");
        assert.equal((await recorded(t.topUpId)).checkout_order_id, first);
    });

    it("refuses an order already recorded or credited on another Top-up", async () => {
        const a = await pendingTopUp();
        const b = await pendingTopUp();
        const order = orderId();
        await record(a, order);
        assert.equal((await record(b, order)).code, "ORDER_ALREADY_USED");

        const c = await pendingTopUp();
        const d = await pendingTopUp();
        const credited = orderId();
        assert.equal((await pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [c.topUpId, credited, c.price, c.variant])).rows[0].r.ok, true);
        assert.equal((await record(d, credited)).code, "ORDER_ALREADY_USED");
    });

    it("refuses an order whose variant, pre-tax amount or currency differ from the Top-up", async () => {
        const t = await pendingTopUp();
        assert.equal((await record(t, orderId(), { variant: "1" })).code, "VARIANT_MISMATCH");
        assert.equal((await record(t, orderId(), { cents: t.price - 1 })).code, "AMOUNT_MISMATCH");
        assert.equal((await record(t, orderId(), { currency: "EUR" })).code, "CURRENCY_MISMATCH");
        assert.equal((await recorded(t.topUpId)).checkout_order_id, null);
    });

    it("on a Top-up the webhook already credited: same order is a no-op, another is refused", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4)`, [t.topUpId, order, t.price, t.variant]);
        assert.deepEqual(await record(t, order), { ok: true, idempotent: true });
        assert.equal((await record(t, orderId())).code, "ALREADY_CREDITED");
    });

    it("refuses a malformed order id", async () => {
        const t = await pendingTopUp();
        assert.equal((await record(t, "12ab")).code, "INVALID_ORDER_ID");
        assert.equal((await record(t, "[order_id]")).code, "INVALID_ORDER_ID", "an unreplaced link variable");
    });

    it("the backfill path: a recorded order credited by credit_top_up grants once, alongside a late webhook", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await record(t, order);
        const backfill = pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`, [t.topUpId, order, t.price, t.variant]);
        const webhook = pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`, [t.topUpId, order, t.price, t.variant]);
        const results = (await Promise.all([backfill, webhook])).map((r) => r.rows[0].r);
        assert.ok(results.every((r) => r.ok === true));
        assert.equal(results.filter((r) => r.idempotent === false).length, 1);
        const grants = await pool.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`, [t.userId]);
        assert.equal(grants.rows[0].n, 1);
        assert.deepEqual(await recorded(t.topUpId), { checkout_order_id: order, status: "credited" });
    });

    it("leaves the function to service_role only, with an empty search_path", async () => {
        const priv = (await pool.query(
            `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                    has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                    has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [RECORD_FN])).rows[0];
        assert.deepEqual(priv, { anon: false, authed: false, service: true });
        const def = (await pool.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [RECORD_FN])).rows[0];
        assert.equal(def.prosecdef, true);
        assert.deepEqual(def.proconfig, ['search_path=""']);
    });
});
