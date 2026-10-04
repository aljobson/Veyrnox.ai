import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('stored posting insights (0191)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const now = '2026-10-03T12:00:00Z';
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const refresh = async (id: string, at = now) => (await one('SELECT public.refresh_social_posting_insights($1,$2) r', [id, at])).r;
    const read = async (auth: string, id: string) => (await one('SELECT public.get_social_posting_insights($1,$2) r', [auth, id])).r;
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        for (const name of ['0154_social_publish_foundation.sql', '0169_social_publish_free_account_cap.sql',
            '0175_social_actions_actor_restrict.sql', '0188_social_analytics.sql',
            '0191_social_posting_insights.sql', '0191_social_posting_insights.sql']) {
            await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
        }
    });
    after(async () => { await pool?.end(); });
    async function account(timezone = 'UTC') {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        await one('SELECT public.provision_user($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        const brand = (await one('SELECT public.get_or_create_default_social_brand($1) r', [auth])).r.brand_id;
        await pool.query('UPDATE public.social_brands SET timezone=$2 WHERE id=$1', [brand, timezone]);
        const result = (await one('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,NULL,$6,$7,NULL,NULL) r',
            [auth, brand, 'instagram', randomUUID(), '@fixture', ['instagram_business_basic'], Buffer.from('secret')])).r;
        assert.equal(result.ok, true);
        return { auth, brand, id: result.account_id };
    }
    async function post(id: string, at: string, metrics: unknown = { likes: 10, comments: 2 }) {
        await pool.query('INSERT INTO public.social_analytics_posts(account_id,platform_post_id,published_at,metrics) VALUES ($1,$2,$3,$4)',
            [id, randomUUID(), at, JSON.stringify(metrics)]);
    }
    it('stores an empty complete window without inventing scores', async () => {
        const a = await account();
        assert.deepEqual(await read(a.auth, a.id), { ok: true, insights: null });
        assert.deepEqual(await refresh(a.id), { ok: true, cached: false });
        const c = (await read(a.auth, a.id)).insights;
        assert.equal(c.period_start, '2026-07-06'); assert.equal(c.period_end, '2026-09-28');
        assert.equal(c.heatmap.length, 168); assert.equal(c.frequency.length, 12);
        assert.ok(c.heatmap.every((x: any) => x.posts === 0 && x.score === null));
        assert.ok(c.frequency.every((x: any) => x.posts === 0 && x.measured_posts === 0 && x.avg_interactions === null));
        assert.equal(c.recorded_posts, 0); assert.equal(c.measured_posts, 0);
        assert.equal(c.account_id, undefined); assert.ok(!JSON.stringify(c).includes('secret'));
    });
    it('uses local publication slots, numeric metrics, and complete weeks only', async () => {
        const a = await account('Europe/London');
        await post(a.id, '2026-09-08T09:00:00Z', { likes: 10, comments: 2, shares: 3, saves: 1 });
        await post(a.id, '2026-09-15T09:30:00Z', { likes: 20, comments: 4 });
        await post(a.id, '2026-09-22T09:59:00Z', { likes: -2, comments: 2, shares: 'unknown' });
        await post(a.id, '2026-09-22T09:20:00Z', { likes: 100 });
        await post(a.id, '2026-09-27T23:00:00Z'); // local Monday: current incomplete week
        await post(a.id, '2026-07-05T22:59:59Z'); // just before window
        await refresh(a.id);
        const c = (await read(a.auth, a.id)).insights;
        assert.equal(c.recorded_posts, 4); assert.equal(c.measured_posts, 3); assert.equal(c.history_days, 14);
        const slot = c.heatmap.find((x: any) => x.day === 2 && x.hour === 10);
        assert.equal(slot.posts, 3); assert.equal(slot.score, 14);
        const week = c.frequency.find((x: any) => x.week === '2026-09-21');
        assert.deepEqual(week, { week: '2026-09-21', posts: 2, measured_posts: 1, avg_interactions: 2 });
    });
    it('handles daylight saving transitions and excludes young counters', async () => {
        const a = await account('America/New_York');
        await post(a.id, '2026-03-08T07:30:00Z'); // 03:30 after spring-forward
        await post(a.id, '2026-03-08T20:00:00Z'); // in last complete week, younger than 48h
        await refresh(a.id, '2026-03-10T12:00:00Z');
        const c = (await read(a.auth, a.id)).insights;
        assert.equal(c.measured_posts, 1); assert.equal(c.recorded_posts, 2);
        assert.equal(c.heatmap.find((x: any) => x.day === 7 && x.hour === 3).score, 12);
        assert.equal(c.heatmap.find((x: any) => x.day === 7 && x.hour === 16).score, null);
    });
    it('serializes concurrent refreshes and invalidates expired or changed-zone caches', async () => {
        const a = await account();
        const results = await Promise.all(Array.from({ length: 8 }, () => refresh(a.id)));
        assert.equal(results.filter((x) => !x.cached).length, 1);
        assert.deepEqual(await refresh(a.id, '2026-10-09T12:00:00Z'), { ok: true, cached: true });
        assert.deepEqual(await refresh(a.id, '2026-10-10T12:00:00Z'), { ok: true, cached: false });
        await pool.query('UPDATE public.social_brands SET timezone=$2 WHERE id=$1', [a.brand, 'Europe/London']);
        assert.equal((await refresh(a.id, '2026-10-10T13:00:00Z')).cached, false);
        await pool.query('UPDATE public.social_brands SET timezone=$2 WHERE id=$1', [a.brand, 'Invalid/Timezone']);
        await refresh(a.id, '2026-10-10T14:00:00Z');
        assert.equal((await read(a.auth, a.id)).insights.timezone, 'UTC');
    });
    it('rejects unknown accounts, invalid time and non-owners', async () => {
        const a = await account(); const b = await account();
        assert.deepEqual(await refresh(randomUUID()), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
        assert.deepEqual(await refresh(a.id, 'infinity'), { ok: false, code: 'INVALID_TIME' });
        assert.deepEqual(await read(b.auth, a.id), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
        assert.deepEqual(await read('bad-id', a.id), { ok: false, code: 'USER_NOT_FOUND' });
        await one('SELECT public.disconnect_social_account($1,$2)', [a.auth, a.id]);
        assert.deepEqual(await refresh(a.id), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
    });
    it('enforces RLS and service-only RPC access without direct table grants', async () => {
        const table = await one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.social_best_time_cache'::regclass");
        assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal((await one("SELECT has_table_privilege($1,'public.social_best_time_cache','SELECT') allowed", [role])).allowed, false);
            for (const fn of ['public.refresh_social_posting_insights(uuid,timestamptz)', 'public.get_social_posting_insights(text,uuid)']) {
                assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn])).allowed, role === 'service_role');
                const security = await one('SELECT prosecdef, proconfig FROM pg_proc WHERE oid=$1::regprocedure', [fn]);
                assert.equal(security.prosecdef, true); assert.ok(security.proconfig.includes('search_path=""'));
            }
        }
    });
});
