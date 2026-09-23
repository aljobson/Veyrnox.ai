/**
 * A FAILED job must not keep the credits (schema/supabase/0099).
 *
 * job_failed does not refund — the Worker does, in a second call. This pins
 * what happens when that call never lands: reconcile_failed_refunds names
 * the job, and sweep_stuck_jobs pays it exactly once.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = ["0007_job_state_transitions.sql", "0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql",
    "0018_reconcile_and_sweep.sql", "0019_sweep_succeeded_without_asset.sql",
    "0099_failed_without_refund.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("FAILED without a refund (0099)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        // 0018 schedules its crons unguarded, and neither this fixture nor
        // CI's postgres:16-alpine ships pg_cron. Identical to the stub in
        // security-hardening.acceptance.test.ts on purpose: the files share a
        // database, and CREATE OR REPLACE cannot rename a parameter, so two
        // different stubs of cron.schedule would break whichever ran second.
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

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

    /** A debited job, submitted to a provider, then failed — with no refund. */
    async function failedJob(credits = 28) {
        const userId = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`])).id;
        const debit = (await one(
            `SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
            [userId, randomUUID(), credits])).r;
        assert.equal(debit.ok, true);
        const providerJobId = `req_${randomUUID().slice(0, 12)}`;
        assert.equal((await one(`SELECT public.job_submitted($1, 'fal', $2) AS r`, [debit.job_id, providerJobId])).r.ok, true);
        assert.equal((await one(`SELECT public.job_failed($1, 'fal', 'provider_failed') AS r`, [providerJobId])).r.ok, true);
        return { userId: userId as string, jobId: debit.job_id as string, credits };
    }

    const age = (jobId: string, minutes: number) =>
        pool.query(`UPDATE public.jobs SET updated_at = now() - make_interval(mins => $2) WHERE id = $1`, [jobId, minutes]);
    const balance = async (userId: string) =>
        Number((await one(`SELECT balance FROM public.credit_balances WHERE user_id = $1`, [userId])).balance);
    // An explicit 30-minute grace, with fixtures aged 45: inside this file's
    // window, outside the 60-minute default another file's reconcile_status()
    // sample would pick up while these tests run.
    const drift = async (jobId: string) =>
        Number((await one(`SELECT count(*) AS n FROM public.reconcile_failed_refunds(30) WHERE job_id = $1`, [jobId])).n);

    it("names a failure whose refund never landed, and only after the grace period", async () => {
        const job = await failedJob();
        assert.equal(await drift(job.jobId), 0, "a failure minutes old is not yet drift");
        await age(job.jobId, 45);
        assert.equal(await drift(job.jobId), 1);
        // The refund the Worker should have made clears it.
        const r = (await one(`SELECT public.ledger_refund($1, $2, $3, 'refund:provider_failed') AS r`,
            [job.jobId, job.userId, job.credits])).r;
        assert.equal(r.ok, true);
        assert.equal(await drift(job.jobId), 0);
    });

    it("the sweep pays it once, and a second sweep changes nothing", async () => {
        const job = await failedJob();
        const before_ = await balance(job.userId);
        await age(job.jobId, 45);

        const first = (await one(`SELECT public.sweep_stuck_jobs() AS r`)).r;
        assert.equal(first.ok, true);
        assert.ok(first.unpaid_failures >= 1, JSON.stringify(first));
        assert.equal(await balance(job.userId), before_ + job.credits);
        assert.equal(await drift(job.jobId), 0);

        const second = (await one(`SELECT public.sweep_stuck_jobs() AS r`)).r;
        assert.equal(second.ok, true);
        assert.equal(await balance(job.userId), before_ + job.credits, "no second refund");
        assert.equal(
            Number((await one(`SELECT count(*) AS n FROM public.ledger_entries WHERE job_id = $1 AND delta > 0`, [job.jobId])).n),
            1, "exactly one refund row");
    });

    it("leaves a failure that was already refunded alone", async () => {
        const job = await failedJob();
        assert.equal((await one(`SELECT public.ledger_refund($1, $2, $3, 'refund:provider_failed') AS r`,
            [job.jobId, job.userId, job.credits])).r.ok, true);
        const after_ = await balance(job.userId);
        await age(job.jobId, 45);

        await one(`SELECT public.sweep_stuck_jobs() AS r`);
        assert.equal(await balance(job.userId), after_);
        assert.equal(await drift(job.jobId), 0);
    });

    it("browser roles cannot read the invariant or run the sweep", async () => {
        for (const role of ["anon", "authenticated"]) {
            for (const fn of ["public.reconcile_failed_refunds(INTEGER)", "public.sweep_stuck_jobs(INTEGER, INTEGER, INTEGER, INTEGER)"]) {
                assert.equal((await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`, [role, fn])).p, false, `${role} ${fn}`);
            }
        }
        assert.equal((await one(`SELECT has_function_privilege('service_role', 'public.reconcile_failed_refunds(INTEGER)', 'EXECUTE') AS p`)).p, true);
    });
});
