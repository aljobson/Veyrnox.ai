import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exercises 0188_social_analytics.sql (ADR-0061 §2.5): the sweep's claim,
// the snapshot and post upserts, and the owner-only read. Applies the
// migration twice to prove idempotency, like the other acceptance tests here.
describe('social analytics (0188)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const authIds: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const name of ['0154_social_publish_foundation.sql', '0169_social_publish_free_account_cap.sql',
            '0175_social_actions_actor_restrict.sql', '0188_social_analytics.sql', '0188_social_analytics.sql']) {
            await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
        }
    });
    after(async () => {
        if (!pool) return;
        try {
            // Brands that logged an action can never be removed (append-only
            // audit log); they are left behind under random ids, the same as
            // the foundation test. Analytics rows go with their account.
            await pool.query(`DELETE FROM public.social_analytics_sync s USING public.social_accounts a, public.social_brands b
                WHERE s.account_id = a.id AND a.brand_id = b.id AND b.owner_user_id = ANY($1::uuid[])`, [users]);
            await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [authIds]).catch(() => {});
        } finally { await pool.end(); }
    });

    async function connectedAccount(network = 'instagram') {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id, email) VALUES ($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
        authIds.push(auth);
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id);
        const brand = (await one('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).r;
        const connected = (await one(
            `SELECT public.record_social_account_connection($1, $2, $3, $4, $5, NULL, $6, $7, NULL, NULL) AS r`,
            [auth, brand.brand_id, network, `ext-${randomUUID()}`, '@creator', ['instagram_business_basic'], Buffer.from('cipher-a')],
        )).r;
        assert.equal(connected.ok, true);
        return { auth, accountId: connected.account_id as string };
    }
    const claim = async (networks: string[], limit = 50) =>
        (await pool.query('SELECT * FROM public.claim_social_analytics_accounts($1, $2)', [limit, networks])).rows;
    const record = async (accountId: string, date: string, metrics: unknown, posts: unknown) =>
        (await one('SELECT public.record_social_analytics($1, $2, $3, $4) AS r',
            [accountId, date, JSON.stringify(metrics), JSON.stringify(posts)])).r;
    const read = async (auth: string, accountId: string, from: string, to: string) =>
        (await one('SELECT public.get_social_analytics($1, $2, $3, $4) AS r', [auth, accountId, from, to])).r;
    const post = (overrides: Record<string, unknown> = {}) => ({
        id: 'm-1', published_at: new Date(Date.now() - 3_600_000).toISOString(), type: 'reel',
        permalink: 'https://www.instagram.com/reel/abc/', caption: 'hello', metrics: { likes: 30, comments: 4 },
        ...overrides,
    });

    it('claims a due account once, then not again until its next turn', async () => {
        const a = await connectedAccount();
        const first = (await claim(['instagram'])).filter((r) => r.account_id === a.accountId);
        assert.equal(first.length, 1);
        assert.equal(first[0].network, 'instagram');
        assert.deepEqual(first[0].access_token_enc, Buffer.from('cipher-a'));
        assert.deepEqual(first[0].scopes_granted, ['instagram_business_basic']);

        assert.equal((await claim(['instagram'])).filter((r) => r.account_id === a.accountId).length, 0);
        await pool.query(`UPDATE public.social_analytics_sync SET next_sync_at = now() - interval '1 minute' WHERE account_id = $1`, [a.accountId]);
        assert.equal((await claim(['instagram'])).filter((r) => r.account_id === a.accountId).length, 1);
    });

    it('never claims a network without a fetcher, a disconnected account, or more than the limit', async () => {
        const other = await connectedAccount('linkedin');
        const gone = await connectedAccount();
        await one('SELECT public.disconnect_social_account($1, $2) AS r', [gone.auth, gone.accountId]);
        const claimed = (await claim(['instagram'])).map((r) => r.account_id);
        assert.ok(!claimed.includes(other.accountId));
        assert.ok(!claimed.includes(gone.accountId));
        assert.deepEqual(await claim(['instagram'], 0), []);
        assert.deepEqual(await claim([], 50), []);
    });

    it('two sweeps at once never claim the same account', async () => {
        const a = await connectedAccount();
        const rounds = await Promise.all(Array.from({ length: 8 }, () => claim(['instagram'])));
        assert.equal(rounds.flat().filter((r) => r.account_id === a.accountId).length, 1);
    });

    it('stores the day\'s numbers and posts; a replay changes nothing and a later fetch updates what it brought', async () => {
        const a = await connectedAccount();
        assert.deepEqual(await record(a.accountId, today, { followers: 100, following: 5 }, [post()]), { ok: true, posts: 1 });
        assert.deepEqual(await record(a.accountId, today, { followers: 100, following: 5 }, [post()]), { ok: true, posts: 1 });
        await record(a.accountId, today, { followers: 100, following: 5 }, [post({ metrics: { likes: 30, comments: 4, reach: 900 } })]);
        // The later fetch read no reach and no following: both stored values stay.
        assert.deepEqual(await record(a.accountId, today, { followers: 104 }, [post({ metrics: { likes: 31, comments: 4 } })]), { ok: true, posts: 1 });

        const out = await read(a.auth, a.accountId, daysAgo(7), today);
        assert.equal(out.ok, true);
        assert.deepEqual(out.account, { id: a.accountId, network: 'instagram', display_name: '@creator', status: 'active' });
        assert.deepEqual(out.evolution, [{ date: today, metrics: { followers: 104, following: 5 } }]);
        assert.equal(out.posts.length, 1);
        assert.deepEqual(out.posts[0].metrics, { likes: 31, comments: 4, reach: 900 });
        assert.equal(out.posts[0].permalink, 'https://www.instagram.com/reel/abc/');
        assert.ok(out.sync.last_ok_at);
        assert.equal(out.sync.failing, false);
    });

    it('keeps only plain numbers and safe values from what a network sent', async () => {
        const a = await connectedAccount();
        const res = await record(a.accountId, today,
            { followers: 7, 'Bad Key': 1, nested: { a: 1 }, text: 'x', flag: true },
            [
                post({ id: 'ok', permalink: 'javascript:alert(1)', type: 'Not A Type', caption: 'c'.repeat(900),
                    metrics: { likes: 2, script: '<b>' } }),
                post({ id: 'bad-date', published_at: 'yesterday' }),
                post({ id: '' }),
                'not an object',
                post({ id: 'ok' }),
            ]);
        assert.deepEqual(res, { ok: true, posts: 1 });
        const out = await read(a.auth, a.accountId, daysAgo(1), today);
        assert.deepEqual(out.evolution[0].metrics, { followers: 7 });
        assert.equal(out.posts.length, 1);
        assert.equal(out.posts[0].permalink, null);
        assert.equal(out.posts[0].type, null);
        assert.equal(out.posts[0].caption.length, 500);
        assert.equal(out.posts[0].metrics.script, undefined);
        // Not an array, or not an object: nothing stored, nothing thrown.
        assert.deepEqual(await record(a.accountId, today, 'nope', { not: 'an array' }), { ok: true, posts: 0 });
    });

    it('refuses a date that is not today (give or take a day) and an account that is not active', async () => {
        const a = await connectedAccount();
        assert.deepEqual(await record(a.accountId, daysAgo(5), { followers: 1 }, []), { ok: false, code: 'INVALID_DATE' });
        assert.deepEqual(await record(randomUUID(), today, { followers: 1 }, []), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
        await one('SELECT public.disconnect_social_account($1, $2) AS r', [a.auth, a.accountId]);
        assert.deepEqual(await record(a.accountId, today, { followers: 1 }, []), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
    });

    it('a failure is kept on the account without its text reaching the owner, and the next success clears it', async () => {
        const a = await connectedAccount();
        await claim(['instagram']);
        await one('SELECT public.record_social_analytics_failure($1, $2) AS r', [a.accountId, `Session expired ${'x'.repeat(400)}`]);
        const stored = await one('SELECT last_error FROM public.social_analytics_sync WHERE account_id = $1', [a.accountId]);
        assert.equal(stored.last_error.length, 200);
        const failing = await read(a.auth, a.accountId, daysAgo(1), today);
        assert.deepEqual(failing.sync, { last_ok_at: null, failing: true });
        assert.ok(!JSON.stringify(failing).includes('Session expired'));

        await record(a.accountId, today, { followers: 1 }, []);
        assert.equal((await read(a.auth, a.accountId, daysAgo(1), today)).sync.failing, false);
    });

    it('only the owner can read an account, and the range is bounded', async () => {
        const a = await connectedAccount();
        const stranger = await connectedAccount();
        await record(a.accountId, today, { followers: 1 }, [post()]);
        assert.deepEqual(await read(stranger.auth, a.accountId, daysAgo(1), today), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
        assert.deepEqual(await read(randomUUID(), a.accountId, daysAgo(1), today), { ok: false, code: 'USER_NOT_FOUND' });
        assert.deepEqual(await read('not-a-uuid', a.accountId, daysAgo(1), today), { ok: false, code: 'USER_NOT_FOUND' });
        assert.deepEqual(await read(a.auth, a.accountId, today, daysAgo(1)), { ok: false, code: 'INVALID_RANGE' });
        assert.deepEqual(await read(a.auth, a.accountId, daysAgo(400), today), { ok: false, code: 'INVALID_RANGE' });
        // A post outside the range is left out.
        const old = await read(a.auth, a.accountId, daysAgo(30), daysAgo(10));
        assert.deepEqual([old.evolution, old.posts], [[], []]);
    });

    it('the tables and functions are closed to browser roles', async () => {
        for (const table of ['social_analytics_sync', 'social_analytics_snapshots', 'social_analytics_posts']) {
            for (const role of ['anon', 'authenticated']) {
                const { allowed } = await one(`SELECT has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT')
                    OR has_table_privilege($1, $2, 'TRUNCATE') AS allowed`, [role, `public.${table}`]);
                assert.equal(allowed, false, `${role} on ${table}`);
            }
        }
        for (const fn of ['claim_social_analytics_accounts(integer, text[])', 'record_social_analytics(uuid, date, jsonb, jsonb)',
            'record_social_analytics_failure(uuid, text)', 'get_social_analytics(text, uuid, date, date)',
            'social_analytics_numbers(jsonb)']) {
            for (const role of ['anon', 'authenticated']) {
                const { allowed } = await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed`, [role, `public.${fn}`]);
                assert.equal(allowed, false, `${role} on ${fn}`);
            }
        }
    });
});
