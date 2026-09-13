/**
 * Backfill order binding — acceptance tests (#147).
 *
 * Exercises backfill_credit_top_up and top_up_order_collisions from
 * schema/supabase/0068_backfill_order_binding.sql: an order whose email isn't
 * the Top-up owner's is never credited, an ORDER_ALREADY_USED collision is
 * recorded for Operators, and the backfill racing the webhook still grants
 * once. Built on 0037/0038, 0041, 0054, 0058/0059/0062, 0060, 0063, 0064,
 * 0065 and 0066, applied twice to prove idempotency. Skipped unless DATABASE_URL is set.
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

const CREDITS = 300;
const PRICE = 2500;
const TOTAL = 3000;

describe("Backfill order binding", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    async function user() {
        const authId = `sb_${randomUUID()}`;
        const email = `${randomUUID()}@test.veyrnox.ai`;
        const userId = (await pool.query(`SELECT public.signup_grant($1, $2) AS id`, [authId, email])).rows[0].id as string;
        return { authId, email, userId };
    }

    async function pendingTopUp(owner?: Awaited<ReturnType<typeof user>>, variant = String(randomInt(1e9, 2e9))) {
        const u = owner ?? await user();
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true) ON CONFLICT (sales_channel, variant_id) DO NOTHING`,
            [`test-${randomUUID().slice(0, 8)}`, CREDITS, PRICE, variant]);
        const packId = (await pool.query(`SELECT id FROM public.credit_packs WHERE variant_id = $1`, [variant])).rows[0].id;
        const res = (await pool.query(
            `SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 100, 600) AS r`,
            [u.authId, packId, `test-${randomUUID()}`])).rows[0].r;
        assert.equal(res.ok, true);
        return { ...u, topUpId: res.top_up_id as string, variant };
    }

    type T = Awaited<ReturnType<typeof pendingTopUp>>;

    async function recordReturn(t: T, order: string, identifier = randomUUID()) {
        const r = (await pool.query(`SELECT public.record_top_up_return($1, $2, $3, $4) AS r`,
            [t.authId, t.topUpId, order, identifier])).rows[0].r;
        await pool.query(`UPDATE public.top_ups SET returned_at = now() - interval '11 minutes' WHERE id = $1`, [t.topUpId]);
        return r;
    }

    /** The webhook's path: Top-up id from signed custom data, no email check. */
    async function webhookCredit(t: T, order: string) {
        return (await pool.query(`SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [t.topUpId, order, PRICE, t.variant])).rows[0].r;
    }

    async function backfill(t: T, order: string, email: string | null, refunded = 0) {
        return (await pool.query(`SELECT public.backfill_credit_top_up($1, $2, $3, $4, 'USD', $5, $6, $7) AS r`,
            [t.topUpId, order, email, PRICE, t.variant, refunded, TOTAL])).rows[0].r;
    }

    async function grants(userId: string) {
        return (await pool.query(`SELECT delta FROM ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`, [userId])).rows;
    }

    async function flags(order: string) {
        return (await pool.query(`SELECT top_up_id, reason FROM public.top_up_flagged_orders WHERE order_id = $1`, [order])).rows;
    }

    async function assertBalanceInvariant(userId: string) {
        const r = (await pool.query(
            `SELECT b.balance, (SELECT COALESCE(SUM(delta), 0)::int FROM ledger_entries WHERE user_id = $1) AS total
             FROM credit_balances b WHERE b.user_id = $1`, [userId])).rows[0];
        assert.equal(r.balance, r.total, "balance = SUM(delta)");
    }

    // --- #147 item 1: bind the order to the buyer ------------------------------

    it("credits an order whose email is the owner's, ignoring case and surrounding space", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await recordReturn(t, order);
        const res = await backfill(t, order, `  ${t.email.toUpperCase()} `);
        assert.equal(res.ok, true);
        assert.equal(res.idempotent, false);
        assert.equal((await grants(t.userId)).length, 1);
        await assertBalanceInvariant(t.userId);
    });

    it("refuses an order whose email isn't the owner's: no grant, no flag, Top-up stays pending", async () => {
        for (const email of [`${randomUUID()}@test.veyrnox.ai`, "", null]) {
            const t = await pendingTopUp();
            const order = orderId();
            await recordReturn(t, order);
            assert.deepEqual(await backfill(t, order, email), { ok: false, code: "EMAIL_MISMATCH" }, String(email));
            assert.equal((await grants(t.userId)).length, 0);
            assert.equal((await flags(order)).length, 0);
            const row = (await pool.query(`SELECT status FROM public.top_ups WHERE id = $1`, [t.topUpId])).rows[0];
            assert.equal(row.status, "pending");
        }
    });

    it("the email binding also guards a partly refunded order (#146's clawback path)", async () => {
        const t = await pendingTopUp();
        const order = orderId();
        await recordReturn(t, order);
        assert.equal((await backfill(t, order, "victim@test.veyrnox.ai", 1500)).code, "EMAIL_MISMATCH");
        assert.equal((await grants(t.userId)).length, 0);
        const r = (await pool.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND reason <> 'grant:signup'`, [t.userId])).rows[0];
        assert.equal(r.n, 0);
    });

    it("a leaked identifier recorded on an attacker's Top-up never credits the attacker; the victim is credited later", async () => {
        const victim = await pendingTopUp();
        const attacker = await pendingTopUp(undefined, victim.variant);
        const order = orderId();
        const identifier = randomUUID();
        await recordReturn(victim, order, identifier);
        await recordReturn(attacker, order, identifier);

        // The re-fetched order carries the victim's checkout email.
        assert.equal((await backfill(attacker, order, victim.email)).code, "EMAIL_MISMATCH");
        assert.equal((await grants(attacker.userId)).length, 0);

        assert.equal((await backfill(victim, order, victim.email)).ok, true);
        assert.equal((await grants(victim.userId)).length, 1);
        await assertBalanceInvariant(attacker.userId);
        await assertBalanceInvariant(victim.userId);
    });

    // --- #147 item 2: collisions are visible to Operators -----------------------

    it("ORDER_ALREADY_USED leaves one collision row naming both Top-ups, and grants nothing", async () => {
        const holder = await pendingTopUp();
        const other = await pendingTopUp(holder, holder.variant);
        const order = orderId();
        assert.equal((await webhookCredit(holder, order)).ok, true);
        await recordReturn(other, order);

        for (const round of [1, 2]) {
            const res = await backfill(other, order, holder.email);
            assert.equal(res.ok, false);
            assert.equal(res.code, "ORDER_ALREADY_USED");
            assert.equal(res.collision, true);
        }
        const rows = (await pool.query(
            `SELECT order_id, top_up_id, credited_top_up_id FROM public.top_up_order_collisions WHERE order_id = $1`, [order])).rows;
        assert.deepEqual(rows, [{ order_id: order, top_up_id: other.topUpId, credited_top_up_id: holder.topUpId }], "once, however often it runs");
        const seen = (await pool.query(
            `SELECT order_id, top_up_id, user_id, credited_top_up_id, credited_user_id FROM public.operator_order_collisions($1, 10)`,
            [holder.userId])).rows;
        assert.deepEqual(seen, [{ order_id: order, top_up_id: other.topUpId, user_id: holder.userId,
                                  credited_top_up_id: holder.topUpId, credited_user_id: holder.userId }], "Operators can read it");
        assert.equal((await grants(holder.userId)).length, 1, "only the holder's own grant");
        assert.equal((await flags(order)).length, 0, "never flagged: the order is legitimately credited elsewhere");
    });

    it("top_up_order_collisions is append-only and closed to the browser", async () => {
        const holder = await pendingTopUp();
        const other = await pendingTopUp(holder, holder.variant);
        const order = orderId();
        await webhookCredit(holder, order);
        await backfill(other, order, holder.email);
        await assert.rejects(pool.query(`UPDATE public.top_up_order_collisions SET order_id = '1' WHERE order_id = $1`, [order]), /append-only/);
        await assert.rejects(pool.query(`DELETE FROM public.top_up_order_collisions WHERE order_id = $1`, [order]), /append-only/);
        const rls = (await pool.query(
            `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.top_up_order_collisions'::regclass`)).rows[0];
        assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
        for (const role of ["anon", "authenticated"]) {
            const r = (await pool.query(`SELECT has_table_privilege($1, 'public.top_up_order_collisions', 'SELECT') AS ok`, [role])).rows[0];
            assert.equal(r.ok, false, role);
        }
    });

    // --- races -----------------------------------------------------------------

    it("backfill racing the webhook for the same order grants exactly once", async () => {
        for (let round = 0; round < 5; round++) {
            const t = await pendingTopUp();
            const order = orderId();
            await recordReturn(t, order);
            const results = await Promise.all([webhookCredit(t, order), backfill(t, order, t.email), webhookCredit(t, order)]);
            assert.ok(results.every((r) => r.ok === true));
            assert.equal(results.filter((r) => r.idempotent === false).length, 1);
            assert.equal((await grants(t.userId)).length, 1);
            assert.equal((await flags(order)).length, 0);
            await assertBalanceInvariant(t.userId);
        }
    });

    it("backfill of returned order A racing the webhook for order B: one grant, the other order flagged", async () => {
        for (let round = 0; round < 5; round++) {
            const t = await pendingTopUp();
            const a = orderId();
            const b = orderId();
            await recordReturn(t, a);
            const [viaBackfill, viaWebhook] = await Promise.all([backfill(t, a, t.email), webhookCredit(t, b)]);
            assert.equal([viaBackfill, viaWebhook].filter((r) => r.ok === true).length, 1);
            const loser = viaBackfill.ok ? b : a;
            assert.deepEqual(await flags(loser), [{ top_up_id: t.topUpId, reason: "already_credited" }]);
            assert.equal((await grants(t.userId)).length, 1);
            await assertBalanceInvariant(t.userId);
        }
    });

    it("the new functions are service_role only, SECURITY DEFINER with an empty search_path", async () => {
        for (const fn of [
            "public.backfill_credit_top_up(uuid,text,text,integer,text,text,bigint,bigint)",
            "public.operator_order_collisions(uuid,integer)",
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
