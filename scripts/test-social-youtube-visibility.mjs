// Only the disposable local replay database; no shared staging or production writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local replay database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const scalar = async (sql, args = []) => (await c.query(sql, args)).rows[0]?.result;
const signature = 'public.create_social_post_with_youtube_visibility(text,uuid,timestamptz,text,text,uuid[],jsonb,text)';
try {
    await c.query('BEGIN');
    const migration = await readFile(new URL('../packages/db/schema/supabase/0239_social_youtube_visibility.sql', import.meta.url), 'utf8');
    await c.query(migration);
    await c.query(migration);
    const auth = randomUUID(), other = randomUUID();
    for (const id of [auth, other]) await c.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@example.invalid`]);
    const user = await scalar('SELECT id AS result FROM public.users WHERE auth_id=$1', [auth]);
    const brand = (await scalar('SELECT public.get_or_create_default_social_brand($1) AS result', [auth])).brand_id;
    const account = (await scalar('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [auth, brand, 'youtube', 'channel-test', 'Test channel', null, ['scope'], Buffer.from('cipher'), null, null])).account_id;
    assert.ok(account);
    await c.query('SELECT public.ledger_grant($1,100,$2)', [user, 'grant:test_fixture']);
    const debit = await scalar("SELECT public.ledger_debit($1,$2,4,'debit:generation','seedance-2.0-fast','{}'::jsonb) AS result", [user, randomUUID()]);
    assert.equal(debit.ok, true);
    await c.query("INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES($1,$2,'video/mp4',1000)", [debit.job_id, `assets/${randomUUID()}.mp4`]);
    const media = JSON.stringify([{ media_type: 'video', job_id: debit.job_id }]);
    const args = [auth, brand, new Date(Date.now() - 30_000), 'Test', randomUUID(), [account], media];
    const create = (visibility, replacements = []) => scalar('SELECT public.create_social_post_with_youtube_visibility($1,$2,$3,$4,$5,$6,$7,$8) AS result', [...(replacements.length ? replacements : args), visibility]);
    const state = (post) => scalar('SELECT provider_state AS result FROM public.social_post_targets WHERE post_id=$1', [post]);
    const made = await create('private');
    assert.equal(made.ok, true);
    assert.equal(made.idempotent, false);
    assert.deepEqual(await state(made.post_id), { youtube_visibility: 'private' });
    const replay = await create('public');
    assert.equal(replay.idempotent, true);
    assert.equal(replay.post_id, made.post_id);
    assert.deepEqual(await state(made.post_id), { youtube_visibility: 'private' }, 'replay cannot widen visibility');
    for (const visibility of ['unlisted', 'public']) {
        const created = await create(visibility, [...args.slice(0,4), randomUUID(), ...args.slice(5)]);
        assert.equal(created.ok, true);
        assert.deepEqual(await state(created.post_id), { youtube_visibility: visibility });
    }
    const before = await scalar('SELECT count(*)::int AS result FROM public.social_posts');
    for (const visibility of [null, '', 'PRIVATE', 'unknown']) assert.equal((await create(visibility)).code, 'INVALID_YOUTUBE_VISIBILITY');
    assert.equal((await create('private', [other, ...args.slice(1,4), randomUUID(), ...args.slice(5)])).code, 'BRAND_NOT_FOUND');
    assert.equal(await scalar('SELECT count(*)::int AS result FROM public.social_posts'), before);
    const old = await scalar('SELECT public.create_social_post($1,$2,$3,$4,$5,$6,$7) AS result', [...args.slice(0,4), randomUUID(), ...args.slice(5)]);
    assert.equal(old.ok, true);
    assert.deepEqual(await state(old.post_id), {}, 'old clients retain legacy public behavior');
    const claimed = (await c.query('SELECT * FROM public.claim_due_social_post_targets(50)')).rows;
    assert.deepEqual(claimed.find((row) => row.post_id === made.post_id).provider_state, { youtube_visibility: 'private' });
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) AS result', [role, signature, 'EXECUTE']), false);
        await c.query('SAVEPOINT denied');
        await c.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(create('private'), (error) => error.code === '42501');
        await c.query('ROLLBACK TO SAVEPOINT denied');
    }
    assert.equal(await scalar("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS result", [signature]), true);
    await c.query('SET LOCAL ROLE service_role');
    assert.equal((await create('private')).idempotent, true);
    await c.query('RESET ROLE');
    console.log('YouTube visibility: migration replay, private/unlisted/public, ownership, idempotency, claim propagation and role denial passed');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
