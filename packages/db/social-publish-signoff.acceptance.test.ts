import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exercises 0182_social_post_drafts.sql (ADR-0061 amendment): drafts are
// inert until their batch is approved, approval never schedules into the
// past and settles posts that lost every target, discard cancels, and only
// the brand owner (through the service role) can do either. Applies 0182
// twice, on top of the social stack (applied here only if it is missing).
//
// The file name must sort after social-publish-scheduling: CI runs these
// files in name order on one database, and that suite re-applies 0156,
// which cannot replace the claim function once 0168 has changed its
// return type.
describe('social post drafts (0182)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const all = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;

    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        // In CI the scheduling suite has already applied the social stack;
        // re-applying 0156 over 0168 fails, so only a bare database gets it.
        const stack = (await one(`SELECT to_regprocedure('public.claim_due_social_post_targets(integer)') IS NULL AS missing`)).missing
            ? ['0154_social_publish_foundation.sql', '0156_social_publish_scheduling.sql',
                '0160_social_publish_composer.sql', '0161_social_publish_async_engine.sql',
                '0168_social_publish_claim_guards.sql', '0181_youtube_quota_pacific_day.sql']
            : [];
        for (const name of [...stack, '0182_social_post_drafts.sql']) {
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
        } finally { await pool.end(); }
    });

    async function user() {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id, email) VALUES ($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id);
        return { id, auth };
    }
    const brandOf = async (auth: string) =>
        (await one('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).r.brand_id as string;
    const connect = async (auth: string, brandId: string, network = 'instagram') =>
        (await one(
            `SELECT public.record_social_account_connection($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS r`,
            [auth, brandId, network, `ext-${randomUUID()}`, '@brand', null, ['scope'],
                Buffer.from('cipher-a'), Buffer.from('cipher-b'), new Date(Date.now() + 3600_000).toISOString()],
        )).r.account_id as string;
    async function media(userId: string) {
        await pool.query(`SELECT public.ledger_grant($1, $2, $3)`, [userId, 100, 'grant:test_fixture']);
        const debit = await one(
            `SELECT public.ledger_debit($1, $2, 4, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`,
            [userId, randomUUID()],
        );
        assert.equal(debit.r.ok, true, 'test fixture job creation');
        await pool.query(`INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes) VALUES ($1, $2, 'image/jpeg', 1000)`,
            [debit.r.job_id, `assets/${randomUUID()}.jpg`]);
        return [{ media_type: 'image', job_id: debit.r.job_id }];
    }

    async function owner() {
        const u = await user();
        const brandId = await brandOf(u.auth);
        const accountId = await connect(u.auth, brandId);
        return { ...u, brandId, accountId };
    }
    type Owner = Awaited<ReturnType<typeof owner>>;

    const draft = async (o: Owner, batchId: string | null, overrides: Record<string, unknown> = {}) => {
        const a = {
            scheduledAt: new Date(Date.now() - 2000).toISOString(), text: 'brand post', key: `auto-${randomUUID()}`,
            accounts: [o.accountId], media: 'media' in overrides ? overrides.media : await media(o.id), ...overrides,
        };
        return (await one('SELECT public.create_social_post_draft($1, $2, $3, $4, $5, $6, $7, $8) AS r',
            [o.auth, o.brandId, batchId, a.scheduledAt, a.text, a.key, a.accounts, JSON.stringify(a.media)])).r;
    };
    const approve = async (o: { auth: string }, brandId: string, batchId: string | null) =>
        (await one('SELECT public.approve_social_post_batch($1, $2, $3) AS r', [o.auth, brandId, batchId])).r;
    const discard = async (o: { auth: string }, brandId: string, batchId: string, postId: string | null = null) =>
        (await one('SELECT public.discard_social_post_drafts($1, $2, $3, $4) AS r', [o.auth, brandId, batchId, postId])).r;
    const post = async (id: string) => one('SELECT * FROM public.social_posts WHERE id = $1', [id]);
    const claimedPostIds = async () =>
        (await all('SELECT post_id FROM public.claim_due_social_post_targets(500)')).map((r) => r.post_id);

    it('a draft is stored as a draft in its batch and is never claimed', async () => {
        const o = await owner();
        const batch = randomUUID();
        const r = await draft(o, batch);
        assert.equal(r.ok, true);
        assert.equal(r.status, 'draft');
        const row = await post(r.post_id);
        assert.equal(row.status, 'draft');
        assert.equal(row.draft_batch_id, batch);
        assert.equal((await claimedPostIds()).includes(r.post_id), false);
    });

    it('drafts pass create_social_post validation and need a batch', async () => {
        const o = await owner();
        assert.equal((await draft(o, null)).code, 'INVALID_BATCH');
        assert.equal((await draft(o, randomUUID(), { media: [] })).code, 'INVALID_MEDIA');
        assert.equal((await draft(o, randomUUID(), { accounts: [randomUUID()] })).code, 'ACCOUNT_NOT_FOUND');
        const other = await owner();
        assert.equal((await draft(o, randomUUID(), { media: await media(other.id) })).code, 'MEDIA_NOT_FOUND');
    });

    it('a replayed key returns the post as it stands, and never re-drafts an approved one', async () => {
        const o = await owner();
        const batch = randomUUID();
        const key = `auto-${randomUUID()}`;
        const m = await media(o.id);
        const first = await draft(o, batch, { key, media: m });
        const again = await draft(o, batch, { key, media: m });
        assert.equal(again.idempotent, true);
        assert.equal(again.post_id, first.post_id);
        assert.equal(again.status, 'draft');
        await approve(o, o.brandId, batch);
        const afterApprove = await draft(o, randomUUID(), { key, media: m });
        assert.equal(afterApprove.status, 'scheduled');
        assert.equal((await post(first.post_id)).status, 'scheduled');
    });

    it('approval schedules the whole batch, never in the past, and the sweep then claims it', async () => {
        const o = await owner();
        const batch = randomUUID();
        const a = await draft(o, batch, { scheduledAt: new Date(Date.now() - 2000).toISOString() });
        const b = await draft(o, batch, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
        const elsewhere = await draft(o, randomUUID());
        const before = (await one('SELECT now() AS t')).t as Date;

        const r = await approve(o, o.brandId, batch);
        assert.deepEqual(r, { ok: true, approved: 2, failed: 0 });
        const pa = await post(a.post_id);
        assert.equal(pa.status, 'scheduled');
        assert.ok(pa.scheduled_at.getTime() >= before.getTime() - 1000, 'a past schedule moves up to approval time');
        assert.equal((await post(b.post_id)).status, 'scheduled');
        assert.equal((await post(elsewhere.post_id)).status, 'draft', 'other batches are untouched');
        assert.ok((await claimedPostIds()).includes(a.post_id));

        assert.deepEqual(await approve(o, o.brandId, batch), { ok: true, approved: 0, failed: 0 }, 'approving twice is a no-op');
        const log = await all(`SELECT action, target_id, detail FROM public.social_account_actions WHERE brand_id = $1 AND action LIKE '%_drafts'`, [o.brandId]);
        assert.deepEqual(log.map((l) => [l.action, l.target_id, l.detail.posts]), [['approve_drafts', batch, 2]]);
    });

    it('a draft whose account was disconnected settles as failed on approval, not stuck scheduled', async () => {
        const o = await owner();
        const batch = randomUUID();
        const d = await draft(o, batch);
        const disc = await one('SELECT public.disconnect_social_account($1, $2) AS r', [o.auth, o.accountId]);
        assert.equal(disc.r.ok, true);
        const r = await approve(o, o.brandId, batch);
        assert.equal(r.approved, 1);
        assert.equal(r.failed, 1);
        assert.equal((await post(d.post_id)).status, 'failed');
    });

    it('only the brand owner can approve or discard', async () => {
        const o = await owner();
        const stranger = await owner();
        const batch = randomUUID();
        const d = await draft(o, batch);
        assert.equal((await approve(stranger, o.brandId, batch)).code, 'BRAND_NOT_FOUND');
        assert.equal((await discard(stranger, o.brandId, batch)).code, 'BRAND_NOT_FOUND');
        assert.equal((await approve({ auth: 'not-a-uuid' }, o.brandId, batch)).code, 'BRAND_NOT_FOUND');
        assert.equal((await approve(o, o.brandId, null)).code, 'INVALID_BATCH');
        assert.equal((await post(d.post_id)).status, 'draft');
    });

    it('discard cancels one draft or the rest of a batch, and leaves scheduled posts alone', async () => {
        const o = await owner();
        const batch = randomUUID();
        const a = await draft(o, batch);
        const b = await draft(o, batch);
        const c = await draft(o, batch);

        assert.deepEqual(await discard(o, o.brandId, batch, a.post_id), { ok: true, discarded: 1 });
        assert.equal((await post(a.post_id)).status, 'canceled');
        const target = await one('SELECT publish_status, last_error FROM public.social_post_targets WHERE post_id = $1', [a.post_id]);
        assert.deepEqual(target, { publish_status: 'failed', last_error: 'draft_discarded' });
        assert.equal((await post(b.post_id)).status, 'draft');

        await approve(o, o.brandId, batch);
        assert.deepEqual(await discard(o, o.brandId, batch), { ok: true, discarded: 0 }, 'approved posts are not drafts');
        assert.equal((await post(c.post_id)).status, 'scheduled');
        assert.equal((await claimedPostIds()).includes(a.post_id), false);
    });

    it('a draft cannot exist without a batch', async () => {
        const o = await owner();
        const d = await draft(o, randomUUID());
        await assert.rejects(
            pool.query(`UPDATE public.social_posts SET draft_batch_id = NULL WHERE id = $1`, [d.post_id]),
            /social_posts_draft_has_batch/,
        );
    });

    it('the new functions are callable by the service role only', async () => {
        for (const fn of [
            'public.create_social_post_draft(text, uuid, uuid, timestamptz, text, text, uuid[], jsonb)',
            'public.social_brand_owner(text, uuid)',
            'public.approve_social_post_batch(text, uuid, uuid)',
            'public.discard_social_post_drafts(text, uuid, uuid, uuid)',
        ]) {
            for (const role of ['anon', 'authenticated', 'public']) {
                const r = await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, fn]);
                assert.equal(r.ok, false, `${role} must not execute ${fn}`);
            }
            assert.equal((await one(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok`, [fn])).ok, true);
        }
    });
});
