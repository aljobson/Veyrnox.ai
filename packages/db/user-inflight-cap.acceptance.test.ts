import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const MODEL = 'inflight-cap-test';

describe('per-user in-flight job cap (0434)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    let original: Record<string, unknown>;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];

    async function user(credits = 100) {
        const id = randomUUID();
        await pool.query('INSERT INTO public.users(id,auth_id,email) VALUES($1,$2,$3)', [id, randomUUID(), `${id}@inflight.test`]);
        await pool.query('INSERT INTO public.credit_balances(user_id,balance,free_balance,subscription_balance) VALUES($1,$2,0,0)', [id, credits]);
        return id;
    }
    const setCap = (max: number, enabled = true) => pool.query(
        'UPDATE public.user_inflight_policy SET enabled=$1,max_inflight=$2,updated_at=now() WHERE singleton', [enabled, max]);
    const debit = (u: string, key = `inflight.${randomUUID()}`) => pool.query(
        `SELECT public.ledger_debit($1,$2,1,'debit:generation',$3,'{}'::jsonb) r`, [u, key, MODEL]);

    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        original = await one('SELECT * FROM public.user_inflight_policy WHERE singleton');
        await pool.query(`INSERT INTO public.model_catalog
            (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,gated_flag,active)
            VALUES ($1,'In-flight cap test','fal','fal-ai/inflight-test','text-to-image',1,0.0100,'per_generation',NULL,false,false)
            ON CONFLICT(id) DO UPDATE SET provider_cost_per_unit=0.0100,credits_5s=1`, [MODEL]);
    });
    beforeEach(() => setCap(3));
    after(async () => {
        if (!pool) return;
        try {
            await pool.query('UPDATE public.user_inflight_policy SET enabled=$1,max_inflight=$2,updated_at=$3 WHERE singleton',
                [original.enabled, original.max_inflight, original.updated_at]);
            await pool.query('UPDATE public.model_catalog SET active=false WHERE id=$1', [MODEL]);
        } finally { await pool.end(); }
    });

    it('refuses the job past the cap with the typed spend-limit message', async () => {
        const u = await user();
        for (let i = 0; i < 3; i++) await debit(u);
        await assert.rejects(debit(u), /PROVIDER_SPEND_LIMIT:user_inflight:30/);
        assert.equal((await one(`SELECT count(*)::int n FROM public.jobs WHERE user_id=$1`, [u])).n, 3);
        assert.equal((await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u])).balance, 97, 'a refused job charges nothing');
    });

    it('lets exactly the cap through when requests arrive in parallel', async () => {
        const u = await user();
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => debit(u)));
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
        assert.equal(results.filter((r) => r.status === 'rejected').length, 7);
        assert.equal((await one(`SELECT count(*)::int n FROM public.jobs WHERE user_id=$1`, [u])).n, 3);
    });

    it('does not count another account, and a replay of an admitted key still answers', async () => {
        const a = await user(); const b = await user();
        const key = `inflight.${randomUUID()}`;
        await debit(a, key); await debit(a); await debit(a);
        await debit(b);
        const replay = (await debit(a, key)).rows[0].r;
        assert.equal(replay.ok, true);
        await assert.rejects(debit(a), /user_inflight/);
    });

    it('is off when the switch is off', async () => {
        await setCap(1, false);
        const u = await user();
        for (let i = 0; i < 4; i++) await debit(u);
        assert.equal((await one(`SELECT count(*)::int n FROM public.jobs WHERE user_id=$1`, [u])).n, 4);
    });

    it('prunes only reservations older than the keep window', async () => {
        const u = await user();
        await pool.query(`INSERT INTO public.provider_spend_reservations(user_id,effect_key,provider,purpose,estimated_cost_microusd,admitted_at)
            VALUES ($1,'prune.old.0001','fal','job',1000,now()-interval '10 days'),($1,'prune.new.0001','fal','job',1000,now())`, [u]);
        assert.equal((await one(`SELECT public.prune_provider_spend_reservations(7) r`)).r.ok, true);
        const left = await pool.query(`SELECT effect_key FROM public.provider_spend_reservations WHERE user_id=$1`, [u]);
        assert.deepEqual(left.rows.map((r) => r.effect_key), ['prune.new.0001']);
        assert.equal((await one(`SELECT public.prune_provider_spend_reservations(1) r`)).r.ok, false);
    });

    it('reports utilisation without naming users', async () => {
        const r = (await one('SELECT public.provider_spend_utilization() r')).r;
        assert.equal(r.ok, true);
        assert.ok(typeof r.global_hour_pct === 'number' && Array.isArray(r.providers));
        assert.ok(r.providers.some((p: { provider: string }) => p.provider === 'byteplus'));
    });
});
