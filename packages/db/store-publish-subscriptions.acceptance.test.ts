/**
 * Publish Plan subscriptions bought in the apps (0346, ADR-0109).
 *
 * A RevenueCat subscription event moves a social_publish_subscriptions row for the account that owns the
 * secret customer id; the existing entitlement read does the rest. Migrations are applied twice.
 * It applies only the parts this database lacks (the CI database is shared by every suite, and an older
 * migration replayed over a newer one would undo it).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Each part is applied only when this database does not have it yet: the CI database is shared by every
// acceptance suite, and replaying an older migration over a newer one would undo it.
const CREDIT_CHAIN = [
    "0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql", "0041_credit_packs_and_top_ups.sql",
    "0054_credit_top_up.sql", "0058_top_up_refund_clawback.sql", "0059_chargeback_freeze.sql", "0060_top_up_backfill.sql",
    "0066_freeze_since_purchase.sql", "0097_stripe_money_path_ids.sql", "0167_stripe_packs_without_variant.sql",
    "0174_flagged_orders_append_only.sql",
];
const SOCIAL_CHAIN = [
    "0293_social_publish_plans.sql", "0298_social_publish_paid_entitlements.sql",
    "0340_weekly_social_publish_plan.sql", "0341_annual_social_publish_plan.sql",
];
const FINAL = "0346_store_publish_subscriptions.sql";
const file = (f: string) => new URL(`./schema/supabase/${f}`, import.meta.url);

describe("Store Publish subscriptions (0346)", { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const mine: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;

    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
            END LOOP; END $$`);
        const has = async (rel: string) => (await pool.query("SELECT to_regclass($1) AS r", [rel])).rows[0].r !== null;
        if (!(await has("public.store_customers"))) {
            if (!(await has("public.credit_packs"))) for (const f of CREDIT_CHAIN) await pool.query(await readFile(file(f), "utf8"));
            await pool.query(await readFile(file("0344_store_purchases.sql"), "utf8"));
        }
        if (!(await has("public.social_publish_plans"))) for (const f of SOCIAL_CHAIN) await pool.query(await readFile(file(f), "utf8"));
        for (const _round of [1, 2]) await pool.query(await readFile(file(FINAL), "utf8"));
    });
    after(async () => { if (pool) await pool.end(); });

    async function account() {
        const auth = randomUUID();
        await pool.query("INSERT INTO auth.users(id, email) VALUES ($1, $2)", [auth, `${auth}@test.veyrnox.ai`]);
        await one("SELECT public.signup_grant($1, $2) AS id", [auth, `${auth}@test.veyrnox.ai`]);
        const customer = (await value("SELECT public.get_or_create_store_customer($1) AS value", [auth])).rc_customer_id as string;
        const userId = (await one("SELECT id FROM public.users WHERE auth_id = $1", [auth])).id as string;
        mine.push(userId);
        return { auth, customer, userId };
    }
    const entitlement = (auth: string) => value("SELECT public.read_social_publish_entitlement($1) AS value", [auth]);
    const day = 86_400_000;
    const at = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
    let counter = 0;
    const event = (customer: string, over: Record<string, unknown> = {}) => {
        const a = { product: "ai.veyrnox.publish.monthly", txn: `1000${Date.now()}${counter++}`, id: `evt-${randomUUID()}`, action: "activate",
            type: "renewal", end: at(30 * day), when: at(), channel: "ios", ...over };
        return value("SELECT public.apply_store_publish_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value",
            [customer, a.channel, a.product, a.txn, a.id, a.action, a.type, a.end, a.when]).then((r) => ({ r, a }));
    };

    it("activates a purchase and the entitlement turns on", async () => {
        const u = await account();
        const { r } = await event(u.customer, { type: "initial_purchase" });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.status, "active");
        const e = await entitlement(u.auth);
        assert.equal(e.tier, "publish");
        assert.equal(e.subscription.plan_id, "publish");
        assert.equal(e.subscription.status, "active");
    });

    it("replays an event as a no-op", async () => {
        const u = await account();
        const first = await event(u.customer);
        const again = await value("SELECT public.apply_store_publish_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value",
            [u.customer, "ios", first.a.product, first.a.txn, first.a.id, "activate", "renewal", first.a.end, first.a.when]);
        assert.equal(again.idempotent, true);
        assert.equal(again.subscription_id, first.r.subscription_id);
        const n = await one("SELECT count(*) AS n FROM public.social_publish_subscriptions WHERE user_id = $1", [u.userId]);
        assert.equal(Number(n.n), 1);
    });

    it("renews, cancels at period end and then expires", async () => {
        const u = await account();
        const first = await event(u.customer, { when: at(-2000), end: at(10 * day) });
        const renewed = await event(u.customer, { txn: first.a.txn, when: at(-1000), end: at(40 * day) });
        assert.equal(renewed.r.status, "active");
        const cancelled = await event(u.customer, { txn: first.a.txn, action: "cancel_at_period_end", type: "cancellation", when: at(-500), end: at(40 * day) });
        assert.equal(cancelled.r.status, "active");
        const e = await entitlement(u.auth);
        assert.equal(e.tier, "publish");
        assert.equal(e.subscription.cancel_at_period_end, true);
        const expired = await event(u.customer, { txn: first.a.txn, action: "expire", type: "expiration", when: at(-100), end: null });
        assert.equal(expired.r.status, "ended");
        assert.equal((await entitlement(u.auth)).tier, "free");
        const row = await one("SELECT end_reason FROM public.social_publish_subscriptions WHERE id = $1", [first.r.subscription_id]);
        assert.equal(row.end_reason, "subscription_ended");
    });

    it("ignores an older event than the last one applied", async () => {
        const u = await account();
        const first = await event(u.customer, { when: at(-1000) });
        const stale = await event(u.customer, { txn: first.a.txn, action: "expire", type: "expiration", when: at(-5000), end: null });
        assert.equal(stale.r.stale, true);
        assert.equal(stale.r.status, "active");
        assert.equal((await entitlement(u.auth)).tier, "publish");
    });

    it("ends a refunded subscription and reopens it on a later purchase", async () => {
        const u = await account();
        const first = await event(u.customer, { when: at(-3000) });
        const refund = await event(u.customer, { txn: first.a.txn, action: "refund", type: "cancellation", when: at(-2000), end: null });
        assert.equal(refund.r.status, "ended");
        assert.equal((await one("SELECT end_reason FROM public.social_publish_subscriptions WHERE id = $1", [first.r.subscription_id])).end_reason, "refunded");
        assert.equal((await entitlement(u.auth)).tier, "free");
        const again = await event(u.customer, { txn: first.a.txn, when: at(-1000), end: at(30 * day) });
        assert.equal(again.r.status, "active");
        assert.equal((await entitlement(u.auth)).tier, "publish");
    });

    it("moves to another plan on a product change", async () => {
        const u = await account();
        const first = await event(u.customer, { product: "ai.veyrnox.publish.weekly", when: at(-2000), end: at(7 * day) });
        assert.equal((await entitlement(u.auth)).subscription.plan_id, "publish-weekly");
        await event(u.customer, { txn: first.a.txn, product: "ai.veyrnox.publish.annual", type: "product_change", when: at(-1000), end: at(365 * day) });
        const e = await entitlement(u.auth);
        assert.equal(e.subscription.plan_id, "publish-annual");
        assert.equal(e.subscription.price_usd_cents, 12600);
    });

    it("flags, never entitles, a store purchase while another plan is live", async () => {
        const u = await account();
        await pool.query(`INSERT INTO public.social_publish_subscriptions
            (user_id, plan_id, idempotency_key, price_usd_cents, consent_version, status, current_period_end, started_at)
            VALUES ($1, 'publish', $2, 1500, 'publish-plan-2026-10-13', 'active', now() + interval '20 days', now())`, [u.userId, `web-${randomUUID()}`]);
        const { r } = await event(u.customer);
        assert.equal(r.status, "flagged");
        assert.equal(r.flagged, true);
        const e = await entitlement(u.auth);
        assert.equal(e.subscription.plan_id, "publish");
        assert.equal(e.subscription.stripe_subscription_id, null);
        const live = await one("SELECT count(*) AS n FROM public.social_publish_subscriptions WHERE user_id = $1 AND status IN ('active','past_due')", [u.userId]);
        assert.equal(Number(live.n), 1);
    });

    it("keeps one subscription under concurrent deliveries", async () => {
        const u = await account();
        const a = { txn: `2000${Date.now()}`, id: `evt-${randomUUID()}` };
        const results = await Promise.all(Array.from({ length: 6 }, () => value(
            "SELECT public.apply_store_publish_event($1,'ios','ai.veyrnox.publish.monthly',$2,$3,'activate','renewal',$4,$5) AS value",
            [u.customer, a.txn, a.id, at(30 * day), at()])));
        assert.ok(results.every((r) => r.ok === true), JSON.stringify(results));
        assert.equal(results.filter((r) => r.idempotent === false).length, 1);
        assert.equal(Number((await one("SELECT count(*) AS n FROM public.social_publish_subscriptions WHERE user_id = $1", [u.userId])).n), 1);
    });

    it("refuses another account, unknown customers, unmapped products and stray events", async () => {
        const a = await account();
        const b = await account();
        const first = await event(a.customer);
        const theft = await event(b.customer, { txn: first.a.txn });
        assert.deepEqual(theft.r, { ok: false, code: "SUBSCRIPTION_OWNED_BY_OTHER" });
        assert.equal((await event(randomUUID())).r.code, "CUSTOMER_NOT_FOUND");
        assert.equal((await event("nope")).r.code, "CUSTOMER_NOT_FOUND");
        assert.equal((await event(a.customer, { product: "ai.veyrnox.publish.daily" })).r.code, "PLAN_NOT_FOUND");
        assert.equal((await event(a.customer, { action: "expire", end: null })).r.code, "SUBSCRIPTION_NOT_FOUND");
        assert.equal((await event(a.customer, { action: "activate", end: null })).r.code, "INVALID_EVENT");
        assert.equal((await event(a.customer, { channel: "web" })).r.code, "INVALID_EVENT");
        assert.equal((await event(a.customer, { id: "x" })).r.code, "INVALID_EVENT");
    });

    it("does not touch the credit ledger", async () => {
        const u = await account();
        const before = await one("SELECT count(*) AS n FROM public.ledger_entries WHERE user_id = $1", [u.userId]);
        await event(u.customer);
        const after = await one("SELECT count(*) AS n FROM public.ledger_entries WHERE user_id = $1", [u.userId]);
        assert.equal(after.n, before.n);
    });

    it("is callable by the service role only, and its tables are closed to browser roles", async () => {
        const fn = "apply_store_publish_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)";
        assert.deepEqual(await one(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') AS anon,
            has_function_privilege('authenticated','public.${fn}','EXECUTE') AS auth,
            has_function_privilege('service_role','public.${fn}','EXECUTE') AS svc`), { anon: false, auth: false, svc: true });
        assert.deepEqual(await one(`SELECT has_table_privilege('anon','public.social_publish_store_products','SELECT') AS anon,
            has_table_privilege('authenticated','public.social_publish_store_products','SELECT') AS auth`), { anon: false, auth: false });
    });
});
