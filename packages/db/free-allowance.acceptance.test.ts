import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const MODEL = 'free-allowance-test-model';

describe('model free allowance (0205)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const take = async (user: string, key: string, model = MODEL) =>
        (await one('SELECT public.free_allowance_take($1, $2, $3) AS r', [user, model, key])).r;
    const giveBack = async (user: string, key: string) => (await one('SELECT public.free_allowance_return($1, $2) AS r', [user, key])).r;
    const setAllowance = (perDay: number, budget: number) => pool.query(
        'UPDATE public.model_catalog SET free_allowance_per_day = $2, free_allowance_daily_budget = $3, active = true WHERE id = $1', [MODEL, perDay, budget]);
    async function user(opts: { grant?: boolean } = {}) {
        const auth = randomUUID();
        const email = `${auth}@test.veyrnox.ai`;
        const row = opts.grant === false
            ? await one('SELECT public.provision_user($1, $2) AS id', [auth, email])
            : await one('SELECT public.signup_grant($1, $2) AS id', [auth, email]);
        return row.id as string;
    }
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
            END LOOP; END $$`);
        for (const name of ['0037_free_credit_expiry.sql', '0038_free_credit_sweep_fixes.sql',
            '0059_chargeback_freeze.sql', '0071_signup_grant_on_email_confirmation.sql', '0205_model_free_allowance.sql', '0205_model_free_allowance.sql']) {
            await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
        }
        await pool.query(`INSERT INTO public.model_catalog
            (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
            VALUES ($1, 'Free allowance test', 'fal', 'fal-ai/free-allowance-test', 'text-to-image', 1, 0.0100, 'per_generation', NULL, false, false)
            ON CONFLICT (id) DO NOTHING`, [MODEL]);
    });
    // The budget is global per UTC day, so each case starts from an empty claims table for the test model.
    beforeEach(async () => { await pool.query('DELETE FROM public.model_free_allowance_claims WHERE model_id = $1', [MODEL]); });
    after(async () => {
        if (!pool) return;
        try { await setAllowance(0, 0); await pool.query('UPDATE public.model_catalog SET active = false WHERE id = $1', [MODEL]); }
        finally { await pool.end(); }
    });

    it('a model with no allowance offers nothing, and an inactive or unknown one neither', async () => {
        await setAllowance(0, 0);
        const u = await user();
        assert.deepEqual(await take(u, 'k-none'), { ok: true, taken: false, code: 'NO_ALLOWANCE' });
        assert.equal((await take(u, 'k-unknown', 'no-such-model')).code, 'NO_ALLOWANCE');
    });

    it('takes up to the per-account cap, then says the allowance is used', async () => {
        await setAllowance(3, 100);
        const u = await user();
        assert.deepEqual(await take(u, 'cap-1'), { ok: true, taken: true, left: 2 });
        assert.equal((await take(u, 'cap-2')).left, 1);
        assert.equal((await take(u, 'cap-3')).left, 0);
        assert.deepEqual(await take(u, 'cap-4'), { ok: true, taken: false, code: 'ALLOWANCE_USED' });
        assert.equal((await one('SELECT public.free_allowance_left($1) AS r', [u])).r[MODEL], 0);
    });

    it('a replay takes nothing more and gives the same answer', async () => {
        await setAllowance(3, 100);
        const u = await user();
        await take(u, 'rep-1');
        const again = await take(u, 'rep-1');
        assert.deepEqual(again, { ok: true, taken: true, idempotent: true, code: null });
        assert.equal((await one('SELECT count(*)::int AS n FROM public.model_free_allowance_claims WHERE user_id = $1', [u])).n, 1);
    });

    it('returning gives the allowance back once, and a returned key is never retaken', async () => {
        await setAllowance(1, 100);
        const u = await user();
        assert.equal((await take(u, 'ret-1')).taken, true);
        assert.equal((await take(u, 'ret-2')).code, 'ALLOWANCE_USED');
        assert.deepEqual(await giveBack(u, 'ret-1'), { ok: true, returned: true });
        assert.deepEqual(await giveBack(u, 'ret-1'), { ok: true, returned: false });
        assert.equal((await take(u, 'ret-2')).taken, true);
        assert.deepEqual(await take(u, 'ret-1'), { ok: true, taken: false, idempotent: true, code: 'RETURNED' });
    });

    it('concurrent takes never overshoot the global budget', async () => {
        await setAllowance(5, 4);
        const users = await Promise.all(Array.from({ length: 10 }, () => user()));
        const results = await Promise.all(users.map((u, i) => take(u, `race-${i}`)));
        assert.equal(results.filter((r) => r.taken).length, 4);
        assert.equal(results.filter((r) => r.code === 'BUDGET_SPENT').length, 6);
        assert.equal((await one(`SELECT count(*)::int AS n FROM public.model_free_allowance_claims WHERE model_id = $1
            AND day = (now() AT TIME ZONE 'UTC')::date AND state = 'TAKEN'`, [MODEL])).n >= 4, true);
    });

    it('a Frozen account and one without the signup grant are not eligible', async () => {
        await setAllowance(3, 100);
        const frozen = await user();
        await pool.query('UPDATE public.users SET frozen_at = now() WHERE id = $1', [frozen]);
        assert.equal((await take(frozen, 'fz-1')).code, 'NOT_ELIGIBLE');
        assert.equal((await one('SELECT public.free_allowance_left($1) AS r', [frozen])).r[MODEL], 0);
        const unconfirmed = await user({ grant: false });
        assert.equal((await take(unconfirmed, 'uc-1')).code, 'NOT_ELIGIBLE');
    });

    it('a bad idempotency key is refused', async () => {
        await setAllowance(3, 100);
        const u = await user();
        assert.equal((await take(u, 'has space')).code, 'INVALID_KEY');
        assert.equal((await take(u, '')).code, 'INVALID_KEY');
    });

    it('the catalog refuses an allowance that breaks the spend bounds', async () => {
        const bad = (perDay: number, budget: number, cost: number, unit = 'per_generation') => pool.query(
            'UPDATE public.model_catalog SET free_allowance_per_day = $2, free_allowance_daily_budget = $3, provider_cost_per_unit = $4, cost_unit = $5 WHERE id = $1',
            [MODEL, perDay, budget, cost, unit]);
        await assert.rejects(bad(3, 100, 0.06), { code: '23514' }, 'cost per job over $0.05');
        await assert.rejects(bad(3, 200, 0.01), { code: '23514' }, 'daily spend over $1.00');
        await assert.rejects(bad(3, 0, 0.01), { code: '23514' }, 'per-day without a budget');
        await assert.rejects(bad(21, 10, 0.01), { code: '23514' }, 'more than 20 a day');
        await assert.rejects(bad(3, 10, 0.01, 'per_second'), { code: '23514' }, 'not a per-generation price');
        await bad(0, 0, 0.01);
    });

    it('nobody but the service role can reach the table or the functions', async () => {
        const grants = await pool.query(`SELECT grantee FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'model_free_allowance_claims' AND grantee IN ('anon', 'authenticated', 'PUBLIC', 'service_role')`);
        assert.deepEqual(grants.rows, []);
        const rls = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.model_free_allowance_claims'::regclass`);
        assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
        for (const sig of ['free_allowance_take(uuid,text,text)', 'free_allowance_return(uuid,text)', 'free_allowance_left(uuid)', 'reconcile_free_allowance()']) {
            const r = await one(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') AS anon,
                has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') AS auth,
                has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') AS svc`);
            assert.deepEqual(r, { anon: false, auth: false, svc: true }, sig);
        }
    });

    it('reconcile is quiet when healthy and flags a cap lowered below what was taken', async () => {
        await setAllowance(3, 100);
        const u = await user();
        for (const k of ['rc-1', 'rc-2', 'rc-3']) await take(u, k);
        const quiet = await pool.query(`SELECT * FROM public.reconcile_free_allowance() WHERE ref LIKE $1`, [`${u}%`]);
        assert.equal(quiet.rowCount, 0);
        await setAllowance(1, 100);
        const loud = await pool.query(`SELECT kind FROM public.reconcile_free_allowance() WHERE ref LIKE $1`, [`${u}%`]);
        assert.deepEqual(loud.rows, [{ kind: 'user_over_cap' }]);
        await setAllowance(0, 0);
    });
});
