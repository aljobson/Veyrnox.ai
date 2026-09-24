/**
 * Consent attestation acceptance tests — schema/supabase/0096.
 *
 * Write-once on the job, service-role only, and nothing else about the job
 * moves. Runs on schema/0001_initial.sql with the ledger RPCs from 0037/0038.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = ["0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql", "0096_upload_consent_attestation.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("job consent attestation (0096)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    after(async () => { if (pool) await pool.end(); });

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

    async function debitedJob() {
        const u = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`])).id;
        const d = (await one(
            `SELECT public.ledger_debit($1, $2, 13, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
            [u, randomUUID()])).r;
        return d.job_id as string;
    }
    const attest = async (jobId: string) => (await one(`SELECT public.job_consent_attested($1) AS r`, [jobId])).r;

    it("records the statement once and keeps the first timestamp on replay", async () => {
        const jobId = await debitedJob();
        assert.equal((await one(`SELECT consent_attested_at FROM jobs WHERE id = $1`, [jobId])).consent_attested_at, null);
        const first = await attest(jobId);
        assert.equal(first.ok, true);
        const again = await attest(jobId);
        assert.equal(again.attested_at, first.attested_at, "write-once");
        const row = await one(`SELECT state, consent_attested_at FROM jobs WHERE id = $1`, [jobId]);
        assert.equal(row.state, "DEBITED", "nothing else about the job moves");
        assert.equal(new Date(row.consent_attested_at).toISOString(), new Date(first.attested_at).toISOString());
        assert.equal(Number((await one(`SELECT count(*) AS n FROM ledger_entries WHERE job_id = $1`, [jobId])).n), 1);
    });

    it("refuses an unknown job", async () => {
        assert.deepEqual(await attest(randomUUID()), { ok: false, code: "JOB_NOT_FOUND" });
    });

    it("is callable by service_role only", async () => {
        for (const role of ["anon", "authenticated"]) {
            assert.equal((await one(`SELECT has_function_privilege($1, 'public.job_consent_attested(uuid)', 'EXECUTE') AS p`, [role])).p, false, role);
        }
        assert.equal((await one(`SELECT has_function_privilege('service_role', 'public.job_consent_attested(uuid)', 'EXECUTE') AS p`)).p, true);
    });
});
