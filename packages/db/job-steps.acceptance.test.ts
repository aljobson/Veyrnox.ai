/**
 * Composite jobs (ADR-0029) — acceptance tests for schema/supabase/0091.
 *
 * One debit per parent, steps advance in stages, a ready step is claimed by
 * exactly one caller, replays are no-ops, retries stop at 2 attempts, and a
 * failure refunds the parent exactly once. Built on 0037/0038 (ledger RPCs),
 * 0053 (jobs.error_code) and 0077 (assets.sha256), applied twice to prove
 * idempotency. Skipped unless DATABASE_URL is set.
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
    "0053_job_submit_rejected.sql",
    "0077_asset_content_hash.sql",
    "0091_job_steps.sql",
].map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

const CREDITS = 3;

// The Clip Editor's chain: two trims in parallel -> merge -> audio.
const EDIT_PLAN = [
    { step: "trim", stage: 0, ordinal: 0, provider: "fal", provider_endpoint: "fal-ai/workflow-utilities/trim-video", params: { in_s: 0, out_s: 3 } },
    { step: "trim", stage: 0, ordinal: 1, provider: "fal", provider_endpoint: "fal-ai/workflow-utilities/trim-video", params: { in_s: 1, out_s: 4 } },
    { step: "merge", stage: 1, provider: "fal", provider_endpoint: "fal-ai/ffmpeg-api/merge-videos" },
    { step: "audio", stage: 2, provider: "fal", provider_endpoint: "fal-ai/ffmpeg-api/merge-audio-video", params: { offset_s: 0 } },
];

describe("Composite jobs: job_steps (ADR-0029)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
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

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
    const call = async (fn: string, params: unknown[]) => {
        const ph = params.map((_, i) => `$${i + 1}`).join(", ");
        return (await one(`SELECT public.${fn}(${ph}) AS r`, params)).r;
    };

    async function debitedJob() {
        const u = (await one(`SELECT public.signup_grant($1, $2) AS id`,
            [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`])).id as string;
        const d = (await one(
            `SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'clip-edit', '{}'::jsonb) AS r`,
            [u, randomUUID(), CREDITS])).r;
        assert.equal(d.ok, true);
        return { userId: u, jobId: d.job_id as string };
    }

    const job = (id: string) => one(`SELECT state::text AS state, error_code FROM jobs WHERE id = $1`, [id]);
    const balance = (u: string) => one(`SELECT balance FROM credit_balances WHERE user_id = $1`, [u]);
    const refunds = async (id: string) =>
        Number((await one(`SELECT count(*) AS n FROM ledger_entries WHERE job_id = $1 AND delta > 0`, [id])).n);

    /** Claim, submit and store one stage; returns the steps it ran. */
    async function runStage(jobId: string) {
        const c = await call("job_steps_claim_ready", [jobId]);
        assert.equal(c.ok, true);
        for (const s of c.claimed) {
            const pid = `req_${randomUUID()}`;
            assert.equal((await call("job_step_submitted", [s.id, pid])).ok, true);
            const st = await call("job_step_stored", ["fal", pid, `steps/${jobId}/${randomUUID()}.mp4`, "video/mp4", 1000, "ab".repeat(32), null]);
            assert.equal(st.ok, true);
        }
        return c.claimed;
    }

    it("runs a staged plan end to end: one debit, parent STORED, one asset", async () => {
        const { userId, jobId } = await debitedJob();
        const before = await balance(userId);
        assert.equal((await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)])).ok, true);

        assert.equal((await runStage(jobId)).length, 2, "both trims are ready together");
        assert.equal((await job(jobId)).state, "SUBMITTED");
        assert.deepEqual((await runStage(jobId)).map((s: { step: string }) => s.step), ["merge"]);
        assert.deepEqual((await runStage(jobId)).map((s: { step: string }) => s.step), ["audio"]);

        const done = await call("job_steps_claim_ready", [jobId]);
        assert.equal(done.complete, true);
        const fin = await call("job_composite_stored", [jobId]);
        assert.equal(fin.ok, true);
        assert.equal((await job(jobId)).state, "STORED");
        assert.equal(Number((await one(`SELECT count(*) AS n FROM assets WHERE job_id = $1`, [jobId])).n), 1);
        assert.deepEqual(await balance(userId), before, "no extra debit beyond the one at submit");
        assert.equal((await call("job_composite_stored", [jobId])).idempotent, true);
    });

    it("a later stage is not claimable until every earlier step is STORED", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        const first = await call("job_steps_claim_ready", [jobId]);
        const pid = `req_${randomUUID()}`;
        await call("job_step_submitted", [first.claimed[0].id, pid]);
        await call("job_step_stored", ["fal", pid, `k/${randomUUID()}`, "video/mp4", 1, null, null]);
        // Second trim still CLAIMED, so the merge must not be ready.
        assert.deepEqual((await call("job_steps_claim_ready", [jobId])).claimed, []);
    });

    it("two concurrent claims never both get the same ready step", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        const [a, b] = await Promise.all([
            call("job_steps_claim_ready", [jobId]),
            call("job_steps_claim_ready", [jobId]),
        ]);
        const ids = [...a.claimed, ...b.claimed].map((s: { id: string }) => s.id);
        assert.equal(ids.length, 2);
        assert.equal(new Set(ids).size, 2);
    });

    it("replays are no-ops: plan, submit and store", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        assert.equal((await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)])).idempotent, true);
        assert.equal(Number((await one(`SELECT count(*) AS n FROM job_steps WHERE job_id = $1`, [jobId])).n), 4);

        const s = (await call("job_steps_claim_ready", [jobId])).claimed[0];
        const pid = `req_${randomUUID()}`;
        await call("job_step_submitted", [s.id, pid]);
        assert.equal((await call("job_step_submitted", [s.id, pid])).idempotent, true);
        await call("job_step_stored", ["fal", pid, `k/${randomUUID()}`, "video/mp4", 1, null, null]);
        const replay = await call("job_step_stored", ["fal", pid, `k/${randomUUID()}`, "video/mp4", 1, null, null]);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.job_id, jobId);
    });

    it("an unknown provider job id matches nothing", async () => {
        const r = await call("job_step_stored", ["fal", `req_${randomUUID()}`, "k", "video/mp4", 1, null, null]);
        assert.deepEqual(r, { ok: false, code: "STEP_NOT_FOUND" });
    });

    it("a retryable failure retries once, then fails the parent and refunds exactly once", async () => {
        const { userId, jobId } = await debitedJob();
        const before = await balance(userId);
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);

        let s = (await call("job_steps_claim_ready", [jobId])).claimed[0];
        const pid1 = `req_${randomUUID()}`;
        await call("job_step_submitted", [s.id, pid1]);
        const r1 = await call("job_step_failed", [s.id, "provider_error", true]);
        assert.equal(r1.retry, true);
        // The dead attempt's id is gone, so its late callback matches nothing.
        assert.equal((await call("job_step_stored", ["fal", pid1, "k", "video/mp4", 1, null, null])).code, "STEP_NOT_FOUND");

        s = (await call("job_steps_claim_ready", [jobId])).claimed.find((x: { id: string }) => x.id === s.id);
        assert.ok(s, "the failed step is claimable again");
        await call("job_step_submitted", [s.id, `req_${randomUUID()}`]);
        const r2 = await call("job_step_failed", [s.id, "provider_error", true]);
        assert.equal(r2.retry, false, "second attempt is the last");
        assert.equal(r2.credits, CREDITS);
        assert.equal((await job(jobId)).state, "FAILED");

        const ref = await call("ledger_refund", [jobId, userId, r2.credits, "refund:provider_failed"]);
        assert.equal(ref.ok, true);
        const again = await call("ledger_refund", [jobId, userId, r2.credits, "refund:provider_failed"]);
        assert.equal(again.ok, true);
        assert.equal(await refunds(jobId), 1);
        // `before` was read after the debit, so the refund adds the credits back.
        assert.equal((await balance(userId)).balance, before.balance + CREDITS);

        const after = await call("job_steps_claim_ready", [jobId]);
        assert.equal(after.ok, false, "a failed parent hands out no more work");
    });

    it("a non-retryable failure fails the parent on the first attempt", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        const s = (await call("job_steps_claim_ready", [jobId])).claimed[0];
        const r = await call("job_step_failed", [s.id, "source_invalid", false]);
        assert.equal(r.retry, false);
        assert.equal((await job(jobId)).state, "FAILED");
    });

    it("a parent failed by the sweep stops its pipeline", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        const s = (await call("job_steps_claim_ready", [jobId])).claimed[0];
        const pid = `req_${randomUUID()}`;
        await call("job_step_submitted", [s.id, pid]);
        await pool.query(`UPDATE jobs SET state = 'FAILED', error_code = 'stuck_timeout' WHERE id = $1`, [jobId]);
        const st = await call("job_step_stored", ["fal", pid, `k/${randomUUID()}`, "video/mp4", 1, null, null]);
        assert.equal(st.code, "JOB_NOT_LIVE");
        assert.equal((await call("job_composite_stored", [jobId])).code, "JOB_NOT_LIVE");
    });

    it("progress bumps the parent so the stuck-job sweep never catches a live pipeline", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        await pool.query(`UPDATE jobs SET updated_at = now() - interval '3 hours' WHERE id = $1`, [jobId]);
        await call("job_steps_claim_ready", [jobId]);
        const age = await one(`SELECT now() - updated_at < interval '1 minute' AS fresh FROM jobs WHERE id = $1`, [jobId]);
        assert.equal(age.fresh, true);
    });

    it("rejects bad plans and plans on a job that is not DEBITED", async () => {
        const { jobId } = await debitedJob();
        assert.equal((await call("job_steps_create", [jobId, "[]"])).code, "BAD_PLAN");
        const gap = [{ ...EDIT_PLAN[0], stage: 0 }, { ...EDIT_PLAN[2], stage: 2 }];
        assert.equal((await call("job_steps_create", [jobId, JSON.stringify(gap)])).code, "BAD_PLAN");
        const badStep = [{ ...EDIT_PLAN[0], step: "rm -rf" }];
        assert.equal((await call("job_steps_create", [jobId, JSON.stringify(badStep)])).code, "BAD_PLAN");

        await pool.query(`UPDATE jobs SET state = 'FAILED' WHERE id = $1`, [jobId]);
        assert.equal((await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)])).code, "JOB_BAD_STATE");
    });

    it("job_steps_due frees stranded claims and lists stale submits", async () => {
        const { jobId } = await debitedJob();
        await call("job_steps_create", [jobId, JSON.stringify(EDIT_PLAN)]);
        const c = (await call("job_steps_claim_ready", [jobId])).claimed;
        await pool.query(`UPDATE job_steps SET claimed_at = now() - interval '10 minutes' WHERE id = $1`, [c[0].id]);
        const pid = `req_${randomUUID()}`;
        await call("job_step_submitted", [c[1].id, pid]);
        await pool.query(`UPDATE job_steps SET submitted_at = now() - interval '20 minutes' WHERE id = $1`, [c[1].id]);

        const due = await call("job_steps_due", [12, 5, 100]);
        assert.ok(due.released >= 1);
        assert.ok(due.stale.some((x: { provider_job_id: string }) => x.provider_job_id === pid));
        assert.ok(due.redrive.includes(jobId));
        assert.equal((await one(`SELECT state FROM job_steps WHERE id = $1`, [c[0].id])).state, "PENDING");
    });

    it("browser roles can reach neither the table nor the functions", async () => {
        const denied = await one(`SELECT
            has_table_privilege('anon', 'public.job_steps', 'SELECT') AS anon_t,
            has_table_privilege('authenticated', 'public.job_steps', 'SELECT') AS auth_t,
            has_function_privilege('anon', 'public.job_steps_claim_ready(uuid)', 'EXECUTE') AS anon_f,
            has_function_privilege('authenticated', 'public.job_step_failed(uuid, text, boolean)', 'EXECUTE') AS auth_f,
            (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.job_steps'::regclass) AS forced`);
        assert.deepEqual(denied, { anon_t: false, auth_t: false, anon_f: false, auth_f: false, forced: true });
    });
});
