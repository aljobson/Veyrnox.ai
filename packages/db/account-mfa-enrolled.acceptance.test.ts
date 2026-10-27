import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// middleware.js refuses aal1 tokens for accounts this answers true for (0404, audit H2).
describe('account_mfa_enrolled (0404)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const value = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0].value;
    const enrolled = (authId: string | null) => value('SELECT public.account_mfa_enrolled($1) value', [authId]);
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
        // Supabase owns auth.mfa_factors; local databases get the columns the function reads.
        await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
        await pool.query('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
        const migration = await readFile(new URL('./schema/supabase/0404_mfa_enrolment_lookup.sql', import.meta.url), 'utf8');
        await pool.query(migration); await pool.query(migration);
    });
    after(async () => { if (pool) await pool.end(); });

    it('is true only for a verified TOTP factor', async () => {
        const authId = randomUUID();
        assert.equal(await enrolled(authId), false);
        await pool.query("INSERT INTO auth.mfa_factors VALUES($1,'totp','unverified')", [authId]);
        assert.equal(await enrolled(authId), false);
        await pool.query("UPDATE auth.mfa_factors SET status='verified' WHERE user_id=$1", [authId]);
        assert.equal(await enrolled(authId), true);
        assert.equal(await enrolled(randomUUID()), false);
    });

    it('answers false for a missing or malformed identity instead of failing', async () => {
        for (const authId of [null, '', 'not-a-uuid', "x' OR 1=1 --"]) assert.equal(await enrolled(authId), false, String(authId));
    });

    it('is callable by the service role only, with a locked search path', async () => {
        for (const role of ['anon', 'authenticated']) {
            assert.equal(await value("SELECT has_function_privilege($1,'public.account_mfa_enrolled(text)','EXECUTE') value", [role]), false, role);
        }
        assert.equal(await value("SELECT has_function_privilege('service_role','public.account_mfa_enrolled(text)','EXECUTE') value"), true);
        assert.ok(String(await value("SELECT proconfig value FROM pg_proc WHERE oid='public.account_mfa_enrolled(text)'::regprocedure")).includes('search_path='));
    });
});
