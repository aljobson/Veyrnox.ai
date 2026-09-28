import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exercises 0156_social_publish_scheduling.sql (ADR-0061 Phase 3): posts,
// media, per-network targets, and the create/claim/complete RPC trio. Applies
// both 0154 (its tables) and 0156 twice each, the same idempotency discipline
// as the other acceptance tests in this package.
describe('social publish scheduling (0156)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const authIds: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const all = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;

    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const round of [1, 2]) {
            await pool.query(await readFile(new URL('./schema/supabase/0154_social_publish_foundation.sql', import.meta.url), 'utf8'));
        }
        for (const round of [1, 2]) {
            await pool.query(await readFile(new URL('./schema/supabase/0156_social_publish_scheduling.sql', import.meta.url), 'utf8'));
        }
    });
    after(async () => {
        if (!pool) return;
        try {
            await pool.query(`DELETE FROM public.social_brands b WHERE b.owner_user_id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.social_account_actions a WHERE a.brand_id = b.id)`, [users]);
            const deletableUsers = (await pool.query(`SELECT id FROM public.users u WHERE u.id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.owner_user_id = u.id)`, [users])).rows.map((r) => r.id);
            await pool.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [deletableUsers]);
            await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [authIds]);
        } finally { await pool.end(); }
    });

    async function user() {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id, email) VALUES ($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
        authIds.push(auth);
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id);
        return { id, auth };
    }
    const getOrCreateBrand = async (auth: string) =>
        (await one('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).r;
    const connect = async (auth: string, brandId: string, network = 'instagram', externalId = `ext-${randomUUID()}`) =>
        (await one(
            `SELECT public.record_social_account_connection($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS r`,
            [auth, brandId, network, externalId, '@creator', null, ['scope'],
                Buffer.from('cipher-a'), Buffer.from('cipher-b'), new Date(Date.now() + 3600_000).toISOString()],
        )).r;
    const media = (n = 1) => Array.from({ length: n }, (_, i) => ({ media_type: 'image', source_url: `https://example.com/${i}.jpg` }));
    const createPost = async (auth: string, brandId: string, accountIds: string[], overrides: Record<string, unknown> = {}) => {
        const args = {
            scheduledAt: new Date().toISOString(), globalText: 'hello world', idempotencyKey: `key-${randomUUID()}`,
            media: media(1), ...overrides,
        };
        return (await one(
            'SELECT public.create_social_post($1, $2, $3, $4, $5, $6, $7) AS r',
            [auth, brandId, args.scheduledAt, args.globalText, args.idempotencyKey, accountIds, JSON.stringify(args.media)],
        )).r;
    };
    const claim = async (limit = 25) => all('SELECT * FROM public.claim_due_social_post_targets($1)', [limit]);
    const complete = async (targetId: string, ok: boolean, overrides: Record<string, unknown> = {}) => {
        const args = { platformPostId: null, platformPostUrl: null, error: null, ...overrides };
        return (await one(
            'SELECT public.complete_social_post_target($1, $2, $3, $4, $5) AS r',
            [targetId, ok, args.platformPostId, args.platformPostUrl, args.error],
        )).r;
    };

    it('schedules a post to the caller\'s own active accounts and is idempotent on repeat submission', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const key = `key-${randomUUID()}`;

        const first = await createPost(u.auth, brand.brand_id, [account.account_id], { idempotencyKey: key });
        assert.equal(first.ok, true);
        assert.equal(first.idempotent, false);
        assert.equal(first.target_count, 1);

        const second = await createPost(u.auth, brand.brand_id, [account.account_id], { idempotencyKey: key });
        assert.equal(second.idempotent, true);
        assert.equal(second.post_id, first.post_id);
        assert.equal((await one('SELECT count(*) FROM public.social_posts WHERE id = $1', [first.post_id])).count, '1');

        const targets = await all('SELECT network, publish_status FROM public.social_post_targets WHERE post_id = $1', [first.post_id]);
        assert.deepEqual(targets, [{ network: 'instagram', publish_status: 'pending' }]);
    });

    it('rejects an account the caller does not own or that is not active', async () => {
        const owner = await user();
        const stranger = await user();
        const ownerBrand = await getOrCreateBrand(owner.auth);
        const strangerBrand = await getOrCreateBrand(stranger.auth);
        const ownerAccount = await connect(owner.auth, ownerBrand.brand_id);
        const strangerAccount = await connect(stranger.auth, strangerBrand.brand_id);

        assert.deepEqual(
            await createPost(owner.auth, ownerBrand.brand_id, [strangerAccount.account_id]),
            { ok: false, code: 'ACCOUNT_NOT_FOUND' },
        );

        await pool.query('SELECT public.disconnect_social_account($1, $2)', [owner.auth, ownerAccount.account_id]);
        assert.deepEqual(
            await createPost(owner.auth, ownerBrand.brand_id, [ownerAccount.account_id]),
            { ok: false, code: 'ACCOUNT_NOT_FOUND' },
        );
    });

    it('rejects malformed media and an empty target list', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        assert.deepEqual(await createPost(u.auth, brand.brand_id, [], {}), { ok: false, code: 'NO_TARGET_ACCOUNTS' });
        assert.deepEqual(
            await createPost(u.auth, brand.brand_id, [account.account_id], { media: [{ media_type: 'audio', source_url: 'https://example.com/a.mp3' }] }),
            { ok: false, code: 'INVALID_MEDIA' },
        );
        assert.deepEqual(
            await createPost(u.auth, brand.brand_id, [account.account_id], { media: [{ media_type: 'image', source_url: 'http://example.com/a.jpg' }] }),
            { ok: false, code: 'INVALID_MEDIA' },
        );
    });

    it('claims a due target exactly once under concurrent claim calls (SKIP LOCKED)', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const post = await createPost(u.auth, brand.brand_id, [account.account_id]);

        const [a, b] = await Promise.all([claim(10), claim(10)]);
        const claimedIds = [...a, ...b].filter((r) => r.post_id === post.post_id).map((r) => r.target_id);
        assert.equal(claimedIds.length, 1, 'exactly one of the two concurrent claims won the row');

        const row = await one('SELECT publish_status, attempts, claimed_at FROM public.social_post_targets WHERE id = $1', [claimedIds[0]]);
        assert.equal(row.publish_status, 'publishing');
        assert.equal(row.attempts, 1);
        assert.ok(row.claimed_at);
    });

    it('does not claim a target scheduled in the future', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const post = await createPost(u.auth, brand.brand_id, [account.account_id], { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
        const claimed = await claim(25);
        assert.equal(claimed.some((r) => r.post_id === post.post_id), false);
    });

    it('carries the access token, external account id and first media item into the claim row', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id, 'instagram', 'ig-carry');
        await createPost(u.auth, brand.brand_id, [account.account_id], { media: media(2) });
        const [row] = await claim(25);
        assert.equal(row.external_account_id, 'ig-carry');
        assert.equal(Buffer.from(row.access_token_enc).toString(), Buffer.from('cipher-a').toString());
        assert.equal(row.media_type, 'image');
        assert.equal(row.source_url, 'https://example.com/0.jpg');
        assert.equal(row.global_text, 'hello world');
    });

    it('a success settles the post to published; a target that exhausts 3 attempts settles it to failed', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const post = await createPost(u.auth, brand.brand_id, [account.account_id]);
        const [row] = await claim(25);
        const completed = await complete(row.target_id, true, { platformPostId: 'm1', platformPostUrl: 'https://instagram.com/p/x' });
        assert.deepEqual(completed, { ok: true });
        const target = await one('SELECT publish_status, platform_post_id, platform_post_url FROM public.social_post_targets WHERE id = $1', [row.target_id]);
        assert.equal(target.publish_status, 'published');
        assert.equal(target.platform_post_id, 'm1');
        const postRow = await one('SELECT status FROM public.social_posts WHERE id = $1', [post.post_id]);
        assert.equal(postRow.status, 'published');

        // A second post whose only target fails 3 times in a row settles to failed.
        const failPost = await createPost(u.auth, brand.brand_id, [account.account_id]);
        let targetId: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            await pool.query(`UPDATE public.social_post_targets SET next_attempt_at = NULL WHERE post_id = $1`, [failPost.post_id]);
            const [claimed] = await claim(25);
            targetId = claimed.target_id;
            assert.equal(claimed.attempts, attempt);
            await complete(targetId, false, { error: `boom-${attempt}` });
        }
        const finalTarget = await one('SELECT publish_status, attempts, last_error FROM public.social_post_targets WHERE id = $1', [targetId]);
        assert.equal(finalTarget.publish_status, 'failed');
        assert.equal(finalTarget.attempts, 3);
        assert.equal(finalTarget.last_error, 'boom-3');
        const finalPost = await one('SELECT status FROM public.social_posts WHERE id = $1', [failPost.post_id]);
        assert.equal(finalPost.status, 'failed');
    });

    it('a target left publishing past the backstop window is reclaimed', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const post = await createPost(u.auth, brand.brand_id, [account.account_id]);
        const [claimed] = await claim(25);
        assert.equal(claimed.post_id, post.post_id);
        // Not reclaimed while fresh.
        assert.equal((await claim(25)).some((r) => r.target_id === claimed.target_id), false);

        await pool.query(`UPDATE public.social_post_targets SET claimed_at = now() - interval '16 minutes' WHERE id = $1`, [claimed.target_id]);
        const reclaimed = await claim(25);
        assert.equal(reclaimed.some((r) => r.target_id === claimed.target_id), true, 'stale publishing target is reclaimed');
    });

    it('forces RLS and permits service-role RPC execution only, on every new table', async () => {
        for (const table of ['social_posts', 'social_post_media', 'social_post_targets']) {
            const info = await one(
                'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
                [`public.${table}`],
            );
            assert.equal(info.relrowsecurity, true, `${table} RLS enabled`);
            assert.equal(info.relforcerowsecurity, true, `${table} RLS forced`);
            for (const role of ['anon', 'authenticated', 'service_role']) {
                for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                    assert.equal(
                        (await one('SELECT has_table_privilege($1, $2, $3) AS p', [role, `public.${table}`, permission])).p,
                        false, `${role} has no ${permission} on ${table}`,
                    );
                }
            }
        }
        const fns = [
            'public.create_social_post(text, uuid, timestamptz, text, text, uuid[], jsonb)',
            'public.claim_due_social_post_targets(integer)',
            'public.complete_social_post_target(uuid, boolean, text, text, text)',
        ];
        for (const fn of fns) {
            for (const role of ['anon', 'authenticated', 'service_role']) {
                assert.equal(
                    (await one('SELECT has_function_privilege($1, $2, $3) AS p', [role, fn, 'EXECUTE'])).p,
                    role === 'service_role', `${role} EXECUTE on ${fn}`,
                );
            }
            const def = await one('SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure', [fn]);
            assert.equal(def.prosecdef, true, `${fn} is SECURITY DEFINER`);
            assert.deepEqual(def.proconfig, ['search_path=""'], `${fn} sets search_path`);
        }
    });

    it('widens worker_task_health to accept publish_sweep', async () => {
        await pool.query(`SELECT public.record_worker_task_health('publish_sweep', true)`);
        const row = await one(`SELECT last_ok FROM public.worker_task_health WHERE task = 'publish_sweep'`);
        assert.equal(row.last_ok, true);
        await assert.rejects(pool.query(`SELECT public.record_worker_task_health('not_a_real_task', true)`), /worker_task_health_task_check/);
    });
});
