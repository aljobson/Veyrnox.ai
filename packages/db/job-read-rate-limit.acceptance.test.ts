import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('shared job read quota (0115)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const name of ['0037_free_credit_expiry.sql', '0038_free_credit_sweep_fixes.sql',
            '0071_signup_grant_on_email_confirmation.sql', '0115_job_read_rate_limit.sql', '0115_job_read_rate_limit.sql']) {
            await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
        }
    });
    after(async () => {
        if (!pool) return;
        try {
            // Provision-only fixtures have zero grants, jobs, or ledger entries.
            // Delete only these users; balances and quota rows cascade. Never
            // alter the append-only ledger, even if a test unexpectedly failed.
            const deleted = await pool.query(`DELETE FROM public.users u WHERE u.id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.user_id = u.id)`, [users]);
            assert.equal(deleted.rowCount, users.length, 'all provision-only fixtures cleaned up');
        } finally { await pool.end(); }
    });
    async function user() {
        const auth = randomUUID();
        // The same provisioning RPC used by the unconfirmed-signup trigger:
        // no free credits are minted just to exercise a read-request quota.
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id);
        return { id, auth };
    }
    const consume = async (auth: string) => (await one('SELECT public.list_user_jobs($1) AS r', [auth])).r;

    it('allows exactly 600 requests across concurrent connections and isolates users', async () => {
        const a = await user(), b = await user();
        const results = await Promise.all(Array.from({ length: 620 }, (_, i) => i % 2 === 0
            ? consume(a.auth)
            : one('SELECT public.get_user_job($1, $2) AS r', [a.auth, randomUUID()]).then((x) => x.r)));
        assert.equal(results.filter((r) => r.code !== 'RATE_LIMITED').length, 600);
        assert.equal(results.filter((r) => r.code === 'RATE_LIMITED').length, 20);
        for (const r of results.filter((r) => r.code === 'RATE_LIMITED')) {
            assert.ok(r.retry_after_seconds >= 1 && r.retry_after_seconds <= 60);
        }
        assert.deepEqual(await consume(b.auth), { ok: true, jobs: [] });
        assert.equal((await one('SELECT request_count FROM public.job_read_rate_limits WHERE user_id = $1', [a.id])).request_count, 601);
    });
    it('denials do not extend the window and an expired window resets the same row', async () => {
        const u = await user();
        await consume(u.auth);
        await pool.query('UPDATE public.job_read_rate_limits SET request_count = 600 WHERE user_id = $1', [u.id]);
        const before = await one('SELECT window_started_at FROM public.job_read_rate_limits WHERE user_id = $1', [u.id]);
        assert.equal((await consume(u.auth)).code, 'RATE_LIMITED');
        await pool.query(await readFile(new URL('./schema/supabase/0115_job_read_rate_limit.sql', import.meta.url), 'utf8'));
        assert.equal((await consume(u.auth)).code, 'RATE_LIMITED');
        const after = await one('SELECT window_started_at FROM public.job_read_rate_limits WHERE user_id = $1', [u.id]);
        assert.deepEqual(after, before);
        await pool.query("UPDATE public.job_read_rate_limits SET window_started_at = clock_timestamp() - interval '61 seconds' WHERE user_id = $1", [u.id]);
        assert.deepEqual(await consume(u.auth), { ok: true, jobs: [] });
        assert.equal((await one('SELECT request_count FROM public.job_read_rate_limits WHERE user_id = $1', [u.id])).request_count, 1);
    });
    it('unknown identities allocate no quota rows', async () => {
        const before = (await one('SELECT count(*) FROM public.job_read_rate_limits')).count;
        assert.deepEqual(await consume(randomUUID()), { ok: true, jobs: [] });
        assert.equal((await one('SELECT count(*) FROM public.job_read_rate_limits')).count, before);
    });
    it('preserves ownership, pagination metadata and the stored asset deadline', async () => {
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            const auth = randomUUID();
            const owner = (await c.query('SELECT public.signup_grant($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`])).rows[0].id;
            const job = (await c.query(`SELECT public.ledger_debit($1, $2, 4, 'debit:generation',
                'seedance-2.0-fast', '{"prompt":"quota test"}'::jsonb) AS r`, [owner, randomUUID()])).rows[0].r;
            assert.equal(job.ok, true);
            const other = await user();
            const read = async (who: string) => (await c.query('SELECT public.get_user_job($1, $2) AS r', [who, job.job_id])).rows[0].r;
            assert.equal((await read(auth)).ok, true);
            assert.deepEqual(await read(other.auth), { ok: false, code: 'NOT_FOUND' });
            assert.deepEqual(await read(randomUUID()), { ok: false, code: 'NOT_FOUND' });
            const deadline = '2026-12-23T12:00:00.000Z';
            await c.query(`INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, expires_at)
                VALUES ($1, $2, 'image/png', 1, $3)`, [job.job_id, randomUUID(), deadline]);
            const list = (await c.query('SELECT public.list_user_jobs($1) AS r', [auth])).rows[0].r;
            assert.equal(list.jobs.length, 1);
            assert.equal(list.jobs[0].job_id, job.job_id);
            assert.equal(list.jobs[0].label, 'quota test');
            assert.ok(list.jobs[0].created_at);
            assert.equal(list.jobs[0].has_asset, true);
            assert.equal(new Date(list.jobs[0].asset_expires_at).toISOString(), deadline);
            const secondJob = (await c.query(`SELECT public.ledger_debit($1, $2, 4, 'debit:generation',
                'seedance-2.0-fast', '{}'::jsonb) AS r`, [owner, randomUUID()])).rows[0].r;
            assert.equal(secondJob.ok, true);
            const firstPage = (await c.query('SELECT public.list_user_jobs($1, 1) AS r', [auth])).rows[0].r;
            const last = firstPage.jobs[0];
            const secondPage = (await c.query('SELECT public.list_user_jobs($1, 1, $2, $3) AS r',
                [auth, last.created_at, last.job_id])).rows[0].r;
            assert.equal(secondPage.jobs.length, 1);
            assert.notEqual(secondPage.jobs[0].job_id, last.job_id);
            assert.deepEqual(new Set([last.job_id, secondPage.jobs[0].job_id]), new Set([job.job_id, secondJob.job_id]));
            assert.deepEqual((await c.query('SELECT public.list_user_jobs($1) AS r', [other.auth])).rows[0].r, { ok: true, jobs: [] });
        } finally { await c.query('ROLLBACK'); c.release(); }
    });
    it('forces RLS and permits service-role RPC execution only', async () => {
        const table = await one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.job_read_rate_limits'::regclass");
        assert.equal(table.relrowsecurity, true);
        assert.equal(table.relforcerowsecurity, true);
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal((await one("SELECT has_function_privilege($1, 'public.consume_job_read_request(uuid)', 'EXECUTE') AS p", [role])).p, role === 'service_role');
            for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                assert.equal((await one("SELECT has_table_privilege($1, 'public.job_read_rate_limits', $2) AS p", [role, permission])).p, false);
            }
        }
        const fn = await one("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.consume_job_read_request(uuid)'::regprocedure");
        assert.equal(fn.prosecdef, true);
        assert.deepEqual(fn.proconfig, ['search_path=""']);
        for (const signature of ['public.get_user_job(text,uuid)', 'public.list_user_jobs(text,integer,timestamptz,uuid)']) {
            for (const role of ['anon', 'authenticated', 'service_role']) {
                assert.equal((await one("SELECT has_function_privilege($1, $2, 'EXECUTE') AS p", [role, signature])).p,
                    role === 'service_role');
            }
        }
    });
});
