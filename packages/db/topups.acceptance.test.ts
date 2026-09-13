/**
 * Credit Pack + pending Top-up acceptance tests (#92, ADR-0018).
 *
 * Skipped unless DATABASE_URL is set. The base schema comes from
 * scripts/migrate.mjs; this suite applies the Supabase-dir migration under
 * test itself (twice, to prove it is idempotent), after stubbing the
 * Supabase roles its grants name.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION = new URL("./schema/supabase/0041_credit_packs_and_top_ups.sql", import.meta.url);
const FN = "public.create_pending_top_up(text,text,text,integer,integer)";

describe("Credit Pack Top-ups", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query(`DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
        END $$`);
        const sql = await readFile(MIGRATION, "utf8");
        await pool.query(sql);
        await pool.query(sql);
    });

    after(async () => {
        if (pool) await pool.end();
    });

    async function makeUser() {
        const authId = `sb_${randomUUID()}`;
        await pool.query(`INSERT INTO users (auth_id, email) VALUES ($1, $2)`, [authId, `${randomUUID()}@test.veyrnox.ai`]);
        return authId;
    }

    async function makePack({ credits = 100, price = 1000, active = true } = {}) {
        const id = `test-${randomUUID().slice(0, 8)}`;
        const variant = String(randomInt(1e9, 2e9));
        await pool.query(
            `INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, variant_id, active)
             VALUES ($1, 'web', $2, $3, $4, $5)`,
            [id, credits, price, variant, active]
        );
        return { id, variant };
    }

    async function createTopUp(authId: string, packId: string, version = "2026-09-13", limit = 10, windowSeconds = 600) {
        const r = await pool.query(`SELECT public.create_pending_top_up($1, $2, $3, $4, $5) AS res`, [authId, packId, version, limit, windowSeconds]);
        return r.rows[0].res;
    }

    it("seeds the three web packs at ADR-0018 prices, inactive until a variant is configured", async () => {
        const r = await pool.query(
            `SELECT id, credits, price_usd_cents, sales_channel FROM public.credit_packs
             WHERE id IN ('web-100', 'web-300', 'web-1000') ORDER BY credits`
        );
        assert.deepEqual(
            r.rows.map((p) => [p.id, p.credits, p.price_usd_cents, p.sales_channel]),
            [["web-100", 100, 1000, "web"], ["web-300", 300, 2500, "web"], ["web-1000", 1000, 7500, "web"]]
        );
        await assert.rejects(
            pool.query(`UPDATE public.credit_packs SET active = true, variant_id = NULL WHERE id = 'web-100'`),
            /credit_packs_active_needs_variant/
        );
    });

    it("rejects a pack below the $0.075/credit sticker floor", async () => {
        await assert.rejects(makePack({ credits: 100, price: 749 }), /credit_packs_sticker_floor/);
        const ok = await makePack({ credits: 100, price: 750 });
        await assert.rejects(
            pool.query(`UPDATE public.credit_packs SET price_usd_cents = 700 WHERE id = $1`, [ok.id]),
            /credit_packs_sticker_floor/
        );
    });

    it("rejects a pack whose net of the Merchant of Record fee is below $0.033/credit", async () => {
        // 1 credit for 8c clears the sticker floor, but LemonSqueezy's fixed 50c fee eats it.
        await assert.rejects(makePack({ credits: 1, price: 8 }), /credit_packs_net_floor/);
    });

    it("creates a pending Top-up that records consent and copies the pack's credits, price and variant", async () => {
        const authId = await makeUser();
        const pack = await makePack({ credits: 300, price: 2500 });
        const res = await createTopUp(authId, pack.id, "2026-09-13");
        assert.equal(res.ok, true);
        assert.match(res.top_up_id, /^[0-9a-f-]{36}$/);
        assert.equal(res.variant_id, pack.variant);

        // A later price change must not alter a Top-up already started.
        await pool.query(`UPDATE public.credit_packs SET price_usd_cents = 3000 WHERE id = $1`, [pack.id]);

        const row = (await pool.query(
            `SELECT t.*, u.auth_id, t.consent_at > now() - interval '1 minute' AS consent_recent
             FROM public.top_ups t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
            [res.top_up_id]
        )).rows[0];
        assert.equal(row.auth_id, authId);
        assert.equal(row.status, "pending");
        assert.equal(row.pack_id, pack.id);
        assert.equal(row.sales_channel, "web");
        assert.equal(row.credits, 300);
        assert.equal(row.price_usd_cents, 2500);
        assert.equal(row.variant_id, pack.variant);
        assert.equal(row.consent_version, "2026-09-13");
        assert.equal(row.consent_recent, true, "consent timestamp is the server's now()");

        const ledger = await pool.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1`, [row.user_id]);
        assert.equal(ledger.rows[0].n, 0, "a pending Top-up moves no credits");
    });

    it("refuses an unknown or inactive pack with PACK_NOT_FOUND", async () => {
        const authId = await makeUser();
        assert.equal((await createTopUp(authId, "no-such-pack")).code, "PACK_NOT_FOUND");
        const inactive = await makePack({ active: false });
        assert.equal((await createTopUp(authId, inactive.id)).code, "PACK_NOT_FOUND");
        const n = await pool.query(
            `SELECT count(*)::int AS n FROM public.top_ups t JOIN users u ON u.id = t.user_id WHERE u.auth_id = $1`,
            [authId]
        );
        assert.equal(n.rows[0].n, 0);
    });

    it("refuses an unknown user and a blank consent version", async () => {
        const pack = await makePack();
        assert.equal((await createTopUp(`sb_${randomUUID()}`, pack.id)).code, "USER_NOT_FOUND");
        assert.equal((await createTopUp(await makeUser(), pack.id, "")).code, "CONSENT_VERSION_REQUIRED");
    });

    it("rate-limits Top-up creation per user", async () => {
        const authId = await makeUser();
        const pack = await makePack();
        assert.equal((await createTopUp(authId, pack.id, "v1", 2)).ok, true);
        assert.equal((await createTopUp(authId, pack.id, "v1", 2)).ok, true);
        const third = await createTopUp(authId, pack.id, "v1", 2);
        assert.equal(third.code, "RATE_LIMITED");
        assert.ok(third.retry_after_seconds >= 1);
        assert.equal((await createTopUp(await makeUser(), pack.id, "v1", 2)).ok, true, "limit is per user");
    });

    it("forces RLS on both tables and leaves the function to service_role only", async () => {
        const rls = await pool.query(
            `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
             WHERE oid IN ('public.credit_packs'::regclass, 'public.top_ups'::regclass) ORDER BY relname`
        );
        for (const r of rls.rows) {
            assert.equal(r.relrowsecurity, true, `${r.relname} RLS enabled`);
            assert.equal(r.relforcerowsecurity, true, `${r.relname} RLS forced`);
        }
        const priv = await pool.query(
            `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                    has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                    has_function_privilege('service_role', $1, 'EXECUTE') AS service,
                    has_table_privilege('anon', 'public.top_ups', 'SELECT') AS anon_topups,
                    has_table_privilege('authenticated', 'public.credit_packs', 'SELECT') AS authed_packs`,
            [FN]
        );
        assert.deepEqual(priv.rows[0], { anon: false, authed: false, service: true, anon_topups: false, authed_packs: false });
        const def = await pool.query(
            `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`,
            [FN]
        );
        assert.equal(def.rows[0].prosecdef, true);
        assert.deepEqual(def.rows[0].proconfig, ['search_path=""']);
    });
});
