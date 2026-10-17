/**
 * Credit Packs sold through the Apple and Google stores (0344, ADR-0108).
 *
 * A verified store purchase credits once, on its transaction id, through the
 * same ledger path as a web top-up; a refund claws it back through
 * apply_top_up_refund; and a store pack can never be started through the
 * Stripe checkout function. The migration is applied twice to prove it is
 * idempotent. Like the other top-up suites it applies its own migration chain
 * on the base schema (CI builds that with scripts/migrate.mjs); it also passes
 * on a fully replayed database.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    "0344_store_purchases.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("Store purchases (0344)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;
    const mine: string[] = []; // accounts this suite made; the database is shared with other suites

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const _round of [1, 2]) { // migrations must be idempotent
            for (const m of MIGRATIONS) await pool.query(await readFile(m, "utf8"));
        }
    });
    after(async () => { if (pool) await pool.end(); });

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

    const newUser = async () => {
        const authId = randomUUID(); // auth.users ids are UUIDs; the tenant trigger casts them
        const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, `${randomUUID()}@test.veyrnox.ai`])).id as string;
        const customer = (await one(`SELECT public.get_or_create_store_customer($1) AS r`, [authId])).r;
        mine.push(userId);
        return { authId, userId, customerId: customer.rc_customer_id as string };
    };

    async function storePack({ channel = "ios", credits = 100, price = 1499, active = true } = {}) {
        const id = `${channel}-${randomUUID().slice(0, 8)}`;
        const product = `ai.veyrnox.credits.${randomUUID().slice(0, 8)}`;
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, store_product_id, active)
             VALUES ($1, $2, $3, $4, $5, $6)`, [id, channel, credits, price, product, active]);
        return { id, product, credits, price };
    }

    const buy = async (customerId: string, product: string, transaction: string, channel = "ios") =>
        (await one(`SELECT public.credit_store_purchase($1, $2, $3, $4) AS r`, [customerId, channel, product, transaction])).r;

    const balance = async (userId: string) =>
        Number((await one(`SELECT balance FROM public.credit_balances WHERE user_id = $1`, [userId])).balance);

    const txn = () => `GPA.${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`;

    it("credits a purchase once and replays as a no-op", async () => {
        const { customerId, userId } = await newUser();
        const p = await storePack();
        const t = txn();
        const start = await balance(userId);
        const first = await buy(customerId, p.product, t);
        assert.equal(first.ok, true, JSON.stringify(first));
        assert.equal(first.idempotent, false);
        assert.equal(first.credits, 100);
        assert.equal(await balance(userId), start + 100);
        const again = await buy(customerId, p.product, t);
        assert.equal(again.ok, true);
        assert.equal(again.idempotent, true);
        assert.equal(again.top_up_id, first.top_up_id);
        assert.equal(await balance(userId), start + 100);
        const rows = await one(`SELECT count(*) AS n FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:topup'`, [userId]);
        assert.equal(Number(rows.n), 1);
        const top = await one(`SELECT status, sales_channel, order_id, variant_id FROM public.top_ups WHERE id = $1`, [first.top_up_id]);
        assert.equal(top.status, "credited");
        assert.equal(top.sales_channel, "ios");
        assert.match(top.order_id, /^st_[0-9a-f]{48}$/);
        assert.equal(top.variant_id, null);
    });

    it("gives each account one stable, secret RevenueCat customer id", async () => {
        const a = await newUser();
        const b = await newUser();
        const again = (await one(`SELECT public.get_or_create_store_customer($1) AS r`, [a.authId])).r;
        assert.equal(again.rc_customer_id, a.customerId);
        assert.notEqual(a.customerId, b.customerId);
        assert.notEqual(a.customerId, a.authId);
        assert.deepEqual((await one(`SELECT public.get_or_create_store_customer($1) AS r`, [randomUUID()])).r, { ok: false, code: "USER_NOT_FOUND" });
    });

    it("grants once under concurrent deliveries of the same transaction", async () => {
        const { customerId, userId } = await newUser();
        const p = await storePack();
        const t = txn();
        const start = await balance(userId);
        const results = await Promise.all(Array.from({ length: 6 }, () => buy(customerId, p.product, t)));
        assert.ok(results.every((r) => r.ok === true), JSON.stringify(results));
        assert.equal(results.filter((r) => r.idempotent === false).length, 1);
        assert.equal(await balance(userId), start + 100);
    });

    it("refuses a transaction already credited to another account", async () => {
        const a = await newUser();
        const b = await newUser();
        const p = await storePack();
        const t = txn();
        assert.equal((await buy(a.customerId, p.product, t)).ok, true);
        const stolen = await buy(b.customerId, p.product, t);
        assert.deepEqual(stolen, { ok: false, code: "ORDER_ALREADY_USED" });
        assert.equal(await balance(b.userId), await balance(b.userId));
    });

    it("keeps iOS and Android transaction ids apart", async () => {
        const { customerId } = await newUser();
        const ios = await storePack({ channel: "ios" });
        const android = await storePack({ channel: "android" });
        const t = String(1_000_000_000_000_000 + Math.floor(Math.random() * 1e12)); // Apple ids are numeric
        assert.equal((await buy(customerId, ios.product, t, "ios")).idempotent, false);
        assert.equal((await buy(customerId, android.product, t, "android")).idempotent, false);
    });

    it("rejects bad input and unknown products without moving credits", async () => {
        const { customerId, userId } = await newUser();
        const p = await storePack();
        const start = await balance(userId);
        assert.equal((await buy(customerId, p.product, txn(), "web")).code, "BAD_CHANNEL");
        assert.equal((await buy(customerId, "bad product!", txn())).code, "INVALID_PRODUCT");
        assert.equal((await buy(customerId, p.product, "")).code, "INVALID_TRANSACTION_ID");
        assert.equal((await buy(customerId, "ai.veyrnox.unknown", txn())).code, "PACK_NOT_FOUND");
        assert.equal((await buy(randomUUID(), p.product, txn())).code, "CUSTOMER_NOT_FOUND");
        assert.equal((await buy("not-a-uuid", p.product, txn())).code, "CUSTOMER_NOT_FOUND");
        assert.equal((await buy("", p.product, txn())).code, "CUSTOMER_NOT_FOUND");
        assert.equal(await balance(userId), start);
    });

    it("still credits a purchase made before the pack was retired", async () => {
        const { customerId, userId } = await newUser();
        const p = await storePack({ active: false });
        const start = await balance(userId);
        assert.equal((await buy(customerId, p.product, txn())).ok, true);
        assert.equal(await balance(userId), start + 100);
    });

    it("never lets the Stripe checkout function start a store pack", async () => {
        const { authId } = await newUser();
        const p = await storePack();
        const res = (await one(`SELECT public.create_pending_top_up($1, $2, $3, 'supply-consent-v1', 10, 600) AS r`,
            [authId, p.id, `test-${randomUUID()}`])).r;
        assert.deepEqual(res, { ok: false, code: "PACK_NOT_FOUND" });
    });

    it("still starts a web pack through the Stripe checkout function", async () => {
        const { authId } = await newUser();
        const id = `web-${randomUUID().slice(0, 8)}`;
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active) VALUES ($1, 'web', 200, 1900, true)`, [id]);
        const res = (await one(`SELECT public.create_pending_top_up($1, $2, $3, 'supply-consent-v1', 10, 600) AS r`,
            [authId, id, `test-${randomUUID()}`])).r;
        assert.equal(res.ok, true, JSON.stringify(res));
    });

    it("claws a refunded purchase back in full, once", async () => {
        const { customerId, userId } = await newUser();
        const p = await storePack();
        const t = txn();
        const start = await balance(userId);
        await buy(customerId, p.product, t);
        const refund = (await one(`SELECT public.apply_store_refund('ios', $1) AS r`, [t])).r;
        assert.equal(refund.ok, true, JSON.stringify(refund));
        assert.equal(refund.taken, 100);
        assert.equal(await balance(userId), start);
        const replay = (await one(`SELECT public.apply_store_refund('ios', $1) AS r`, [t])).r;
        assert.equal(replay.ok, true);
        assert.equal(replay.taken, 0);
        assert.equal(await balance(userId), start);
        const unknown = (await one(`SELECT public.apply_store_refund('ios', $1) AS r`, [txn()])).r;
        assert.deepEqual(unknown, { ok: false, code: "ORDER_NOT_FOUND" });
    });

    it("enforces the pack shape and the store-fee floor", async () => {
        const insert = (cols: string, vals: unknown[]) =>
            pool.query(`INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, ${cols}) VALUES ($1, $2, $3, $4, $5)`,
                [`t-${randomUUID().slice(0, 8)}`, ...vals]);
        // 100 credits at $4.60 clears the sticker floor but nets under $0.033/credit after 30%.
        await assert.rejects(insert("store_product_id", ["ios", 100, 460, "ai.veyrnox.cheap"]), /credit_packs_net_floor/);
        await assert.rejects(insert("store_product_id", ["web", 100, 1000, "ai.veyrnox.x"]), /credit_packs_store_product_shape/);
        await assert.rejects(insert("variant_id", ["ios", 100, 1499, null]), /credit_packs_store_product_shape/);
        await assert.rejects(insert("store_product_id", ["windows", 100, 1499, "ai.veyrnox.w"]), /credit_packs_(net_floor|sales_channel_known)/);
    });

    it("keeps the customer table away from browser roles", async () => {
        const row = await one(`SELECT has_table_privilege('anon', 'public.store_customers', 'SELECT') AS anon,
                                      has_table_privilege('authenticated', 'public.store_customers', 'SELECT') AS auth`);
        assert.deepEqual(row, { anon: false, auth: false });
    });

    it("keeps the books balanced", async () => {
        // The invariant itself (CLAUDE.md): balance = SUM(ledger deltas), for the accounts this suite touched.
        assert.equal(Number((await one(`SELECT count(*) AS n FROM public.credit_balances b
            WHERE b.user_id = ANY($1::uuid[])
              AND b.balance <> COALESCE((SELECT sum(l.delta) FROM public.ledger_entries l WHERE l.user_id = b.user_id), 0)`, [mine])).n), 0);
        // reconcile_top_ups (0065) is outside this chain on the base schema.
        if ((await one(`SELECT to_regprocedure('public.reconcile_top_ups()') AS f`)).f) {
            assert.equal(Number((await one(`SELECT count(*) AS n FROM public.reconcile_top_ups() r WHERE r.user_id = ANY($1::uuid[])`, [mine])).n), 0);
        }
    });

    it("is callable by the service role only", async () => {
        for (const fn of ["get_or_create_store_customer(TEXT)", "credit_store_purchase(TEXT, TEXT, TEXT, TEXT)", "apply_store_refund(TEXT, TEXT)", "store_order_id(TEXT, TEXT)"]) {
            const row = await one(
                `SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS anon,
                        has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS auth,
                        has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') AS svc`);
            assert.deepEqual(row, { anon: false, auth: false, svc: true }, fn);
        }
    });
});
