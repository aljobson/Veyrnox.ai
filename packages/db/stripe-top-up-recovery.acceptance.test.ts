/**
 * The lost-webhook recovery path must be reachable under Stripe, and must
 * raise its hand when it is not working (schema/supabase/0108, ADR-0033,
 * round-3 audit finding 08).
 *
 * The audit named two guards. Three of the five were predicates that silently
 * never matched a Stripe row rather than validators that rejected one, so the
 * tests that matter here are the ones asserting a Stripe row is actually
 * handed out and can actually be closed.
 *
 * Migrations are applied twice to prove idempotency. Skipped unless
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
    "0058_top_up_refund_clawback.sql",
    "0059_chargeback_freeze.sql",
    "0060_top_up_backfill.sql",
    "0062_freeze_credits_taken.sql",
    "0063_credit_top_up_with_refund.sql",
    "0064_flag_second_paid_order.sql",
    "0065_operator_top_up_reads.sql",
    "0066_freeze_since_purchase.sql",
    "0068_backfill_order_binding.sql",
    // 0097 is what lets credit_top_up accept a `pi_...` order id at all.
    "0097_stripe_money_path_ids.sql",
    "0108_stripe_top_up_recovery.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

// A realistic Stripe Checkout Session id: cs_ + test/live + 58 base58-ish chars.
const sessionId = () => `cs_test_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;

// Undo every recorded return, whichever provider shaped it. Setting the column
// to NULL is legal under both the old and the new CHECK, so this is safe to run
// before the migrations as well as after the tests.
const CLEAR_RETURNS = `UPDATE public.top_ups
    SET return_order_id = NULL, return_order_identifier = NULL,
        returned_at = NULL, return_closed_at = now()
    WHERE return_order_id IS NOT NULL`;

describe("Stripe Top-up recovery (0108)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        await pool.query(await readFile(new URL("./schema/prereqs.sql", import.meta.url), "utf8"));
        // Clear returns BEFORE the migrations, not after. 0060 adds the
        // digits-only CHECK whenever it is absent, so re-applying it over a
        // `cs_...` row left by an earlier run fails on "violated by some row".
        // Every acceptance suite in ledger-tests.yml shares one database, so
        // this is CI's hazard too, not just a local one.
        await pool.query(CLEAR_RETURNS);
        for (const round of [1, 2]) {
            for (const m of MIGRATIONS) await pool.query(await readFile(m, "utf8"));
        }
    });

    after(async () => {
        if (!pool) return;
        // Leave no Stripe-shaped return behind: the topup-* suites run after
        // this one against the same database and re-apply 0060.
        try { await pool.query(CLEAR_RETURNS); } finally { await pool.end(); }
    });

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

    async function pendingTopUp({ credits = 300, price = 2500 } = {}) {
        const authId = `sb_${randomUUID()}`;
        await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, `${randomUUID()}@test.veyrnox.ai`]);
        const packId = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, true)`,
            [packId, credits, price, variant]);
        const res = (await one(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600) AS r`,
            [authId, packId, `test-${randomUUID()}`])).r;
        assert.equal(res.ok, true);
        return { authId, topUpId: res.top_up_id as string, credits, price, variant };
    }

    const recordSession = async (authId: string, topUpId: string, session: string) =>
        (await one(`SELECT public.record_top_up_return_session($1, $2, $3) AS r`, [authId, topUpId, session])).r;

    const age = (topUpId: string, hours: number) =>
        pool.query(`UPDATE public.top_ups SET returned_at = now() - make_interval(hours => $2) WHERE id = $1`,
            [topUpId, hours]);

    const drift = async (topUpId: string) =>
        Number((await one(`SELECT count(*) AS n FROM public.reconcile_top_ups()
                           WHERE top_up_id = $1 AND problem = 'returned_not_credited'`, [topUpId])).n);

    // ── 1. the CHECK ──────────────────────────────────────────────────────

    it("the table accepts a Stripe session id, and still accepts a legacy numeric order", async () => {
        const t = await pendingTopUp();
        const cs = sessionId();
        await pool.query(`UPDATE public.top_ups SET return_order_id = $2 WHERE id = $1`, [t.topUpId, cs]);
        assert.equal((await one(`SELECT return_order_id AS r FROM public.top_ups WHERE id = $1`, [t.topUpId])).r, cs);
        // The LemonSqueezy era's rows must stay legal or the constraint could
        // not have been re-added at all.
        await pool.query(`UPDATE public.top_ups SET return_order_id = '1234567890' WHERE id = $1`, [t.topUpId]);
        await assert.rejects(
            pool.query(`UPDATE public.top_ups SET return_order_id = 'pi_not_a_session' WHERE id = $1`, [t.topUpId]),
            /top_ups_return_order_id_format/);
    });

    // ── 2. the writer ─────────────────────────────────────────────────────

    it("records the session, leaves the LemonSqueezy identifier empty, and resets the backoff", async () => {
        const t = await pendingTopUp();
        const cs = sessionId();
        await pool.query(`UPDATE public.top_ups SET backfill_attempts = 4, backfill_checked_at = now() WHERE id = $1`,
            [t.topUpId]);
        assert.equal((await recordSession(t.authId, t.topUpId, cs)).ok, true);
        const row = await one(`SELECT return_order_id, return_order_identifier, returned_at,
                                     backfill_attempts, backfill_checked_at
                              FROM public.top_ups WHERE id = $1`, [t.topUpId]);
        assert.equal(row.return_order_id, cs);
        assert.equal(row.return_order_identifier, null, "Stripe has no second token");
        assert.ok(row.returned_at);
        assert.equal(Number(row.backfill_attempts), 0);
        assert.equal(row.backfill_checked_at, null);
    });

    it("refuses anything that is not a Checkout Session id", async () => {
        const t = await pendingTopUp();
        for (const bad of ["pi_3abc", "1234567890", "cs_", "cs_test_bad-dash", "", null]) {
            const r = await recordSession(t.authId, t.topUpId, bad as string);
            assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
            assert.equal(r.code, "INVALID_SESSION_ID");
        }
    });

    it("will not write to another user's Top-up", async () => {
        const mine = await pendingTopUp();
        const theirs = await pendingTopUp();
        const r = await recordSession(mine.authId, theirs.topUpId, sessionId());
        assert.equal(r.ok, false);
        assert.equal(r.code, "TOP_UP_NOT_FOUND");
        assert.equal((await one(`SELECT return_order_id AS r FROM public.top_ups WHERE id = $1`, [theirs.topUpId])).r, null);
    });

    it("re-posting the same session id cannot postpone the backfill", async () => {
        const t = await pendingTopUp();
        const cs = sessionId();
        await recordSession(t.authId, t.topUpId, cs);
        await age(t.topUpId, 3);
        const before_ = (await one(`SELECT returned_at AS r FROM public.top_ups WHERE id = $1`, [t.topUpId])).r;
        assert.equal((await recordSession(t.authId, t.topUpId, cs)).ok, true);
        assert.deepEqual((await one(`SELECT returned_at AS r FROM public.top_ups WHERE id = $1`, [t.topUpId])).r,
            before_, "a reload of the return page must not reset the clock");
    });

    // ── 3. the due-row predicate: the silent failure ──────────────────────

    it("hands a Stripe row to the backfill, which the identifier requirement prevented", async () => {
        const t = await pendingTopUp();
        const cs = sessionId();
        await recordSession(t.authId, t.topUpId, cs);
        await age(t.topUpId, 1); // past the 10-minute wait
        const rows = (await pool.query(`SELECT * FROM public.next_top_up_backfill_batch(50)`)).rows;
        const mine = rows.find((r) => r.top_up_id === t.topUpId);
        assert.ok(mine, "a Stripe row with no order_identifier must still be due");
        assert.equal(mine.order_id, cs);
        assert.equal(mine.order_identifier, null, "NULL identifier is how the consumer spots a Stripe row");
    });

    // ── 4. closing a Stripe return ────────────────────────────────────────

    it("closes a Stripe return whose identifier is NULL", async () => {
        const t = await pendingTopUp();
        const cs = sessionId();
        await recordSession(t.authId, t.topUpId, cs);
        const r = (await one(`SELECT public.close_top_up_return($1, $2, NULL) AS r`, [t.topUpId, cs])).r;
        assert.equal(r.ok, true, "NULL = NULL must match, or the row is retried for ever");
        assert.ok((await one(`SELECT return_closed_at AS r FROM public.top_ups WHERE id = $1`, [t.topUpId])).r);
        // And a stale close still cannot close a newer return.
        const stale = (await one(`SELECT public.close_top_up_return($1, $2, NULL) AS r`, [t.topUpId, sessionId()])).r;
        assert.equal(stale.ok, false);
        assert.equal(stale.code, "NOT_CURRENT");
    });

    it("still requires both halves to match for a LemonSqueezy return", async () => {
        const t = await pendingTopUp();
        const order = String(randomInt(1e9, 2e9));
        const ident = randomUUID();
        assert.equal((await one(`SELECT public.record_top_up_return($1, $2, $3, $4) AS r`,
            [t.authId, t.topUpId, order, ident])).r.ok, true);
        // Right order, wrong identifier — must not close.
        assert.equal((await one(`SELECT public.close_top_up_return($1, $2, $3) AS r`,
            [t.topUpId, order, randomUUID()])).r.ok, false);
        // NULL must not close a row that has an identifier either.
        assert.equal((await one(`SELECT public.close_top_up_return($1, $2, NULL) AS r`,
            [t.topUpId, order])).r.ok, false);
        assert.equal((await one(`SELECT public.close_top_up_return($1, $2, $3) AS r`,
            [t.topUpId, order, ident])).r.ok, true);
    });

    // ── 5. the alarm ──────────────────────────────────────────────────────

    it("flags a returned Top-up that is still uncredited a day later", async () => {
        const t = await pendingTopUp();
        await recordSession(t.authId, t.topUpId, sessionId());
        assert.equal(await drift(t.topUpId), 0, "minutes old is not yet drift");
        await age(t.topUpId, 23);
        assert.equal(await drift(t.topUpId), 0, "inside the grace period");
        await age(t.topUpId, 25);
        assert.equal(await drift(t.topUpId), 1);
    });

    it("does not flag an abandoned checkout, which is the common case", async () => {
        const t = await pendingTopUp();
        // Never returned: pending for ever, and not a problem. A bare
        // "pending and old" branch here would keep the nightly cron red.
        await pool.query(`UPDATE public.top_ups SET created_at = now() - interval '30 days' WHERE id = $1`,
            [t.topUpId]);
        assert.equal(await drift(t.topUpId), 0);
        assert.equal(Number((await one(`SELECT count(*) AS n FROM public.reconcile_top_ups()`)).n) >= 0, true);
    });

    it("clears once the return is closed, and once the Top-up is credited", async () => {
        const closed = await pendingTopUp();
        const cs = sessionId();
        await recordSession(closed.authId, closed.topUpId, cs);
        await age(closed.topUpId, 25);
        assert.equal(await drift(closed.topUpId), 1);
        await one(`SELECT public.close_top_up_return($1, $2, NULL) AS r`, [closed.topUpId, cs]);
        assert.equal(await drift(closed.topUpId), 0, "return_closed_at is the operator's escape hatch");

        const paid = await pendingTopUp();
        await recordSession(paid.authId, paid.topUpId, sessionId());
        await age(paid.topUpId, 25);
        assert.equal(await drift(paid.topUpId), 1);
        const credited = (await one(
            `SELECT public.credit_top_up($1, $2, $3, 'USD', $4) AS r`,
            [paid.topUpId, `pi_${randomUUID().replace(/-/g, "")}`, paid.price, paid.variant])).r;
        assert.equal(credited.ok, true, JSON.stringify(credited));
        assert.equal(await drift(paid.topUpId), 0, "crediting is what actually resolves it");
    });

    // ── 6. grants ─────────────────────────────────────────────────────────

    it("the browser roles cannot run the new writer, and the reconcile keeps its grants", async () => {
        for (const role of ["anon", "authenticated"]) {
            for (const fn of ["public.record_top_up_return_session(TEXT, UUID, TEXT)", "public.reconcile_top_ups()"]) {
                assert.equal((await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`, [role, fn])).p,
                    false, `${role} ${fn}`);
            }
        }
        for (const fn of ["public.record_top_up_return_session(TEXT, UUID, TEXT)", "public.reconcile_top_ups()"]) {
            assert.equal((await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS p`, [fn])).p,
                true, fn);
        }
    });
});
