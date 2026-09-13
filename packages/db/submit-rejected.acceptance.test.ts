/**
 * Submit-rejection acceptance tests — issue #117.
 *
 * A provider refusing a submit records a typed error_code on the job
 * (job_submit_rejected, schema/supabase/0053) and the refund that follows is
 * unchanged. Runs the production RPCs from 0037/0038 on top of
 * schema/0001_initial.sql.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = ["0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql", "0053_job_submit_rejected.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("Submit rejection error_code (#117)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
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

    after(async () => {
        if (pool) await pool.end();
    });

    async function one(sql: string, params: unknown[] = []) {
        return (await pool.query(sql, params)).rows[0];
    }

    async function debitedJob() {
        const u = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`])).id;
        const d = (await one(
            `SELECT public.ledger_debit($1, $2, 28, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
            [u, randomUUID()])).r;
        assert.equal(d.ok, true);
        return { userId: u as string, jobId: d.job_id as string };
    }

    const reject = async (jobId: string, code: string | null) =>
        (await one(`SELECT public.job_submit_rejected($1, $2) AS r`, [jobId, code])).r;
    const job = (jobId: string) => one(`SELECT state, error_code FROM jobs WHERE id = $1`, [jobId]);
    const balance = (userId: string) => one(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId]);

    it("records the code on a DEBITED job and leaves the state and ledger alone", async () => {
        const { userId, jobId } = await debitedJob();
        const before = await balance(userId);
        assert.equal((await reject(jobId, "provider_payment_required")).ok, true);
        assert.deepEqual(await job(jobId), { state: "DEBITED", error_code: "provider_payment_required" });
        assert.deepEqual(await balance(userId), before);
        assert.equal(Number((await one(`SELECT count(*) AS n FROM ledger_entries WHERE job_id = $1`, [jobId])).n), 1);
    });

    it("replay is a no-op with the same result", async () => {
        const { jobId } = await debitedJob();
        assert.equal((await reject(jobId, "provider_auth_failed")).ok, true);
        assert.equal((await reject(jobId, "provider_auth_failed")).ok, true);
        assert.deepEqual(await job(jobId), { state: "DEBITED", error_code: "provider_auth_failed" });
    });

    it("the refund that follows is unchanged and keeps the code", async () => {
        const { userId, jobId } = await debitedJob();
        const before = await balance(userId);
        await reject(jobId, "provider_payment_required");
        const r = (await one(`SELECT public.ledger_refund($1, $2, 28, 'refund:submit_failed') AS r`, [jobId, userId])).r;
        assert.equal(r.ok, true);
        assert.deepEqual(await job(jobId), { state: "REFUNDED", error_code: "provider_payment_required" });
        assert.equal((await balance(userId)).balance, before.balance + 28);
        assert.equal((await pool.query(`SELECT * FROM public.reconcile_free_credits()`)).rowCount, 0);
        // After the refund the job is no longer rejectable.
        assert.equal((await reject(jobId, "provider_timeout")).code, "JOB_NOT_FOUND_OR_BAD_STATE");
        assert.equal((await job(jobId)).error_code, "provider_payment_required");
    });

    it("refuses untyped codes, so vendor text cannot be stored", async () => {
        const { jobId } = await debitedJob();
        for (const bad of [null, "", "Insufficient credits. Add more", "provider-payment", "x".repeat(65)]) {
            assert.equal((await reject(jobId, bad)).code, "INVALID_ERROR_CODE");
        }
        assert.equal((await job(jobId)).error_code, null);
    });

    it("does not touch a submitted job or an unknown id", async () => {
        const { jobId } = await debitedJob();
        await pool.query(`UPDATE jobs SET state = 'SUBMITTED', provider = 'openrouter', provider_job_id = 'job-1' WHERE id = $1`, [jobId]);
        assert.equal((await reject(jobId, "provider_error")).code, "JOB_NOT_FOUND_OR_BAD_STATE");
        assert.equal((await reject(randomUUID(), "provider_error")).code, "JOB_NOT_FOUND_OR_BAD_STATE");
        assert.equal((await job(jobId)).error_code, null);
    });

    it("only service_role may call it", async () => {
        const fn = "public.job_submit_rejected(uuid, text)";
        for (const [role, allowed] of [["anon", false], ["authenticated", false], ["service_role", true]] as const) {
            const r = await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, fn]);
            assert.equal(r.ok, allowed, role);
        }
    });
});
