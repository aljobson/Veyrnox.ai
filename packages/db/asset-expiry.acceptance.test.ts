import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('owner-scoped asset expiry (0109)', { skip: !process.env.DATABASE_URL }, () => {
    let client: pg.Client;
    before(async () => {
        client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        // Roll back fixtures AND function definitions: other acceptance files
        // share this database. Never leave money-test fixtures behind.
        await client.query('BEGIN');
        await client.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const name of ['0037_free_credit_expiry.sql', '0038_free_credit_sweep_fixes.sql']) {
            await client.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
        }
        const sql = await readFile(new URL('./schema/supabase/0109_asset_expiry_visibility.sql', import.meta.url), 'utf8');
        await client.query(sql);
        await client.query(sql); // idempotent migration
    });
    after(async () => { if (client) { await client.query('ROLLBACK'); await client.end(); } });
    const one = async (sql: string, args: unknown[] = []) => (await client.query(sql, args)).rows[0];

    it('returns the stored deadline only to the owner and keeps job history after asset removal', async () => {
        const auth = `expiry_${randomUUID()}`;
        const user = (await one('SELECT public.signup_grant($1, $2) AS id', [auth, `${randomUUID()}@test.veyrnox.ai`])).id;
        const job = (await one(`SELECT public.ledger_debit($1, $2, 4, 'debit:generation',
            'seedance-2.0-fast', '{}'::jsonb) AS r`, [user, randomUUID()])).r;
        assert.equal(job.ok, true);
        const deadline = '2026-12-23T11:22:33.000Z';
        await client.query(`INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, expires_at)
            VALUES ($1, $2, 'image/png', 42, $3)`, [job.job_id, randomUUID(), deadline]);
        const asset = (await one('SELECT public.get_user_asset($1, $2) AS r', [auth, job.job_id])).r;
        assert.equal(new Date(asset.asset_expires_at).toISOString(), deadline);
        const list = (await one('SELECT public.list_user_jobs($1) AS r', [auth])).r;
        assert.equal(list.jobs[0].has_asset, true);
        assert.equal(new Date(list.jobs[0].asset_expires_at).toISOString(), deadline);
        assert.equal('r2_key' in list.jobs[0], false);
        assert.deepEqual((await one('SELECT public.get_user_asset($1, $2) AS r', ['not-owner', job.job_id])).r,
            { ok: false, code: 'NOT_FOUND' });
        assert.deepEqual((await one('SELECT public.list_user_jobs($1) AS r', ['not-owner'])).r.jobs, []);

        await client.query('UPDATE public.assets SET expires_at = NULL WHERE job_id = $1', [job.job_id]);
        assert.equal((await one('SELECT public.get_user_asset($1, $2) AS r', [auth, job.job_id])).r.asset_expires_at, null);
        await client.query('DELETE FROM public.assets WHERE job_id = $1', [job.job_id]);
        const removed = (await one('SELECT public.list_user_jobs($1) AS r', [auth])).r.jobs[0];
        assert.equal(removed.job_id, job.job_id);
        assert.equal(removed.has_asset, false);
        assert.equal(removed.asset_expires_at, null);
    });

    it('preserves service-role-only execution and empty search paths', async () => {
        for (const fn of ['public.get_user_asset(text,uuid)', 'public.list_user_jobs(text,integer,timestamptz,uuid)']) {
            for (const role of ['anon', 'authenticated', 'service_role']) {
                assert.equal((await one('SELECT has_function_privilege($1, $2, $3) AS p', [role, fn, 'EXECUTE'])).p,
                    role === 'service_role');
            }
            const details = await one('SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure', [fn]);
            assert.equal(details.prosecdef, true);
            assert.deepEqual(details.proconfig, ['search_path=""']);
        }
    });
});
