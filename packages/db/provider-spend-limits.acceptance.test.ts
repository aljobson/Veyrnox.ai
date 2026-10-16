import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const MODEL = 'supplier-spend-test';

describe('supplier spend limits (0327)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    let originalPolicy: Record<string, unknown>;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];

    async function user(credits = 20) {
        const id = randomUUID();
        await pool.query('INSERT INTO public.users(id,auth_id,email) VALUES($1,$2,$3)', [id, randomUUID(), `${id}@spend.test`]);
        await pool.query('INSERT INTO public.credit_balances(user_id,balance,free_balance,subscription_balance) VALUES($1,$2,0,0)', [id, credits]);
        return id;
    }

    async function policy(overrides: Record<string, number | boolean> = {}) {
        const p = {
            admission_open: true, max_job_microusd: 1_000_000,
            user_hour_microusd: 10_000_000, user_day_microusd: 20_000_000,
            global_hour_microusd: 100_000_000, global_day_microusd: 200_000_000,
            ...overrides,
        };
        await pool.query(`UPDATE public.provider_spend_policy SET
            admission_open=$1,max_job_microusd=$2,user_hour_microusd=$3,user_day_microusd=$4,
            global_hour_microusd=$5,global_day_microusd=$6,updated_at=now() WHERE singleton`,
        [p.admission_open, p.max_job_microusd, p.user_hour_microusd, p.user_day_microusd,
            p.global_hour_microusd, p.global_day_microusd]);
    }

    const admit = async (userId: string, key: string) => (await one(
        `SELECT public.provider_spend_admit_model($1,$2,$3,'{}'::jsonb,1) AS r`, [userId, key, MODEL])).r;

    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        originalPolicy = await one('SELECT * FROM public.provider_spend_policy WHERE singleton');
        await pool.query(`INSERT INTO public.model_catalog
            (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
            VALUES($1,'Supplier spend test','fal','fal-ai/spend-test','text-to-image',1,1.0000,'per_generation',NULL,false,false)
            ON CONFLICT(id) DO UPDATE SET provider_cost_per_unit=1.0000,credits_5s=1`, [MODEL]);
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM public.provider_spend_reservations WHERE model_id=$1 OR purpose=$2', [MODEL, 'supplier-test']);
        await policy();
    });

    after(async () => {
        if (!pool) return;
        try {
            await pool.query(`UPDATE public.provider_spend_policy SET admission_open=$1,max_job_microusd=$2,
                user_hour_microusd=$3,user_day_microusd=$4,global_hour_microusd=$5,
                global_day_microusd=$6,updated_at=$7 WHERE singleton`, [
                originalPolicy.admission_open, originalPolicy.max_job_microusd,
                originalPolicy.user_hour_microusd, originalPolicy.user_day_microusd,
                originalPolicy.global_hour_microusd, originalPolicy.global_day_microusd,
                originalPolicy.updated_at,
            ]);
            await pool.query('UPDATE public.model_catalog SET active=false WHERE id=$1', [MODEL]);
        } finally { await pool.end(); }
    });

    it('reserves once for an idempotent effect and keeps the catalog cost authoritative', async () => {
        const u = await user();
        const key = `spend.${randomUUID()}`;
        const first = await admit(u, key);
        const replay = await admit(u, key);
        assert.deepEqual(first, { ok: true, idempotent: false, estimated_cost_microusd: 1_000_000 });
        assert.deepEqual(replay, { ok: true, idempotent: true, estimated_cost_microusd: 1_000_000 });
        assert.equal((await one('SELECT count(*)::int n FROM public.provider_spend_reservations WHERE user_id=$1', [u])).n, 1);
    });

    it('enforces the per-user rolling-hour ceiling', async () => {
        await policy({ user_hour_microusd: 2_000_000, user_day_microusd: 2_000_000 });
        const u = await user();
        assert.equal((await admit(u, `spend.${randomUUID()}`)).ok, true);
        assert.equal((await admit(u, `spend.${randomUUID()}`)).ok, true);
        const refused = await admit(u, `spend.${randomUUID()}`);
        assert.equal(refused.code, 'PROVIDER_SPEND_LIMIT');
        assert.equal(refused.scope, 'user_hour');
        assert.ok(refused.retry_after_seconds >= 1 && refused.retry_after_seconds <= 3600);
    });

    it('serializes concurrent users at the final global budget unit', async () => {
        const baseline = await one(`SELECT
            COALESCE(sum(estimated_cost_microusd) FILTER (WHERE admitted_at>now()-interval '1 hour'),0)::bigint AS hour_total,
            COALESCE(sum(estimated_cost_microusd) FILTER (WHERE admitted_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS day_total
            FROM public.provider_spend_reservations`);
        const hour = Number(baseline.hour_total) + 2_000_000;
        const day = Math.max(Number(baseline.day_total) + 2_000_000, hour);
        await policy({ user_hour_microusd: 2_000_000, user_day_microusd: 2_000_000,
            global_hour_microusd: hour, global_day_microusd: day });
        const users = await Promise.all(Array.from({ length: 8 }, () => user()));
        const results = await Promise.all(users.map((u) => admit(u, `spend.${randomUUID()}`)));
        assert.equal(results.filter((r) => r.ok).length, 2);
        assert.equal(results.filter((r) => r.scope === 'global_hour').length, 6);
    });

    it('rolls back the debit when admission is closed', async () => {
        await policy({ admission_open: false });
        const u = await user(10);
        const key = `spend.${randomUUID()}`;
        await assert.rejects(pool.query(`SELECT public.ledger_debit($1,$2,1,'debit:generation',$3,'{}'::jsonb)`,
            [u, key, MODEL]), /PROVIDER_SPEND_LIMIT:closed:60/);
        assert.equal((await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u])).balance, 10);
        assert.equal((await one('SELECT count(*)::int n FROM public.jobs WHERE user_id=$1 AND idempotency_key=$2', [u, key])).n, 0);
    });

    it('the job trigger covers paid debits and replays without double reservation', async () => {
        const u = await user(10);
        const key = `spend.${randomUUID()}`;
        const first = (await one(`SELECT public.ledger_debit($1,$2,1,'debit:generation',$3,'{}'::jsonb) r`, [u, key, MODEL])).r;
        const replay = (await one(`SELECT public.ledger_debit($1,$2,1,'debit:generation',$3,'{}'::jsonb) r`, [u, key, MODEL])).r;
        assert.equal(first.ok, true);
        assert.equal(first.idempotent, false);
        assert.equal(replay.idempotent, true);
        assert.equal((await one('SELECT count(*)::int n FROM public.provider_spend_reservations WHERE user_id=$1 AND effect_key=$2', [u, key])).n, 1);
    });

    it('private counters and policy are not exposed to browser roles', async () => {
        for (const table of ['provider_spend_policy', 'provider_spend_reservations']) {
            const grants = await pool.query(`SELECT grantee FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name=$1 AND grantee IN ('anon','authenticated','service_role','PUBLIC')`, [table]);
            assert.deepEqual(grants.rows, []);
            const rls = await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]);
            assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
        }
        for (const sig of [
            'provider_spend_admit_model(uuid,text,text,jsonb,integer)',
            'provider_spend_admit_custom_auth(text,text,text,text,bigint)',
        ]) {
            const grants = await one(`SELECT has_function_privilege('anon','public.${sig}','EXECUTE') anon,
                has_function_privilege('authenticated','public.${sig}','EXECUTE') auth,
                has_function_privilege('service_role','public.${sig}','EXECUTE') svc`);
            assert.deepEqual(grants, { anon: false, auth: false, svc: true });
        }
    });
});

