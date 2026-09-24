/**
 * Clip Editor step kinds acceptance tests (schema/supabase/0092).
 *
 * 0092 widens job_steps for trim/merge/audio without loosening Auto Short's
 * rules, and adds the clip-edit catalog row inactive. Runs on top of
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
    "0091_auto_short_job_steps.sql", "0092_clip_edit_steps.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("job_steps for the Clip Editor (0092)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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
        one(`SELECT public.job_step_submitted($1, $2, $3::smallint, 'fal', 'fal-ai/ffmpeg-api/merge-videos', $4) AS r`,
            [jobId, step, ordinal, `ce_${run}_${n++}`]);

    it("accepts trim 0..9, merge 0 and audio 0 on one job", async () => {
        const jobId = await debitedJob();
        for (let i = 0; i <= 9; i++) assert.equal((await submit(jobId, "trim", i)).r.ok, true, `trim ${i}`);
        assert.equal((await submit(jobId, "merge", 0)).r.ok, true);
        assert.equal((await submit(jobId, "audio", 0)).r.ok, true);
        const stored = (await one(`SELECT public.job_step_stored($1, 'trim', 0::smallint, 'fal',
            'fal-ai/workflow-utilities/trim-video', 'edits/x/trim-0.mp4', NULL) AS r`, [jobId])).r;
        assert.equal(stored.ok, true);
    });

    it("still refuses positions outside each kind, and unknown kinds", async () => {
        const jobId = await debitedJob();
        for (const [step, ordinal] of [["trim", 10], ["merge", 1], ["audio", 1], ["scene", 4], ["stitch", 1], ["crop", 0]] as const) {
            await assert.rejects(submit(jobId, step, ordinal), /check constraint|violates/, `${step} ${ordinal}`);
        }
    });

    it("adds clip-edit as one inactive veyrnox row at 1 credit per 5 s", async () => {
        const r = await one(`SELECT provider, provider_endpoint, credits_5s, active FROM public.model_catalog WHERE id = 'clip-edit'`);
        assert.deepEqual(r, { provider: "veyrnox", provider_endpoint: "clip-edit:v1", credits_5s: 1, active: false });
    });
});
