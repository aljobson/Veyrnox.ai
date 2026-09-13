/**
 * Crediting a paid Top-up — acceptance tests (#93, ADR-0018 decision 5).
 *
 * Exercises credit_top_up and read_top_up from
 * schema/supabase/0047_credit_top_up.sql, on top of 0037/0038 (ledger_grant
 * with free_delta) and 0041 (credit_packs, top_ups), applied here twice to
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
    "0047_credit_top_up.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));
const CREDIT_FN = "public.credit_top_up(uuid,text,integer,text,text)";
const READ_FN = "public.read_top_up(text,uuid)";

describe("Crediting a paid Top-up", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        // Enough connections for the concurrency tests to really race.
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

    /** A signed-up user (50 Free Credits) with a pending Top-up for a fresh pack. */
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

    async function credit(topUpId: string, order: string, cents: number, currency: string, variant: string, client: pg.Pool | pg.PoolClient = pool) {
        return (await client.query(`SELECT public.credit_top_up($1, $2, $3, $4, $5) AS r`,
            [topUpId, order, cents, currency, variant])).rows[0].r;
    }

    async function state(userId: string, topUpId: string) {
        const bal = (await pool.query(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId])).rows[0];
        const grants = (await pool.query(
            `SELECT id, delta, free_delta FROM ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`, [userId])).rows;
        const topUp = (await pool.query(`SELECT * FROM public.top_ups WHERE id = $1`, [topUpId])).rows[0];
        const flags = (await pool.query(
            `SELECT order_id, reason, user_id FROM public.top_up_flagged_orders WHERE top_up_id = $1 ORDER BY created_at`, [topUpId])).rows;
        return { balance: bal.balance as number, free: bal.free_balance as number, grants, topUp, flags };
    }

    /** balance = SUM(delta), free_balance = SUM(free part), reconcile clean. */
    async function assertInvariants(userId: string) {
        const sums = (await pool.query(
            `SELECT COALESCE(SUM(delta), 0)::int AS total, COALESCE(SUM(COALESCE(free_delta, delta)), 0)::int AS free_total
             FROM ledger_entries WHERE user_id = $1`, [userId])).rows[0];
        const bal = (await pool.query(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId])).rows[0];
        assert.equal(bal.balance, sums.total, "balance = SUM(delta)");
        assert.equal(bal.free_balance, sums.free_total, "free_balance = SUM(free part)");
        assert.ok(bal.free_balance >= 0 && bal.free_balance <= bal.balance, "0 <= free_balance <= balance");
        const drift = await pool.query(`SELECT 1 FROM public.reconcile_free_credits() WHERE user_id = $1`, [userId]);
        assert.equal(drift.rowCount, 0, "reconcile_free_credits clean");
    }

    it("credits a paid Top-up once, to the pending row's user, as Pack Credits", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        const res = await credit(t.topUpId, order, t.price, "USD", t.variant);
        assert.equal(res.ok, true);
        assert.equal(res.idempotent, false);
        assert.equal(res.credits, 300);
        assert.equal(res.balance_after, 350);

        const s = await state(t.userId, t.topUpId);
        assert.equal(s.balance, 350);
        assert.equal(s.free, 50, "Pack Credits are never Free Credits");
        assert.equal(s.grants.length, 1);
        assert.equal(s.grants[0].delta, 300);
        assert.equal(s.grants[0].free_delta, 0);
        assert.equal(s.topUp.status, "credited");
        assert.equal(s.topUp.order_id, order);
        assert.ok(s.topUp.credited_at);
        assert.equal(s.topUp.grant_entry_id, s.grants[0].id, "the grant is tied to the Top-up and its Sales Channel");
        assert.equal(s.topUp.sales_channel, "web");
        await assertInvariants(t.userId);
    });

    it("replaying the same order is an idempotent no-op", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await credit(t.topUpId, order, t.price, "USD", t.variant);
        const replay = await credit(t.topUpId, order, t.price, "USD", t.variant);
        assert.equal(replay.ok, true);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.balance_after, 350);
        const s = await state(t.userId, t.topUpId);
        assert.equal(s.grants.length, 1);
        assert.equal(s.flags.length, 0, "a replay is not a second order");
        await assertInvariants(t.userId);
    });

    it("concurrent deliveries of the same order grant exactly once", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        const results = await Promise.all(Array.from({ length: 10 }, () => credit(t.topUpId, order, t.price, "USD", t.variant)));
        assert.ok(results.every((r) => r.ok === true));
        assert.equal(results.filter((r) => r.idempotent === false).length, 1);
        const s = await state(t.userId, t.topUpId);
        assert.equal(s.balance, 350);
        assert.equal(s.grants.length, 1);
        await assertInvariants(t.userId);
    });

    it("a second paid order for an already credited Top-up is flagged for Operator refund, never granted", async () => {
        // A replayed idempotency key on POST /api/v1/top-ups issues a fresh
        // checkout for the same Top-up, so two paid orders can name it.
        const t = await pendingTopUp();
        const first = orderId();
        const second = orderId();
        assert.equal((await credit(t.topUpId, first, t.price, "USD", t.variant)).ok, true);

        const dup = await credit(t.topUpId, second, t.price, "USD", t.variant);
        assert.equal(dup.ok, false);
        assert.equal(dup.code, "ALREADY_CREDITED");
        assert.equal(dup.flagged, true);

        const again = await credit(t.topUpId, second, t.price, "USD", t.variant);
        assert.equal(again.code, "ALREADY_CREDITED", "replaying the second order stays flagged");

        const s = await state(t.userId, t.topUpId);
        assert.equal(s.balance, 350, "credited once");
        assert.equal(s.grants.length, 1);
        assert.equal(s.topUp.order_id, first, "first paid order wins");
        assert.deepEqual(s.flags.map((f) => [f.order_id, f.reason, f.user_id]), [[second, "already_credited", t.userId]],
            "one flag row, on the Top-up's user");
        await assertInvariants(t.userId);
    });

    it("concurrent different orders for one Top-up: one grant, the rest flagged", async () => {
        const t = await pendingTopUp();
        const orders = Array.from({ length: 6 }, orderId);
        const results = await Promise.all(orders.map((o) => credit(t.topUpId, o, t.price, "USD", t.variant)));
        assert.equal(results.filter((r) => r.ok === true).length, 1);
        assert.equal(results.filter((r) => r.code === "ALREADY_CREDITED").length, 5);
        const s = await state(t.userId, t.topUpId);
        assert.equal(s.balance, 350);
        assert.equal(s.grants.length, 1);
        assert.equal(s.flags.length, 5);
        assert.ok(!s.flags.some((f) => f.order_id === s.topUp.order_id), "the credited order is not flagged");
        await assertInvariants(t.userId);
    });

    it("rejects a mismatched variant, amount or currency, flags the paid order, grants nothing", async () => {
        const t = await pendingTopUp();
        const cases: Array<[string, number, string, string, string]> = [
            [orderId(), t.price, "USD", "999", "VARIANT_MISMATCH"],
            [orderId(), t.price - 1, "USD", t.variant, "AMOUNT_MISMATCH"],
            [orderId(), t.price + 500, "USD", t.variant, "AMOUNT_MISMATCH"],
            [orderId(), t.price, "EUR", t.variant, "CURRENCY_MISMATCH"],
        ];
        for (const [order, cents, currency, variant, code] of cases) {
            const res = await credit(t.topUpId, order, cents, currency, variant);
            assert.equal(res.ok, false);
            assert.equal(res.code, code);
            assert.equal(res.flagged, true);
        }
        let s = await state(t.userId, t.topUpId);
        assert.equal(s.balance, 50);
        assert.equal(s.grants.length, 0);
        assert.equal(s.topUp.status, "pending");
        assert.equal(s.flags.length, 4);

        // The matching order still credits afterwards.
        assert.equal((await credit(t.topUpId, orderId(), t.price, "USD", t.variant)).ok, true);
        s = await state(t.userId, t.topUpId);
        assert.equal(s.balance, 350);
        await assertInvariants(t.userId);
    });

    it("refuses an unknown Top-up, a malformed order id, and an order already used by another Top-up", async () => {
        assert.equal((await credit(randomUUID(), orderId(), 2500, "USD", "1")).code, "TOP_UP_NOT_FOUND");
        const t = await pendingTopUp();
        assert.equal((await credit(t.topUpId, "12ab", t.price, "USD", t.variant)).code, "INVALID_ORDER_ID");

        const order = orderId();
        assert.equal((await credit(t.topUpId, order, t.price, "USD", t.variant)).ok, true);
        const other = await pendingTopUp();
        const res = await credit(other.topUpId, order, other.price, "USD", other.variant);
        assert.equal(res.code, "ORDER_ALREADY_USED");
        let s = await state(other.userId, other.topUpId);
        assert.equal(s.balance, 50);
        assert.equal(s.topUp.status, "pending");

        // Also once the other Top-up is credited: never flag an order credited elsewhere.
        assert.equal((await credit(other.topUpId, orderId(), other.price, "USD", other.variant)).ok, true);
        assert.equal((await credit(other.topUpId, order, other.price, "USD", other.variant)).code, "ORDER_ALREADY_USED");
        s = await state(other.userId, other.topUpId);
        assert.equal(s.flags.length, 0);
        assert.equal((await pool.query(`SELECT 1 FROM public.top_up_flagged_orders WHERE order_id = $1`, [order])).rowCount, 0);
    });

    it("does not let a credited row be half-written", async () => {
        const t = await pendingTopUp();
        await assert.rejects(
            pool.query(`UPDATE public.top_ups SET status = 'credited' WHERE id = $1`, [t.topUpId]),
            /top_ups_credited_complete/,
        );
    });

    it("read_top_up returns only the caller's own Top-up", async () => {
        const t = await pendingTopUp();
        let mine = (await pool.query(`SELECT public.read_top_up($1, $2) AS r`, [t.authId, t.topUpId])).rows[0].r;
        assert.equal(mine.ok, true);
        assert.equal(mine.top_up.status, "pending");
        assert.equal(mine.top_up.credits, 300);
        assert.equal(mine.top_up.credited_at, null);

        await credit(t.topUpId, orderId(), t.price, "USD", t.variant);
        mine = (await pool.query(`SELECT public.read_top_up($1, $2) AS r`, [t.authId, t.topUpId])).rows[0].r;
        assert.equal(mine.top_up.status, "credited");
        assert.ok(mine.top_up.credited_at);
        assert.equal(mine.top_up.order_id, undefined, "merchant order id is not exposed");

        const stranger = await pendingTopUp();
        const theirs = (await pool.query(`SELECT public.read_top_up($1, $2) AS r`, [stranger.authId, t.topUpId])).rows[0].r;
        assert.deepEqual(theirs, { ok: false, code: "TOP_UP_NOT_FOUND" });
    });

    it("keeps new objects service_role only, SECURITY DEFINER with an empty search_path, RLS forced", async () => {
        for (const fn of [CREDIT_FN, READ_FN]) {
            const priv = (await pool.query(
                `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                        has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                        has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [fn])).rows[0];
            assert.deepEqual(priv, { anon: false, authed: false, service: true }, fn);
            const def = (await pool.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [fn])).rows[0];
            assert.equal(def.prosecdef, true, fn);
            assert.deepEqual(def.proconfig, ['search_path=""'], fn);
        }
        const rls = (await pool.query(
            `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.top_up_flagged_orders'::regclass`)).rows[0];
        assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
        const tbl = (await pool.query(
            `SELECT has_table_privilege('anon', 'public.top_up_flagged_orders', 'SELECT') AS anon,
                    has_table_privilege('authenticated', 'public.top_up_flagged_orders', 'SELECT') AS authed`)).rows[0];
        assert.deepEqual(tbl, { anon: false, authed: false });
    });
});
