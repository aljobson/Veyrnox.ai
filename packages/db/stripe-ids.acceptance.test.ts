/**
 * Stripe order ids on the money path — acceptance tests (ADR-0031, 0097).
 *
 * A Stripe PaymentIntent id (`pi_3Q...`) must credit, claw back and Freeze
 * exactly like a LemonSqueezy numeric id did, and an id carrying anything but
 * `[A-Za-z0-9_]` must still be refused by both the CHECK and the function
 * guard. Migrations are applied twice to prove idempotency.
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
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

const SIGNATURES = [
    "public.credit_top_up(uuid, text, integer, text, text)",
    "public.apply_top_up_refund(text, bigint, bigint, uuid)",
    "public.apply_dispute_event(text, text, text)",
];

describe("Stripe ids on the money path (0097)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    /** A Stripe PaymentIntent id, shaped like the live one. */
    const paymentIntent = () => `pi_3Q${randomUUID().replace(/-/g, "")}`;

    /**
     * A pending Top-up bought through create_pending_top_up, exactly as the
     * checkout route makes one. The pack still carries a LemonSqueezy variant
     * id: 0097 does not rewrite existing pack rows.
     */
    async function pendingTopUp({ credits = 300, price = 2500 } = {}) {
        const authId = `sb_${randomUUID()}`;
        const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [authId, `${randomUUID()}@test.veyrnox.ai`])).id as string;
        const packId = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true)`, [packId, credits, price, variant]);
        const res = (await one(`SELECT public.create_pending_top_up($1, $2, $3, 'supply-consent-v1', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).r;
        assert.equal(res.ok, true);
        return { authId, userId, topUpId: res.top_up_id as string, variant, credits, price };
    }

    /** The Stripe webhook's call: no variant to compare. */
    const credit = async (topUpId: string, order: string, cents: number, variant: string | null = null) =>
        (await one(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`, [topUpId, order, cents, variant])).r;

    const refund = async (order: string, refunded: number, total: number, topUpId: string | null = null) =>
        (await one(`SELECT public.apply_top_up_refund($1, $2, $3, $4) AS r`, [order, refunded, total, topUpId])).r;

    const dispute = async (order: string, event: string, reference: string) =>
        (await one(`SELECT public.apply_dispute_event($1, $2, $3) AS r`, [order, event, reference])).r;

    const balance = async (userId: string) =>
        Number((await one(`SELECT balance FROM public.credit_balances WHERE user_id = $1`, [userId])).balance);

    const grants = async (userId: string) =>
        (await pool.query(`SELECT delta FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`,
            [userId])).rows as { delta: number }[];

    async function assertBalanceInvariant(userId: string) {
        const r = await one(
            `SELECT b.balance, (SELECT COALESCE(SUM(delta), 0)::int FROM public.ledger_entries WHERE user_id = $1) AS total
             FROM public.credit_balances b WHERE b.user_id = $1`, [userId]);
        assert.equal(r.balance, r.total, "balance = SUM(delta)");
    }

    it("credits a pending Top-up from a Stripe payment id, exactly once", async () => {
        const t = await pendingTopUp();
        const before = await balance(t.userId);
        const order = paymentIntent();

        const res = await credit(t.topUpId, order, t.price);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.idempotent, false);
        assert.equal(res.credits, t.credits);
        assert.equal(await balance(t.userId), before + t.credits);
        assert.equal((await grants(t.userId)).length, 1, "exactly one grant:topup");

        const row = await one(`SELECT status, order_id, credited_at, grant_entry_id FROM public.top_ups WHERE id = $1`, [t.topUpId]);
        assert.equal(row.status, "credited");
        assert.equal(row.order_id, order, "the Stripe id is stored, not rejected");
        assert.ok(row.credited_at && row.grant_entry_id);
        await assertBalanceInvariant(t.userId);
    });

    it("a redelivery of the same payment is a no-op", async () => {
        const t = await pendingTopUp();
        const order = paymentIntent();
        const first = await credit(t.topUpId, order, t.price);
        assert.equal(first.ok, true);
        const after = await balance(t.userId);

        const replay = await credit(t.topUpId, order, t.price);
        assert.equal(replay.ok, true);
        assert.equal(replay.idempotent, true);
        assert.equal(await balance(t.userId), after, "a replay moves no credits");
        assert.equal((await grants(t.userId)).length, 1, "still one grant");
        await assertBalanceInvariant(t.userId);
    });

    it("a second Stripe payment for a credited Top-up is flagged, never granted", async () => {
        const t = await pendingTopUp();
        const first = paymentIntent();
        assert.equal((await credit(t.topUpId, first, t.price)).ok, true);
        const after = await balance(t.userId);

        const second = paymentIntent();
        const res = await credit(t.topUpId, second, t.price);
        assert.equal(res.ok, false);
        assert.equal(res.code, "ALREADY_CREDITED");
        assert.equal(res.flagged, true);
        assert.equal(await balance(t.userId), after, "a flagged order grants nothing");
        assert.equal((await grants(t.userId)).length, 1);

        const flagged = await one(`SELECT order_id, reason, top_up_id FROM public.top_up_flagged_orders WHERE order_id = $1`, [second]);
        assert.equal(flagged.reason, "already_credited");
        assert.equal(flagged.top_up_id, t.topUpId);
        assert.equal(flagged.order_id, second, "the flagged table takes a Stripe id too");
        await assertBalanceInvariant(t.userId);
    });

    it("a null variant is not checked; a wrong named variant still is", async () => {
        const stripe = await pendingTopUp();
        const res = await credit(stripe.topUpId, paymentIntent(), stripe.price, null);
        assert.equal(res.ok, true, "Stripe passes no variant and must still credit");
        assert.notEqual(res.code, "VARIANT_MISMATCH");

        const wrong = await pendingTopUp();
        const order = paymentIntent();
        const bad = await credit(wrong.topUpId, order, wrong.price, String(randomInt(1e9, 2e9)));
        assert.equal(bad.ok, false);
        assert.equal(bad.code, "VARIANT_MISMATCH", "a named variant that differs is still a mismatch");
        assert.equal(bad.flagged, true);
        assert.equal((await grants(wrong.userId)).length, 0);

        const right = await pendingTopUp();
        const ok = await credit(right.topUpId, paymentIntent(), right.price, right.variant);
        assert.equal(ok.ok, true, "the matching LemonSqueezy variant still credits");
    });

    it("claws back a refunded Stripe payment", async () => {
        const t = await pendingTopUp();
        const order = paymentIntent();
        assert.equal((await credit(t.topUpId, order, t.price)).ok, true);
        const after = await balance(t.userId);

        const res = await refund(order, t.price, t.price);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.idempotent, false);
        assert.equal(res.taken, t.credits, "a full refund takes the whole pack back");
        assert.equal(res.frozen, false, "no generation since purchase, so no Freeze");
        assert.equal(await balance(t.userId), after - t.credits);

        const replay = await refund(order, t.price, t.price);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.taken, 0);
        assert.equal(await balance(t.userId), after - t.credits, "a replayed refund takes nothing more");
        await assertBalanceInvariant(t.userId);
    });

    it("Freezes the buyer on a dispute raised against a Stripe payment", async () => {
        const t = await pendingTopUp();
        const order = paymentIntent();
        assert.equal((await credit(t.topUpId, order, t.price)).ok, true);
        assert.equal((await one(`SELECT frozen_at FROM public.users WHERE id = $1`, [t.userId])).frozen_at, null);

        const res = await dispute(order, "created", "dp_1Qtest");
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.user_id, t.userId, "the owner is the Top-up's, not one named by the caller");
        assert.equal(res.already_frozen, false);
        assert.ok((await one(`SELECT frozen_at FROM public.users WHERE id = $1`, [t.userId])).frozen_at);

        const action = await one(
            `SELECT action, actor, top_up_id FROM public.account_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [t.userId]);
        assert.equal(action.action, "freeze");
        assert.equal(action.actor, "system");
        assert.equal(action.top_up_id, t.topUpId);

        assert.equal((await dispute(order, "created", "dp_1Qtest")).already_frozen, true, "re-Freezing only logs");
    });

    it("refuses an id with punctuation, in the CHECK and in every guard", async () => {
        const injected = "pi_3Q;drop";
        const t = await pendingTopUp();

        assert.deepEqual(await credit(t.topUpId, injected, t.price), { ok: false, code: "INVALID_ORDER_ID" });
        assert.deepEqual(await refund(injected, 100, 100), { ok: false, code: "INVALID_ORDER_ID" });
        assert.deepEqual(await dispute(injected, "created", "dp_1Qtest"), { ok: false, code: "INVALID_ORDER_ID" });
        assert.equal((await grants(t.userId)).length, 0, "a refused id grants nothing");

        for (const [table, column, constraint] of [
            ["top_ups", "order_id", "top_ups_order_id_format"],
            ["top_ups", "return_order_id", "top_ups_return_order_id_format"],
        ]) {
            await assert.rejects(
                pool.query(`UPDATE public.${table} SET ${column} = $1 WHERE id = $2`, [injected, t.topUpId]),
                (err: Error & { constraint?: string }) => err.constraint === constraint,
                `${constraint} must refuse ${injected}`);
        }
        await assert.rejects(
            pool.query(
                `INSERT INTO public.top_up_flagged_orders (order_id, top_up_id, user_id, reason, paid_usd_cents, currency)
                 VALUES ($1, $2, $3, 'amount_mismatch', 1, 'USD')`, [injected, t.topUpId, t.userId]),
            (err: Error & { constraint?: string }) => err.constraint === "top_up_flagged_orders_order_id_check");
        await assert.rejects(
            pool.query(
                `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
                 VALUES ($1, 'web', 300, 2500, $2, false)`, [`test-${randomUUID().slice(0, 8)}`, injected]),
            (err: Error & { constraint?: string }) => err.constraint === "credit_packs_variant_id_check");
    });

    it("lets a pack be active with no variant at all", async () => {
        const packId = `test-${randomUUID().slice(0, 8)}`;
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', 300, 2500, NULL, true)`, [packId]);
        const row = await one(`SELECT active, variant_id FROM public.credit_packs WHERE id = $1`, [packId]);
        assert.equal(row.active, true);
        assert.equal(row.variant_id, null, "Stripe prices Checkout inline, so there is no variant");
    });

    it("keeps one order id to one Top-up", async () => {
        const a = await pendingTopUp();
        const b = await pendingTopUp();
        const order = paymentIntent();
        assert.equal((await credit(a.topUpId, order, a.price)).ok, true);

        const res = await credit(b.topUpId, order, b.price);
        assert.deepEqual(res, { ok: false, code: "ORDER_ALREADY_USED" }, "refused, and never flagged");
        assert.equal((await grants(b.userId)).length, 0);
        assert.equal(
            Number((await one(`SELECT count(*) AS n FROM public.top_up_flagged_orders WHERE order_id = $1`, [order])).n), 0);
    });

    it("keeps the three money-path functions service_role only", async () => {
        for (const sig of SIGNATURES) {
            for (const role of ["anon", "authenticated"]) {
                assert.equal(
                    (await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`, [role, sig])).p, false,
                    `${role} must not execute ${sig}`);
            }
            assert.equal((await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS p`, [sig])).p, true, sig);
        }
    });
});
