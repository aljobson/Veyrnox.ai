// Run only against a disposable local database replayed through 0394.
// All migration changes and fixtures are rolled back, including ledger fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local replay database required');
const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: url });
await c.connect();
const rows = async (sql, args = []) => (await c.query(sql, args)).rows;
const scalar = async (sql, args = []) => (await rows(sql, args))[0]?.r;
try {
    await c.query('BEGIN');
    const migration = (await readFile(new URL('../packages/db/schema/supabase/0395_social_post_carousels.sql', import.meta.url), 'utf8'))
        .replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
    await c.query(migration); await c.query(migration);
    const auth = randomUUID(), other = randomUUID();
    for (const id of [auth, other]) await c.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@example.invalid`]);
    const user = await scalar('SELECT id AS r FROM public.users WHERE auth_id=$1', [auth]);
    const otherUser = await scalar('SELECT id AS r FROM public.users WHERE auth_id=$1', [other]);
    const brand = (await scalar('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).brand_id;
    const account = (await scalar('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS r',
        [auth, brand, 'instagram', '12345', 'Carousel fixture', null, [], Buffer.from('cipher'), null, null])).account_id;
    assert.ok(account);
    async function asset(owner, name) {
        await scalar('SELECT public.ledger_grant($1,20,$2) AS r', [owner, 'grant:test_fixture']);
        const debit = await scalar("SELECT public.ledger_debit($1,$2,4,'debit:generation','flux-2-pro','{}'::jsonb) AS r", [owner, randomUUID()]);
        assert.equal(debit.ok, true);
        await c.query("INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES($1,$2,'image/jpeg',1000)", [debit.job_id, name]);
        return { job_id: debit.job_id, media_type: 'image' };
    }
    const first = await asset(user, 'carousel/first.jpg'), second = await asset(user, 'carousel/second.jpg');
    const foreign = await asset(otherUser, 'carousel/foreign.jpg');
    const create = (media, key = randomUUID()) => scalar('SELECT public.create_social_post($1,$2,now(),$3,$4,$5,$6::jsonb) AS r',
        [auth, brand, 'Carousel fixture', key, [account], JSON.stringify(media)]);
    assert.equal((await create([first, foreign])).code, 'MEDIA_NOT_FOUND');
    const key = randomUUID(), queued = await create([second, first], key);
    assert.equal(queued.ok, true);
    assert.deepEqual((await create([first, second], key)).post_id, queued.post_id, 'same idempotency key never creates a second post');
    assert.deepEqual((await rows('SELECT source_job_id FROM public.social_post_media WHERE post_id=$1 ORDER BY position', [queued.post_id])).map(r => r.source_job_id), [second.job_id, first.job_id]);
    const single = await create([first]), submitted = await create([first, second]), stale = await create([first, second]), restored = await create([first, second]);
    for (const post of [single, submitted, stale, restored]) assert.equal(post.ok, true);
    const version = await scalar('SELECT updated_at AS r FROM public.social_posts WHERE id=$1', [restored.post_id]);
    const canceled = await scalar('SELECT public.cancel_social_post($1,$2,$3) AS r', [auth, restored.post_id, version]);
    assert.equal(canceled.ok, true);
    const restore = await scalar("SELECT public.restore_social_post($1,$2,$3,now()+interval '2 minutes') AS r", [auth, restored.post_id, canceled.updated_at]);
    assert.equal(restore.ok, true);
    // Advance these disposable fixtures to due without waiting two minutes.
    await c.query('UPDATE public.social_posts SET scheduled_at=now() WHERE id=$1', [restored.post_id]);
    await c.query('UPDATE public.social_post_targets SET next_attempt_at=now() WHERE post_id=$1', [restored.post_id]);
    await c.query("UPDATE public.social_post_targets SET publish_status='submitted',next_attempt_at=now(),provider_state=$2 WHERE post_id=$1", [submitted.post_id, { children: [{ id: 'child', ready: true }] }]);
    await c.query("UPDATE public.social_post_targets SET publish_status='publishing',claimed_at=now()-interval '16 minutes' WHERE post_id=$1", [stale.post_id]);
    const legacy = await rows('SELECT * FROM public.claim_due_social_post_targets(50)');
    assert.ok(legacy.some(r => r.post_id === single.post_id));
    for (const post of [queued, submitted, stale, restored]) assert.equal(legacy.some(r => r.post_id === post.post_id), false);
    const v2Single = await create([first]);
    const v2 = await rows('SELECT * FROM public.claim_due_social_post_targets_v2(50)');
    for (const post of [queued, submitted, stale, restored, v2Single]) assert.ok(v2.some(r => r.post_id === post.post_id));
    const ordered = v2.find(r => r.post_id === queued.post_id);
    assert.deepEqual(ordered.media, [
        { position: 0, media_type: 'image', r2_key: 'carousel/second.jpg', mime_type: 'image/jpeg', size_bytes: 1000 },
        { position: 1, media_type: 'image', r2_key: 'carousel/first.jpg', mime_type: 'image/jpeg', size_bytes: 1000 },
    ]);
    assert.equal(ordered.r2_key, ordered.media[0].r2_key);
    assert.deepEqual(v2.find(r => r.post_id === submitted.post_id).provider_state, { children: [{ id: 'child', ready: true }] });
    assert.equal((await rows('SELECT * FROM public.claim_due_social_post_targets_v2(50)')).some(r => r.post_id === queued.post_id), false, 'active claim is not claimed twice');
    const checkpoint = (claim, state) => scalar('SELECT public.checkpoint_social_carousel($1,$2,$3::jsonb) AS r', [ordered.target_id, claim, JSON.stringify(state)]);
    assert.equal((await checkpoint(randomUUID(), {})).code, 'CLAIM_LOST');
    const progress = { children: [{ id: 'saved-child', ready: false }], submission_started: true };
    assert.equal((await checkpoint(ordered.claim_key, progress)).ok, true);
    assert.equal((await checkpoint(ordered.claim_key, { children: progress.children })).ok, true);
    const saved = (await rows('SELECT provider_state,claimed_provider_state,publish_status,claim_key FROM public.social_post_targets WHERE id=$1', [ordered.target_id]))[0];
    assert.deepEqual(saved.provider_state, progress);
    assert.deepEqual(saved.claimed_provider_state, progress);
    assert.equal(saved.publish_status, 'publishing'); assert.equal(saved.claim_key, ordered.claim_key);
    const broken = await create([first, second]);
    await c.query('UPDATE public.social_post_media SET source_job_id=$2 WHERE post_id=$1 AND position=1', [broken.post_id, foreign.job_id]);
    const rejected = (await rows('SELECT * FROM public.claim_due_social_post_targets_v2(50)')).find(r => r.post_id === broken.post_id);
    assert.equal(rejected.media.length, 2); assert.equal(rejected.media[1].r2_key, null, 'foreign item stays present but cannot be signed');
    // Top-level single-file fields must use exactly the same ownership/deletion checks as media[0].
    const validSingle = v2.find(r => r.post_id === v2Single.post_id);
    assert.equal(validSingle.r2_key, 'carousel/first.jpg');
    assert.equal(validSingle.mime_type, validSingle.media[0].mime_type);
    assert.equal(Number(validSingle.size_bytes), validSingle.media[0].size_bytes);
    const deleted = await asset(user, 'carousel/deleted.jpg');
    await c.query('UPDATE public.jobs SET deleted_at=now() WHERE id=$1', [deleted.job_id]);
    const ownUpload = randomUUID(), foreignUpload = randomUUID(), unavailableUpload = randomUUID();
    for (const [id, owner, status] of [[ownUpload, user, 'ready'], [foreignUpload, otherUser, 'ready'], [unavailableUpload, user, 'deleted']]) {
        await c.query("INSERT INTO public.social_uploads(id,user_id,r2_key,filename,mime_type,size_bytes,status) VALUES($1,$2,$3,'fixture.jpg','image/jpeg',1000,$4)",
            [id, owner, `carousel/${id}.jpg`, status]);
    }
    for (const [label, job, upload, valid] of [
        ['foreign job', foreign.job_id, null, false], ['deleted job', deleted.job_id, null, false],
        ['owned upload', null, ownUpload, true], ['foreign upload', null, foreignUpload, false],
        ['unavailable upload', null, unavailableUpload, false],
    ]) {
        const post = await create([first]); assert.equal(post.ok, true);
        await c.query('UPDATE public.social_post_media SET source_job_id=$2,source_upload_id=$3 WHERE post_id=$1', [post.post_id, job, upload]);
        const claimed = (await rows('SELECT * FROM public.claim_due_social_post_targets_v2(50)')).find(r => r.post_id === post.post_id);
        assert.ok(claimed, `${label} fixture must be claimed for validation`);
        assert.equal(claimed.media.length, 1);
        for (const field of ['r2_key', 'mime_type', 'size_bytes']) {
            assert.equal(field === 'size_bytes' && claimed[field] !== null ? Number(claimed[field]) : claimed[field], claimed.media[0][field], `${label}: ${field} matches checked item`);
            if (!valid) assert.equal(claimed[field], null, `${label} must not expose ${field}`);
        }
        if (valid) assert.equal(claimed.r2_key, `carousel/${ownUpload}.jpg`);
    }
    const request = await scalar("INSERT INTO public.social_approval_requests(brand_id,post_id,draft_batch_id,requester_user_id,policy) VALUES($1,$2,$3,$4,'all') RETURNING id AS r", [brand, queued.post_id, randomUUID(), user]);
    const reviewer = await scalar("INSERT INTO public.social_approval_reviewers(request_id,email) VALUES($1,'r@example.invalid') RETURNING id AS r", [request]);
    await c.query('UPDATE public.assets SET held_at=now() WHERE job_id=$1', [first.job_id]);
    const review = await scalar('SELECT public.get_social_approval_review($1) AS r', [reviewer]);
    assert.deepEqual(review.attachments.map(m => m.position), [0, 1]);
    assert.equal(review.attachments[0].r2_key, 'carousel/second.jpg');
    assert.equal(review.attachments[1].held, true); assert.equal(review.attachments[1].r2_key, undefined);
    for (const signature of ['public.claim_due_social_post_targets(integer)', 'public.claim_due_social_post_targets_v2(integer)', 'public.get_social_approval_review(uuid)', 'public.checkpoint_social_carousel(uuid,uuid,jsonb)']) {
        for (const role of ['anon', 'authenticated']) assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS r', [role, signature]), false);
        assert.equal(await scalar("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS r", [signature]), true);
    }
    console.log('Carousel DB acceptance passed: migration replay, ownership (including single-item top-level fields), order, idempotency, legacy queued/restored/submitted/stale exclusion, v2 compatibility, review holds, ACLs.');
} finally { await c.query('ROLLBACK'); await c.end(); }
