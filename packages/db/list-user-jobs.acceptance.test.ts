/**
 * The account's own job list (schema/supabase/0102).
 *
 * Ownership, newest-first order, keyset pagination that cannot skip or
 * repeat a row, and the label that crosses the boundary.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS = ["0037_free_credit_expiry.sql", "0038_free_credit_sweep_fixes.sql", "0102_list_user_jobs.sql"]
    .map((f) => new URL(`./schema/supabase/${f}`, import.meta.url));

describe("list_user_jobs (0102)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
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

    const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

    async function user() {
        const authId = `sb_${randomUUID()}`;
        const id = (await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, `${randomUUID()}@test.veyrnox.ai`])).id;
        return { authId, id: id as string };
    }

    /** A job with a known prompt, created `minutesAgo` in the past. */
    async function job(userId: string, prompt: string, minutesAgo: number) {
        const d = (await one(
            `SELECT public.ledger_debit($1, $2, 4, 'debit:generation', 'seedance-2.0-fast', $3::jsonb) AS r`,
            [userId, randomUUID(), JSON.stringify({ prompt })])).r;
        assert.equal(d.ok, true);
        await pool.query(`UPDATE public.jobs SET created_at = now() - make_interval(mins => $2) WHERE id = $1`,
            [d.job_id, minutesAgo]);
        return d.job_id as string;
    }

    const list = async (authId: string, limit = 24, cursor: { before: string, id: string } | null = null) =>
        (await one(`SELECT public.list_user_jobs($1, $2, $3::timestamptz, $4::uuid) AS r`,
            [authId, limit, cursor?.before ?? null, cursor?.id ?? null])).r;

    it("returns only the caller's jobs, newest first, with the prompt as a label", async () => {
        const mine = await user();
        const theirs = await user();
        const newest = await job(mine.id, "a neon alley", 1);
        const oldest = await job(mine.id, "a quiet field", 30);
        await job(theirs.id, "not mine", 2);

        const r = await list(mine.authId);
        assert.equal(r.ok, true);
        assert.deepEqual(r.jobs.map((j: any) => j.job_id), [newest, oldest]);
        assert.deepEqual(r.jobs.map((j: any) => j.label), ["a neon alley", "a quiet field"]);
        assert.equal(r.jobs.every((j: any) => j.has_asset === false), true, "no assets stored yet");
    });

    it("pages with a keyset cursor that neither skips nor repeats", async () => {
        const u = await user();
        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) ids.push(await job(u.id, `clip ${i}`, 50 - i));
        const newestFirst = [...ids].reverse();

        const first = await list(u.authId, 2);
        assert.deepEqual(first.jobs.map((j: any) => j.job_id), newestFirst.slice(0, 2));

        const last = first.jobs[first.jobs.length - 1];
        const second = await list(u.authId, 2, { before: last.created_at, id: last.job_id });
        assert.deepEqual(second.jobs.map((j: any) => j.job_id), newestFirst.slice(2, 4));

        // A job created mid-scroll lands at the top, never inside a later page.
        await job(u.id, "brand new", 0);
        const third = await list(u.authId, 2, {
            before: second.jobs[1].created_at, id: second.jobs[1].job_id,
        });
        assert.deepEqual(third.jobs.map((j: any) => j.job_id), newestFirst.slice(4, 5));
    });

    it("caps the page size and answers an unknown caller with an empty list", async () => {
        const u = await user();
        for (let i = 0; i < 3; i += 1) await job(u.id, `c${i}`, i + 1);
        assert.equal((await list(u.authId, 1000)).jobs.length, 3, "a huge limit is clamped, not refused");
        assert.deepEqual(await list(`sb_${randomUUID()}`), { ok: true, jobs: [] });
    });

    it("is service-role only", async () => {
        for (const role of ["anon", "authenticated"]) {
            assert.equal((await one(
                `SELECT has_function_privilege($1, 'public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID)', 'EXECUTE') AS p`,
                [role])).p, false, role);
        }
        assert.equal((await one(
            `SELECT has_function_privilege('service_role', 'public.list_user_jobs(TEXT, INTEGER, TIMESTAMPTZ, UUID)', 'EXECUTE') AS p`)).p, true);
    });
});
