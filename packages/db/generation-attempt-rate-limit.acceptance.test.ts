import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('generation attempt quota (0112)', { skip: !process.env.DATABASE_URL }, () => {
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
            '0071_signup_grant_on_email_confirmation.sql', '0112_generation_attempt_rate_limit.sql', '0112_generation_attempt_rate_limit.sql']) {
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
        // no free credits are minted just to exercise a request quota.
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id);
        return { id, auth };
    }
    const consume = async (auth: string) => (await one('SELECT public.check_generation_rate_limit($1, 10, 60) AS r', [auth])).r;

    it('allows exactly 20 requests across concurrent connections and isolates users', async () => {
        const a = await user(), b = await user();
        const results = await Promise.all(Array.from({ length: 40 }, () => consume(a.auth)));
        assert.equal(results.filter((r) => r.ok).length, 20);
        assert.equal(results.filter((r) => r.code === 'RATE_LIMITED').length, 20);
        for (const r of results.filter((r) => !r.ok)) {
            assert.ok(r.retry_after_seconds >= 1 && r.retry_after_seconds <= 60);
        }
        assert.deepEqual(await consume(b.auth), { ok: true, count: 0, limit: 10 });
        assert.equal((await one('SELECT request_count FROM public.generation_attempt_rate_limits WHERE user_id = $1', [a.id])).request_count, 21);
        assert.equal((await one('SELECT count(*) FROM public.jobs WHERE user_id = $1', [a.id])).count, '0');
        assert.equal((await one('SELECT count(*) FROM public.ledger_entries WHERE user_id = $1', [a.id])).count, '0');
        assert.equal((await one('SELECT balance FROM public.credit_balances WHERE user_id = $1', [a.id])).balance, 0);
    });
    it('denials do not extend the window and an expired window resets the same row', async () => {
        const u = await user();
        await consume(u.auth);
        await pool.query('UPDATE public.generation_attempt_rate_limits SET request_count = 20 WHERE user_id = $1', [u.id]);
        const before = await one('SELECT window_started_at FROM public.generation_attempt_rate_limits WHERE user_id = $1', [u.id]);
        assert.equal((await consume(u.auth)).code, 'RATE_LIMITED');
        await pool.query(await readFile(new URL('./schema/supabase/0112_generation_attempt_rate_limit.sql', import.meta.url), 'utf8'));
        assert.equal((await consume(u.auth)).code, 'RATE_LIMITED');
        const after = await one('SELECT window_started_at FROM public.generation_attempt_rate_limits WHERE user_id = $1', [u.id]);
        assert.deepEqual(after, before);
        await pool.query("UPDATE public.generation_attempt_rate_limits SET window_started_at = clock_timestamp() - interval '61 seconds' WHERE user_id = $1", [u.id]);
        assert.deepEqual(await consume(u.auth), { ok: true, count: 0, limit: 10 });
        assert.equal((await one('SELECT request_count FROM public.generation_attempt_rate_limits WHERE user_id = $1', [u.id])).request_count, 1);
    });
    it('unknown identities allocate no quota rows', async () => {
        const before = (await one('SELECT count(*) FROM public.generation_attempt_rate_limits')).count;
        assert.deepEqual(await consume(randomUUID()), { ok: false, code: 'USER_NOT_FOUND' });
        assert.equal((await one('SELECT count(*) FROM public.generation_attempt_rate_limits')).count, before);
    });
    it('keeps the existing created-job window and does not move money', async () => {
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            const auth = randomUUID();
            const id = (await c.query('SELECT public.signup_grant($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`])).rows[0].id;
            const debit = (await c.query(`SELECT public.ledger_debit($1, $2, 4, 'debit:generation',
                'seedance-2.0-fast', '{}'::jsonb) AS r`, [id, randomUUID()])).rows[0].r;
            assert.equal(debit.ok, true);
            const before = (await c.query('SELECT balance FROM public.credit_balances WHERE user_id = $1', [id])).rows;
            const result = (await c.query('SELECT public.check_generation_rate_limit($1, 1, 60) AS r', [auth])).rows[0].r;
            assert.equal(result.code, 'RATE_LIMITED');
            assert.equal(result.count, 1);
            assert.equal(result.limit, 1, 'job quota still enforced before attempt quota is exhausted');
            assert.deepEqual((await c.query('SELECT balance FROM public.credit_balances WHERE user_id = $1', [id])).rows, before);
        } finally { await c.query('ROLLBACK'); c.release(); }
    });
    it('invalid limits and windows do not consume attempts', async () => {
        const u = await user();
        for (const [limit, window, code] of [[0, 60, 'BAD_LIMIT'], [null, 60, 'BAD_LIMIT'],
            [10, 0, 'BAD_WINDOW'], [10, null, 'BAD_WINDOW']]) {
            const result = (await one('SELECT public.check_generation_rate_limit($1, $2, $3) AS r', [u.auth, limit, window])).r;
            assert.equal(result.code, code);
        }
        assert.equal((await one('SELECT count(*) FROM public.generation_attempt_rate_limits WHERE user_id = $1', [u.id])).count, '0');
    });
    it('forces RLS and permits service-role RPC execution only', async () => {
        const table = await one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.generation_attempt_rate_limits'::regclass");
        assert.equal(table.relrowsecurity, true);
        assert.equal(table.relforcerowsecurity, true);
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal((await one("SELECT has_function_privilege($1, 'public.check_generation_rate_limit(text,integer,integer)', 'EXECUTE') AS p", [role])).p, role === 'service_role');
            for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                assert.equal((await one("SELECT has_table_privilege($1, 'public.generation_attempt_rate_limits', $2) AS p", [role, permission])).p, false);
            }
        }
        const fn = await one("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.check_generation_rate_limit(text,integer,integer)'::regprocedure");
        assert.equal(fn.prosecdef, true);
        assert.deepEqual(fn.proconfig, ['search_path=""']);
    });
});
