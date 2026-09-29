import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exercises 0156_social_publish_scheduling.sql (ADR-0061 Phase 3), as
// rewritten by 0160 (composer: media by job_id, not a raw source_url —
// see 0160's own header for the URL-durability bug that fixed) and 0161
// (Phase 5's async dispatch engine: provider_state, 'submitted'/'delivered'
// statuses, report_social_post_progress, complete_social_post_target's
// p_delivered). Applies 0154/0156/0160/0161 twice each, the same
// idempotency discipline as the other acceptance tests in this package.
// 0157 (the worker_task_health widening) is deliberately not applied here
// — see its own header comment, verified by the full migration replay
// instead.
describe('social publish scheduling (0156, 0160, 0161)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
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
        for (const name of [
            '0154_social_publish_foundation.sql', '0156_social_publish_scheduling.sql',
            '0160_social_publish_composer.sql', '0161_social_publish_async_engine.sql',
        ]) {
            for (const round of [1, 2]) {
                await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
            }
        }
    });
    after(async () => {
        if (!pool) return;
        try {
            await pool.query(`DELETE FROM public.social_brands b WHERE b.owner_user_id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.social_account_actions a WHERE a.brand_id = b.id)`, [users]);
            // Ledger entries are append-only (CLAUDE.md) — a user with any
            // job/credit fixture history (jobWithAsset's ledger_grant/
            // ledger_debit) is left in place, same as one with a brand still
            // referencing it.
            const deletable = (await pool.query(`SELECT id, auth_id FROM public.users u WHERE u.id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.owner_user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM public.ledger_entries le WHERE le.user_id = u.id)`, [users])).rows;
            await pool.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [deletable.map((r) => r.id)]);
            await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [deletable.map((r) => r.auth_id)]);
        } finally { await pool.end(); }
    });

    async function user() {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id, email) VALUES ($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
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

    // A real job+asset pair the test user owns, for create_social_post's
    // {media_type, job_id} shape (0160) — no raw source_url exists on this
    // path any more (that was the bug 0160 fixed).
    async function jobWithAsset(userId: string, { mimeType = 'image/jpeg', sizeBytes = 1000 } = {}) {
        await pool.query(`SELECT public.ledger_grant($1, $2, $3)`, [userId, 100, 'grant:test_fixture']);
        const debit = await one(
            `SELECT public.ledger_debit($1, $2, 4, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
            [userId, randomUUID()],
        );
        assert.equal(debit.r.ok, true, 'test fixture job creation');
        const r2Key = `assets/${randomUUID()}.jpg`;
        await pool.query(
            `INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes) VALUES ($1, $2, $3, $4)`,
            [debit.r.job_id, r2Key, mimeType, sizeBytes],
        );
        return { jobId: debit.r.job_id as string, r2Key };
    }
    const media = async (userId: string, n = 1) => {
        const jobs = await Promise.all(Array.from({ length: n }, () => jobWithAsset(userId)));
        return jobs.map((j) => ({ media_type: 'image', job_id: j.jobId }));
    };

    const createPost = async (
        u: { id: string, auth: string }, brandId: string, accountIds: string[], overrides: Record<string, unknown> = {},
    ) => {
        const args = {
            // A couple seconds in the past, not "now" — Node's clock and
            // Postgres's own now() are not perfectly synchronized, and
            // claim_due_social_post_targets's own scheduled_at <= now()
            // check can miss a row by a single millisecond of skew
            // otherwise (found via a flaky claimFor() in this exact file).
            scheduledAt: new Date(Date.now() - 2000).toISOString(), globalText: 'hello world', idempotencyKey: `key-${randomUUID()}`,
            media: 'media' in overrides ? overrides.media : await media(u.id, 1),
            ...overrides,
        };
        return (await one(
            'SELECT public.create_social_post($1, $2, $3, $4, $5, $6, $7) AS r',
            [u.auth, brandId, args.scheduledAt, args.globalText, args.idempotencyKey, accountIds, JSON.stringify(args.media)],
        )).r;
    };
    const claim = async (limit = 25) => all('SELECT * FROM public.claim_due_social_post_targets($1)', [limit]);
    // This suite shares one persistent database across every `it()`, with
    // no per-test transaction isolation — a claim() call always sees every
    // due row in the table, not just the one this test created (several
    // tests deliberately leave a target claimed-but-never-completed, e.g.
    // to assert on its 'publishing' state). Filtering by the test's own
    // post_id, rather than trusting array position/order, is what keeps
    // each test's assertions about its own row correct regardless of what
    // else is sitting in the table.
    const claimFor = async (postId: string, limit = 25) => {
        const rows = await claim(limit);
        const row = rows.find((r) => r.post_id === postId);
        assert.ok(row, `expected a due claimable target for post ${postId}`);
        return row;
    };
    const complete = async (targetId: string, ok: boolean, overrides: Record<string, unknown> = {}) => {
        const args = { platformPostId: null, platformPostUrl: null, error: null, delivered: false, ...overrides };
        return (await one(
            'SELECT public.complete_social_post_target($1, $2, $3, $4, $5, $6) AS r',
            [targetId, ok, args.platformPostId, args.platformPostUrl, args.error, args.delivered],
        )).r;
    };
    const reportProgress = async (targetId: string, providerState: Record<string, unknown>, nextCheckAt: string) =>
        (await one(
            'SELECT public.report_social_post_progress($1, $2, $3) AS r',
            [targetId, JSON.stringify(providerState), nextCheckAt],
        )).r;

    it('schedules a post to the caller\'s own active accounts and is idempotent on repeat submission', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const key = `key-${randomUUID()}`;

        const first = await createPost(u, brand.brand_id, [account.account_id], { idempotencyKey: key });
        assert.equal(first.ok, true);
        assert.equal(first.idempotent, false);
        assert.equal(first.target_count, 1);

        const second = await createPost(u, brand.brand_id, [account.account_id], { idempotencyKey: key });
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
            await createPost(owner, ownerBrand.brand_id, [strangerAccount.account_id]),
            { ok: false, code: 'ACCOUNT_NOT_FOUND' },
        );

        await pool.query('SELECT public.disconnect_social_account($1, $2)', [owner.auth, ownerAccount.account_id]);
        assert.deepEqual(
            await createPost(owner, ownerBrand.brand_id, [ownerAccount.account_id]),
            { ok: false, code: 'ACCOUNT_NOT_FOUND' },
        );
    });

    it('rejects malformed media, media pointing at a job the caller does not own, and an empty target list', async () => {
        const u = await user();
        const stranger = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        assert.deepEqual(await createPost(u, brand.brand_id, [], { media: [] }), { ok: false, code: 'NO_TARGET_ACCOUNTS' });
        assert.deepEqual(
            await createPost(u, brand.brand_id, [account.account_id], { media: [{ media_type: 'audio', job_id: randomUUID() }] }),
            { ok: false, code: 'INVALID_MEDIA' },
        );
        assert.deepEqual(
            await createPost(u, brand.brand_id, [account.account_id], { media: [{ media_type: 'image', job_id: 'not-a-uuid' }] }),
            { ok: false, code: 'INVALID_MEDIA' },
        );
        const strangersJob = await jobWithAsset(stranger.id);
        assert.deepEqual(
            await createPost(u, brand.brand_id, [account.account_id], { media: [{ media_type: 'image', job_id: strangersJob.jobId }] }),
            { ok: false, code: 'MEDIA_NOT_FOUND' },
        );
    });

    it('claims a due target exactly once under concurrent claim calls (SKIP LOCKED)', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const post = await createPost(u, brand.brand_id, [account.account_id]);

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
        const post = await createPost(u, brand.brand_id, [account.account_id], { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
        const claimed = await claim(25);
        assert.equal(claimed.some((r) => r.post_id === post.post_id), false);
    });

    it('carries the access token, external account id, and the first media item\'s r2_key/mime_type/size_bytes into the claim row', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id, 'instagram', 'ig-carry');
        const items = await media(u.id, 2);
        const post = await createPost(u, brand.brand_id, [account.account_id], { media: items });
        const row = await claimFor(post.post_id);
        assert.equal(row.external_account_id, 'ig-carry');
        assert.equal(Buffer.from(row.access_token_enc).toString(), Buffer.from('cipher-a').toString());
        assert.equal(row.media_type, 'image');
        // The first item's own r2_key/mime_type/size_bytes, resolved through
        // its job — never a client-supplied URL (0160's own fix).
        const firstAsset = await one('SELECT r2_key, mime_type, size_bytes FROM public.assets WHERE job_id = $1', [items[0].job_id]);
        assert.equal(row.r2_key, firstAsset.r2_key);
        assert.equal(row.mime_type, firstAsset.mime_type);
        assert.equal(String(row.size_bytes), String(firstAsset.size_bytes));
        assert.equal(row.global_text, 'hello world');
        assert.deepEqual(row.provider_state, {});
    });

    it('a success settles the post to published; a target that exhausts 3 attempts settles it to failed', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id);
        const post = await createPost(u, brand.brand_id, [account.account_id]);
        const row = await claimFor(post.post_id);
        const completed = await complete(row.target_id, true, { platformPostId: 'm1', platformPostUrl: 'https://instagram.com/p/x' });
        assert.deepEqual(completed, { ok: true });
        const target = await one('SELECT publish_status, platform_post_id, platform_post_url FROM public.social_post_targets WHERE id = $1', [row.target_id]);
        assert.equal(target.publish_status, 'published');
        assert.equal(target.platform_post_id, 'm1');
        const postRow = await one('SELECT status FROM public.social_posts WHERE id = $1', [post.post_id]);
        assert.equal(postRow.status, 'published');

        // A second post whose only target fails 3 times in a row settles to failed.
        const failPost = await createPost(u, brand.brand_id, [account.account_id]);
        let targetId: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            await pool.query(`UPDATE public.social_post_targets SET next_attempt_at = NULL WHERE post_id = $1`, [failPost.post_id]);
            const claimed = await claimFor(failPost.post_id);
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
        const post = await createPost(u, brand.brand_id, [account.account_id]);
        const claimed = await claimFor(post.post_id);
        // Not reclaimed while fresh.
        assert.equal((await claim(25)).some((r) => r.target_id === claimed.target_id), false);

        await pool.query(`UPDATE public.social_post_targets SET claimed_at = now() - interval '16 minutes' WHERE id = $1`, [claimed.target_id]);
        const reclaimed = await claim(25);
        assert.equal(reclaimed.some((r) => r.target_id === claimed.target_id), true, 'stale publishing target is reclaimed');
    });

    // ── 0161: the async engine (submitted/delivered, provider_state, progress reports) ──

    it('report_social_post_progress moves a claimed target to submitted without bumping attempts, and the next claim leaves it alone until due', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id, 'tiktok');
        const post = await createPost(u, brand.brand_id, [account.account_id]);
        const claimed = await claimFor(post.post_id);
        assert.equal(claimed.attempts, 1);

        const future = new Date(Date.now() + 3600_000).toISOString();
        const progress = await reportProgress(claimed.target_id, { publish_id: 'publish-1' }, future);
        assert.deepEqual(progress, { ok: true });
        const row = await one('SELECT publish_status, attempts, provider_state, next_attempt_at FROM public.social_post_targets WHERE id = $1', [claimed.target_id]);
        assert.equal(row.publish_status, 'submitted');
        assert.equal(row.attempts, 1, 'a routine continuation never bumps the failure-retry counter');
        assert.deepEqual(row.provider_state, { publish_id: 'publish-1' });

        // Not due yet (next_attempt_at is an hour out).
        assert.equal((await claim(25)).some((r) => r.post_id === post.post_id), false);

        // Due now: reclaimed, still without bumping attempts, and provider_state survives the claim.
        await pool.query(`UPDATE public.social_post_targets SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [claimed.target_id]);
        const reclaimed = await claimFor(post.post_id);
        assert.equal(reclaimed.target_id, claimed.target_id);
        assert.equal(reclaimed.attempts, 1);
        assert.deepEqual(reclaimed.provider_state, { publish_id: 'publish-1' });
    });

    it('complete_social_post_target with p_delivered=true settles to delivered, not published, and still counts as a post-level success', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id, 'tiktok');
        const post = await createPost(u, brand.brand_id, [account.account_id]);
        const claimed = await claimFor(post.post_id);
        const completed = await complete(claimed.target_id, true, { platformPostId: 'publish-1', delivered: true });
        assert.deepEqual(completed, { ok: true });
        const target = await one('SELECT publish_status, platform_post_id, platform_post_url FROM public.social_post_targets WHERE id = $1', [claimed.target_id]);
        assert.equal(target.publish_status, 'delivered');
        assert.equal(target.platform_post_id, 'publish-1');
        assert.equal(target.platform_post_url, null);
        const postRow = await one('SELECT status FROM public.social_posts WHERE id = $1', [post.post_id]);
        assert.equal(postRow.status, 'published', 'delivered is a success for the parent post\'s own aggregate status');
    });

    it('a stuck submitted target past the backstop window is reclaimed and can still bump attempts on the next failure', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const account = await connect(u.auth, brand.brand_id, 'youtube');
        const post = await createPost(u, brand.brand_id, [account.account_id]);
        const claimed = await claimFor(post.post_id);
        await reportProgress(claimed.target_id, { phase: 'uploading' }, new Date(Date.now() + 3600_000).toISOString());

        // Simulate a Worker that died mid-continuation: still 'publishing' with a stale claimed_at
        // (this is what the sweep leaves behind between claim and its report-back call).
        await pool.query(
            `UPDATE public.social_post_targets SET publish_status = 'publishing', claimed_at = now() - interval '16 minutes' WHERE id = $1`,
            [claimed.target_id],
        );
        const reclaimed = await claimFor(post.post_id);
        assert.equal(reclaimed.target_id, claimed.target_id);
        assert.equal(reclaimed.attempts, 2, 'a stale reclaim bumps attempts even though it started life as a submitted continuation');
    });

    it('forces RLS and permits service-role RPC execution only, on every new table', async () => {
        for (const table of ['social_posts', 'social_post_media', 'social_post_targets', 'youtube_upload_daily_quota']) {
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
            'public.complete_social_post_target(uuid, boolean, text, text, text, boolean)',
            'public.report_social_post_progress(uuid, jsonb, timestamptz)',
            'public.update_social_account_token(uuid, bytea, timestamptz)',
            'public.consume_youtube_upload_quota()',
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
        // The old 5-arg complete_social_post_target must not survive as a stray overload (0161's own DROP+CREATE discipline).
        const oldOverload = await one(`SELECT count(*) FROM pg_proc WHERE proname = 'complete_social_post_target'
            AND pronargs = 5`);
        assert.equal(oldOverload.count, '0', 'the 5-arg form was dropped, not left behind as an overload');
    });
});
