/**
 * job_steps acceptance tests — Auto Short slice 2 (ADR-0029, schema/supabase/0091).
 *
 * Forward-only step transitions, replay as a no-op, the two-attempt cap, and
 * the service-role-only grants. Runs on top of schema/0001_initial.sql with
 * the ledger RPCs from 0037/0038.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = ["0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql", "0091_auto_short_job_steps.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("job_steps (Auto Short, 0091)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    // Provider job ids are unique across the database, so each run gets its own.
    const run = randomUUID().slice(0, 8);
    const id = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? `${s}_${run}` : s);
    const submitted = async (jobId: string, step: string, ordinal: number, pid: string) =>
        (await one(`SELECT public.job_step_submitted($1, $2, $3::smallint, 'kie', 'veo:veo3_lite', $4) AS r`,
            [jobId, step, ordinal, id(pid)])).r;
    const stored = async (jobId: string, step: string, ordinal: number, key: string | null, text: object | null = null) =>
        (await one(`SELECT public.job_step_stored($1, $2, $3::smallint, 'kie', 'veo:veo3_lite', $4, $5::jsonb) AS r`,
            [jobId, step, ordinal, key, text && JSON.stringify(text)])).r;
    const failed = async (jobId: string, step: string, ordinal: number, code: string) =>
        (await one(`SELECT public.job_step_failed($1, $2, $3::smallint, $4) AS r`, [jobId, step, ordinal, code])).r;
    const row = (jobId: string, step: string, ordinal: number) =>
        one(`SELECT state, attempts, provider_job_id, output_r2_key, error_code FROM job_steps
             WHERE job_id = $1 AND step = $2 AND ordinal = $3`, [jobId, step, ordinal]);
    const ledgerRows = async (jobId: string) =>
        Number((await one(`SELECT count(*) AS n FROM ledger_entries WHERE job_id = $1`, [jobId])).n);

    it("browser roles have nothing; service_role may only read; RLS is forced", async () => {
        for (const role of ["anon", "authenticated"]) {
            for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
                assert.equal((await one(`SELECT has_table_privilege($1, 'public.job_steps', $2) AS p`, [role, priv])).p, false, `${role} ${priv}`);
            }
        }
        assert.equal((await one(`SELECT has_table_privilege('service_role', 'public.job_steps', 'SELECT') AS p`)).p, true);
        for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
            assert.equal((await one(`SELECT has_table_privilege('service_role', 'public.job_steps', $1) AS p`, [priv])).p, false, priv);
        }
        const t = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.job_steps'::regclass`);
        assert.deepEqual(t, { relrowsecurity: true, relforcerowsecurity: true });
        for (const fn of ["job_step_submitted(uuid,text,smallint,text,text,text)",
            "job_step_stored(uuid,text,smallint,text,text,text,jsonb)", "job_step_failed(uuid,text,smallint,text)"]) {
            for (const role of ["anon", "authenticated"]) {
                assert.equal((await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`, [role, `public.${fn}`])).p, false, `${role} ${fn}`);
            }
            assert.equal((await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS p`, [`public.${fn}`])).p, true, fn);
        }
    });

    it("submit, replay no-op, one re-submit, then the cap", async () => {
        const { jobId } = await debitedJob();
        assert.equal((await submitted(jobId, "scene", 0, "task_a")).ok, true);
        const replay = await submitted(jobId, "scene", 0, "task_a");
        assert.equal(replay.ok, true);
        assert.equal(replay.replay, true);
        assert.deepEqual(await row(jobId, "scene", 0),
            { state: "SUBMITTED", attempts: 1, provider_job_id: id("task_a"), output_r2_key: null, error_code: null });
        assert.equal((await submitted(jobId, "scene", 0, "task_b")).attempts, 2);
        assert.equal((await submitted(jobId, "scene", 0, "task_c")).code, "ATTEMPTS_EXHAUSTED");
        assert.equal((await row(jobId, "scene", 0)).provider_job_id, id("task_b"));
        assert.equal(await ledgerRows(jobId), 1, "steps never touch the ledger");
    });

    it("STORED is terminal and a replayed store changes nothing", async () => {
        const { jobId } = await debitedJob();
        await submitted(jobId, "scene", 1, "task_s1");
        assert.equal((await stored(jobId, "scene", 1, "jobs/x/scene-1.mp4")).ok, true);
        const again = await stored(jobId, "scene", 1, "jobs/x/other.mp4");
        assert.equal(again.ok, true);
        assert.equal(again.replay, true);
        assert.equal((await row(jobId, "scene", 1)).output_r2_key, "jobs/x/scene-1.mp4");
        assert.equal((await failed(jobId, "scene", 1, "provider_failed")).code, "STEP_FINISHED");
        assert.equal((await submitted(jobId, "scene", 1, "task_s1b")).code, "STEP_FINISHED");
        assert.equal((await row(jobId, "scene", 1)).state, "STORED");
    });

    it("FAILED is terminal and a replayed failure changes nothing", async () => {
        const { jobId } = await debitedJob();
        await submitted(jobId, "voice", 0, "req_v");
        assert.equal((await failed(jobId, "voice", 0, "provider_failed")).ok, true);
        assert.equal((await failed(jobId, "voice", 0, "other_code")).replay, true);
        assert.equal((await row(jobId, "voice", 0)).error_code, "provider_failed");
        assert.equal((await stored(jobId, "voice", 0, "jobs/x/voice.mp3")).code, "STEP_FINISHED");
    });

    it("only the synchronous script step may be stored without a submit", async () => {
        const { jobId } = await debitedJob();
        assert.equal((await stored(jobId, "script", 0, null, { title: "t", scenes: [] })).ok, true);
        assert.equal((await row(jobId, "script", 0)).state, "STORED");
        assert.equal((await stored(jobId, "stitch", 0, "jobs/x/final.mp4")).code, "STEP_NOT_SUBMITTED");
        assert.equal((await stored(jobId, "voice", 0, null, null)).code, "NO_OUTPUT");
    });

    it("refuses a parent that is not paid and live", async () => {
        const { userId, jobId } = await debitedJob();
        await one(`SELECT public.ledger_refund($1, $2, 28, 'refund:submit_failed') AS r`, [jobId, userId]);
        assert.equal((await submitted(jobId, "voice", 0, "req_late")).code, "JOB_NOT_FOUND_OR_BAD_STATE");
        assert.equal((await submitted(randomUUID(), "voice", 0, "req_none")).code, "JOB_NOT_FOUND_OR_BAD_STATE");
    });

    it("rejects malformed ids, codes and positions", async () => {
        const { jobId } = await debitedJob();
        assert.equal((await submitted(jobId, "voice", 0, "bad id!")).code, "INVALID_PROVIDER_JOB_ID");
        await submitted(jobId, "voice", 0, "req_ok");
        assert.equal((await failed(jobId, "voice", 0, "Vendor said: <boom>")).code, "INVALID_ERROR_CODE");
        await assert.rejects(submitted(jobId, "scene", 4, "task_x"), /job_steps_check|check constraint/);
        await assert.rejects(submitted(jobId, "voice", 1, "task_y"), /job_steps_check|check constraint/);
        await assert.rejects(submitted(jobId, "music", 0, "task_z"), /check constraint/);
    });
});
