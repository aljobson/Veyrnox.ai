/**
 * Security-hardening acceptance tests — the 2026-09-16 audit fixes.
 *
 * Exercises schema/supabase/0070 (browser roles lose the money tables),
 * 0071 (the sign-up grant follows email confirmation), 0072
 * (reconcile_status) and 0073 (ledger_grant idempotency), applied twice on
 * top of the Free Credits / Top-up stack to prove idempotency.
 *
 * These four are the ones with no other check: 0070 and 0071 change who can
 * do what rather than what a function returns, and a GRANT that quietly stops
 * applying is invisible until someone goes looking. Skipped unless
 * DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = [
    // 0018/0019 bring reconcile_balances and the stuck-job sweep, which 0072
    // reads; the rest is the Free Credits / Top-up stack the money RPCs need.
    "0018_reconcile_and_sweep.sql",
    "0019_sweep_succeeded_without_asset.sql",
    "0037_free_credit_expiry.sql",
    "0038_free_credit_sweep_fixes.sql",
    "0041_credit_packs_and_top_ups.sql",
    "0054_credit_top_up.sql",
    "0058_top_up_refund_clawback.sql",
    "0059_chargeback_freeze.sql",
    "0060_top_up_backfill.sql",
    "0062_freeze_credits_taken.sql",
    "0065_operator_top_up_reads.sql",
    "0066_freeze_since_purchase.sql",
    "0070_revoke_anon_table_grants.sql",
    "0071_signup_grant_on_email_confirmation.sql",
    "0072_reconcile_status_rpc.sql",
    "0073_ledger_grant_idempotency.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

const MIGRATION_0070 = new URL("./schema/supabase/0070_revoke_anon_table_grants.sql", import.meta.url);

// Tables a browser role must not be able to write, and the five of those it
// may still read (each carries an owner-scoped SELECT policy).
const MONEY_TABLES = ["users", "credit_balances", "ledger_entries", "jobs", "assets", "webhook_events"];
const OWNER_READ = ["users", "credit_balances", "ledger_entries", "jobs", "assets"];

describe("security hardening (audit 2026-09-16)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        // 0018 schedules the reconcile and sweep jobs unguarded, and neither
        // this fixture nor CI's postgres:16-alpine ships pg_cron. Stub the
        // three things it touches so the migration applies; scheduling is not
        // what these tests are about. Same spirit as creating the Supabase
        // roles above — make the environment look enough like production.
        await pool.query(`DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
            CREATE SCHEMA IF NOT EXISTS cron;
            CREATE TABLE IF NOT EXISTS cron.job (jobid BIGSERIAL PRIMARY KEY, jobname TEXT, schedule TEXT, command TEXT);
            CREATE OR REPLACE FUNCTION cron.schedule(p_name TEXT, p_schedule TEXT, p_command TEXT)
            RETURNS BIGINT LANGUAGE sql AS $fn$
                INSERT INTO cron.job (jobname, schedule, command)
                VALUES (p_name, p_schedule, p_command) RETURNING jobid;
            $fn$;
            CREATE OR REPLACE FUNCTION cron.unschedule(p_name TEXT)
            RETURNS BOOLEAN LANGUAGE sql AS $fn$
                DELETE FROM cron.job WHERE jobname = p_name; SELECT true;
            $fn$;
        END $$;`);

        for (const round of [1, 2]) { // migrations must be idempotent
            for (const m of MIGRATIONS) await pool.query(await readFile(m, "utf8"));
        }
    });

    after(async () => {
        if (pool) await pool.end();
    });

    async function one(sql: string, params: unknown[] = []) {
        const res = await pool.query(sql, params);
        return res.rows[0];
    }

    async function signup(): Promise<string> {
        const r = await one(`SELECT public.signup_grant($1, $2) AS id`,
            [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`]);
        return r.id;
    }

    const balance = async (userId: string) =>
        Number((await one(`SELECT balance FROM public.credit_balances WHERE user_id = $1`, [userId])).balance);

    // ── 0070 ────────────────────────────────────────────────────────────────

    describe("0070 — browser roles cannot write the money tables", () => {
        for (const role of ["anon", "authenticated"]) {
            it(`${role} has no INSERT, UPDATE, DELETE or TRUNCATE`, async () => {
                for (const table of MONEY_TABLES) {
                    for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
                        const r = await one(
                            `SELECT has_table_privilege($1, $2::regclass, $3) AS ok`,
                            [role, `public.${table}`, priv]);
                        assert.equal(r.ok, false, `${role} still has ${priv} on ${table}`);
                    }
                }
            });
        }

        // A fresh Postgres grants a new role nothing, so the assertions above
        // would pass even if the migration did nothing. Hand the grants back
        // and re-apply: this is the one that proves 0070 actually revokes.
        it("takes the grants away again after they are handed back", async () => {
            await pool.query(`GRANT ALL ON public.ledger_entries, public.credit_balances TO anon, authenticated`);
            const before = await one(
                `SELECT has_table_privilege('anon', 'public.ledger_entries'::regclass, 'TRUNCATE') AS ok`);
            assert.equal(before.ok, true, "the fixture failed to hand back the grant");

            await pool.query(await readFile(MIGRATION_0070, "utf8"));

            for (const role of ["anon", "authenticated"]) {
                for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
                    const r = await one(
                        `SELECT has_table_privilege($1, 'public.ledger_entries'::regclass, $2) AS ok`, [role, priv]);
                    assert.equal(r.ok, false, `${role} kept ${priv} after 0070 re-ran`);
                }
            }
            // …and the owner read survives the round trip.
            const read = await one(
                `SELECT has_table_privilege('authenticated', 'public.credit_balances'::regclass, 'SELECT') AS ok`);
            assert.equal(read.ok, true);
        });

        // TRUNCATE is the one that matters most: RLS does not filter it and
        // ledger_entries_no_update is a row trigger, so a TRUNCATE would go
        // straight past the append-only guarantee.
        it("authenticated cannot TRUNCATE the ledger", async () => {
            const r = await one(
                `SELECT has_table_privilege('authenticated', 'public.ledger_entries'::regclass, 'TRUNCATE') AS ok`);
            assert.equal(r.ok, false);
        });

        it("authenticated keeps SELECT where an owner-read policy exists", async () => {
            for (const table of OWNER_READ) {
                const r = await one(
                    `SELECT has_table_privilege('authenticated', $1::regclass, 'SELECT') AS ok`,
                    [`public.${table}`]);
                assert.equal(r.ok, true, `${table} lost its owner read`);
            }
        });

        it("webhook_events stays backend-only", async () => {
            const r = await one(
                `SELECT has_table_privilege('authenticated', 'public.webhook_events'::regclass, 'SELECT') AS ok`);
            assert.equal(r.ok, false);
        });
    });

    // ── 0071 ────────────────────────────────────────────────────────────────

    describe("0071 — the sign-up grant follows confirmation", () => {
        it("provision_user creates the row and a zero balance, and grants nothing", async () => {
            const r = await one(`SELECT public.provision_user($1, $2) AS id`,
                [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`]);
            assert.equal(await balance(r.id), 0);
            const g = await one(
                `SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`,
                [r.id]);
            assert.equal(g.n, 0, "an unconfirmed sign-up was funded");
        });

        it("signup_grant still grants 50 once, and only once", async () => {
            const authId = `sb_${randomUUID()}`;
            const email = `${randomUUID()}@test.veyrnox.ai`;
            const first = (await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, email])).id;
            assert.equal(await balance(first), 50);
            const again = (await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, email])).id;
            assert.equal(again, first);
            assert.equal(await balance(first), 50, "a replayed grant funded the account twice");
        });

        it("signup_grant on an already-provisioned user tops it up to the grant", async () => {
            const authId = `sb_${randomUUID()}`;
            const email = `${randomUUID()}@test.veyrnox.ai`;
            // The shape the confirmation trigger produces: provision on
            // INSERT while unconfirmed, grant when the address is confirmed.
            const id = (await one(`SELECT public.provision_user($1, $2) AS id`, [authId, email])).id;
            assert.equal(await balance(id), 0);
            assert.equal((await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, email])).id, id);
            assert.equal(await balance(id), 50);
        });

        it("provision_user is not reachable by a browser role", async () => {
            for (const role of ["anon", "authenticated"]) {
                const r = await one(
                    `SELECT has_function_privilege($1, 'public.provision_user(text,text)', 'EXECUTE') AS ok`, [role]);
                assert.equal(r.ok, false);
            }
        });
    });

    // ── 0072 ────────────────────────────────────────────────────────────────

    describe("0072 — reconcile_status", () => {
        it("returns three integer counts and does not move when a clean user is added", async () => {
            // Not an absolute zero: the shared test database carries whatever
            // the other acceptance files left behind. What must hold is that a
            // correctly-granted user adds no drift of its own.
            const before = await one(`SELECT * FROM public.reconcile_status()`);
            for (const k of ["balance_drift", "free_credit_drift", "top_up_drift"]) {
                assert.ok(Number.isInteger(Number(before[k])), `${k} was not a count`);
            }
            await signup();
            const after = await one(`SELECT * FROM public.reconcile_status()`);
            assert.deepEqual(after, before, "a clean sign-up introduced drift");
        });

        it("is anon-callable (the watcher runs without a service-role key) but not for authenticated", async () => {
            const anon = await one(
                `SELECT has_function_privilege('anon', 'public.reconcile_status()', 'EXECUTE') AS ok`);
            assert.equal(anon.ok, true);
            const auth = await one(
                `SELECT has_function_privilege('authenticated', 'public.reconcile_status()', 'EXECUTE') AS ok`);
            assert.equal(auth.ok, false);
        });

        it("reports drift when the balance stops matching the ledger", async () => {
            const client = await pool.connect();
            try {
                // Seeded inside a rolled-back transaction: the shared test
                // database never keeps an inconsistent row.
                await client.query("BEGIN");
                const userId = (await client.query(
                    `SELECT public.signup_grant($1, $2) AS id`,
                    [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`])).rows[0].id;
                await client.query(
                    `UPDATE public.credit_balances SET balance = balance + 999 WHERE user_id = $1`, [userId]);
                const r = (await client.query(`SELECT * FROM public.reconcile_status()`)).rows[0];
                assert.ok(Number(r.balance_drift) > 0, "drift was invisible to the watcher");
            } finally {
                await client.query("ROLLBACK");
                client.release();
            }
        });
    });

    // ── 0073 ────────────────────────────────────────────────────────────────

    describe("0073 — ledger_grant idempotency", () => {
        it("replays a keyed grant as a no-op", async () => {
            const userId = await signup();
            const key = `vx-${randomUUID()}`;
            const first = (await one(`SELECT public.ledger_grant($1, 100, 'grant:topup', $2) AS r`, [userId, key])).r;
            assert.equal(first.ok, true);
            assert.equal(first.idempotent, false);
            assert.equal(await balance(userId), 150);

            const replay = (await one(`SELECT public.ledger_grant($1, 100, 'grant:topup', $2) AS r`, [userId, key])).r;
            assert.equal(replay.ok, true);
            assert.equal(replay.idempotent, true);
            assert.equal(await balance(userId), 150, "the replay minted credits");
        });

        it("keeps distinct keys distinct", async () => {
            const userId = await signup();
            for (const key of [`vx-${randomUUID()}`, `vx-${randomUUID()}`]) {
                const r = (await one(`SELECT public.ledger_grant($1, 25, 'grant:topup', $2) AS r`, [userId, key])).r;
                assert.equal(r.idempotent, false);
            }
            assert.equal(await balance(userId), 100);
        });

        it("keeps both signatures resolvable — no ambiguous overload", async () => {
            // 0037 recreates the three-argument ledger_grant. A DEFAULT on the
            // four-argument one made every three-argument call ambiguous
            // whenever the files were applied in that order.
            const r = await one(`SELECT count(*)::int AS n FROM pg_proc p
                JOIN pg_namespace ns ON ns.oid = p.pronamespace
                WHERE ns.nspname = 'public' AND p.proname = 'ledger_grant'
                  AND pg_get_function_arguments(p.oid) LIKE '%DEFAULT%'`);
            assert.equal(r.n, 0, "a ledger_grant overload has a DEFAULT and can collide");
            const userId = await signup();
            assert.equal((await one(
                `SELECT public.ledger_grant($1, 1, 'grant:topup') AS r`, [userId])).r.ok, true);
            assert.equal((await one(
                `SELECT public.ledger_grant($1, 1, 'grant:topup', $2) AS r`,
                [userId, `vx-${randomUUID()}`])).r.ok, true);
        });

        it("still accepts the three-argument call ADR-0022 documents", async () => {
            const userId = await signup();
            const r = (await one(`SELECT public.ledger_grant($1, 100, 'grant:manual Al Jobson testing') AS r`, [userId])).r;
            assert.equal(r.ok, true);
            assert.equal(await balance(userId), 150);
        });

        it("refuses a malformed key rather than silently dropping it", async () => {
            const userId = await signup();
            const r = (await one(`SELECT public.ledger_grant($1, 10, 'grant:topup', 'short') AS r`, [userId])).r;
            assert.equal(r.ok, false);
            assert.equal(r.code, "IDEMPOTENCY_KEY_INVALID");
            assert.equal(await balance(userId), 50);
        });

        it("still refuses to mint Free Credits", async () => {
            const userId = await signup();
            const r = (await one(`SELECT public.ledger_grant($1, 50, 'grant:signup', $2) AS r`,
                [userId, `vx-${randomUUID()}`])).r;
            assert.equal(r.ok, false);
            assert.equal(r.code, "RESERVED_REASON");
        });

        it("is service_role only", async () => {
            for (const role of ["anon", "authenticated"]) {
                const r = await one(
                    `SELECT has_function_privilege($1, 'public.ledger_grant(uuid,integer,text,text)', 'EXECUTE') AS ok`,
                    [role]);
                assert.equal(r.ok, false);
            }
            const svc = await one(
                `SELECT has_function_privilege('service_role', 'public.ledger_grant(uuid,integer,text,text)', 'EXECUTE') AS ok`);
            assert.equal(svc.ok, true);
        });

        it("leaves the ledger reconciling", async () => {
            const before = await one(`SELECT * FROM public.reconcile_status()`);
            const userId = await signup();
            const key = `vx-${randomUUID()}`;
            await one(`SELECT public.ledger_grant($1, 40, 'grant:topup', $2) AS r`, [userId, key]);
            await one(`SELECT public.ledger_grant($1, 40, 'grant:topup', $2) AS r`, [userId, key]);
            await one(`SELECT public.ledger_grant($1, 7, 'grant:manual') AS r`, [userId]);
            assert.equal(await balance(userId), 97);
            const after = await one(`SELECT * FROM public.reconcile_status()`);
            assert.deepEqual(after, before, "the grants left the ledger out of balance");
        });
    });
});
