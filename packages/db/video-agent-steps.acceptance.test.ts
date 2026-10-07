/**
 * Video agent step kind acceptance tests (schema/supabase/0224).
 *
 * 0224 widens job_steps for `montage` without loosening the other kinds,
 * and adds the video-agent catalog row inactive. Runs on top of
 * schema/0001_initial.sql like job-steps.acceptance.test.ts.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = ["0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql",
    "0091_auto_short_job_steps.sql", "0092_clip_edit_steps.sql", "0224_video_agent_steps.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("job_steps for the video agent (0224)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        // The catalog columns 0029 adds; 0092's catalog row names them.
        await pool.query(`ALTER TABLE public.model_catalog
            ADD COLUMN IF NOT EXISTS cost_unit TEXT NOT NULL DEFAULT 'per_generation',
            ADD COLUMN IF NOT EXISTS billing_seconds NUMERIC(6,2) NULL`);
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
            `SELECT public.ledger_debit($1, $2, 3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
            [u, randomUUID()])).r;
        assert.equal(d.ok, true);
        return d.job_id as string;
    }

    const run = randomUUID().slice(0, 8);
    let n = 0;
    const submit = (jobId: string, step: string, ordinal: number) =>
        one(`SELECT public.job_step_submitted($1, $2, $3::smallint, 'montage', 'video-agent:v1', $4) AS r`,
            [jobId, step, ordinal, `va_${run}_${n++}`]);

    it("accepts one montage step at ordinal 0", async () => {
        const jobId = await debitedJob();
        assert.equal((await submit(jobId, "montage", 0)).r.ok, true);
    });

    it("refuses montage at any other ordinal and still refuses unknown kinds", async () => {
        const jobId = await debitedJob();
        for (const [step, ordinal] of [["montage", 1], ["render", 0]] as const) {
            await assert.rejects(submit(jobId, step, ordinal), /check constraint|violates/, `${step} ${ordinal}`);
        }
    });

    it("replaying the montage submit is a no-op, not a second step", async () => {
        const jobId = await debitedJob();
        const first = (await submit(jobId, "montage", 0)).r;
        const again = await one(`SELECT public.job_step_submitted($1, 'montage', 0::smallint, 'montage', 'video-agent:v1', $2) AS r`,
            [jobId, `va_${run}_replay`]);
        assert.equal(first.ok, true);
        const count = await one(`SELECT count(*)::int AS c FROM public.job_steps WHERE job_id = $1 AND step = 'montage'`, [jobId]);
        assert.equal(count.c, 1, JSON.stringify(again.r));
    });

    it("keeps Auto Short and Clip Editor positions as they were", async () => {
        const jobId = await debitedJob();
        assert.equal((await submit(jobId, "scene", 3)).r.ok, true);
        assert.equal((await submit(jobId, "trim", 9)).r.ok, true);
        await assert.rejects(submit(jobId, "scene", 4), /check constraint|violates/);
    });

    it("still refuses a provider outside the allowlist", async () => {
        const jobId = await debitedJob();
        await assert.rejects(
            one(`SELECT public.job_step_submitted($1, 'montage', 0::smallint, 'unknown', 'video-agent:v1', $2) AS r`, [jobId, `va_${run}_x`]),
            /check constraint|violates/);
    });

    it("adds video-agent as one inactive veyrnox placeholder row", async () => {
        const r = await one(`SELECT provider, provider_endpoint, credits_5s, active FROM public.model_catalog WHERE id = 'video-agent'`);
        assert.deepEqual(r, { provider: "veyrnox", provider_endpoint: "video-agent:v1", credits_5s: 1, active: false });
    });
});
