import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw Error('Disposable local replay database required');
const db = new pg.Client({ connectionString: url.href }); await db.connect();
const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const signature = 'public.mark_social_provider_submission(uuid,uuid,text)';
const mark = (id, claim, network) => val('SELECT public.mark_social_provider_submission($1,$2,$3)', [id, claim, network]);
const reject = async run => { await db.query('SAVEPOINT denied'); await assert.rejects(run(), e => e.code === '42501'); await db.query('ROLLBACK TO SAVEPOINT denied'); };
try {
    await db.query('BEGIN');
    const migration = await readFile(new URL('../packages/db/schema/supabase/0287_tiktok_submission_fence.sql', import.meta.url), 'utf8');
    await db.query(migration); await db.query(migration);
    const owner = randomUUID(), outsider = randomUUID();
    for (const id of [owner, outsider]) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@example.invalid`]);
    const brand = (await val('SELECT public.get_or_create_default_social_brand($1)', [owner])).brand_id;
    const account = (await val('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [owner, brand, 'tiktok', 'owned-tiktok', 'Fixture', null, ['video.upload'], Buffer.from('cipher'), null, null])).account_id;
    const user = await val('SELECT id FROM public.users WHERE auth_id=$1', [owner]), upload = randomUUID();
    await db.query("INSERT INTO public.social_uploads(id,user_id,filename,mime_type,size_bytes,r2_key,status) VALUES($1,$2,'original.mp4','video/mp4',1000,$3,'ready')", [upload, user, `social-uploads/${owner}/${upload}.mp4`]);
    const media = JSON.stringify([{ media_type: 'video', upload_id: upload }]);
    const create = auth => val('SELECT public.create_social_post($1,$2,now(),$3,$4,$5,$6)', [auth, brand, 'Fixture', randomUUID(), [account], media]);
    assert.equal((await create(outsider)).code, 'BRAND_NOT_FOUND');
    const otherBrand = (await val('SELECT public.get_or_create_default_social_brand($1)', [outsider])).brand_id;
    const otherAccount = (await val('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [outsider, otherBrand, 'tiktok', 'other-tiktok', 'Fixture', null, ['video.upload'], Buffer.from('cipher'), null, null])).account_id;
    assert.equal((await val('SELECT public.create_social_post($1,$2,now(),$3,$4,$5,$6)', [outsider, otherBrand, 'Fixture', randomUUID(), [otherAccount], media])).code, 'MEDIA_NOT_FOUND');
    const made = await create(owner); assert.equal(made.ok, true);
    const row = (await db.query('SELECT * FROM public.claim_due_social_post_targets(50)')).rows.find(r => r.post_id === made.post_id);
    assert.ok(row?.claim_key); assert.equal(row.r2_key, `social-uploads/${owner}/${upload}.mp4`);
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await val("SELECT has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false);
        await db.query(`SET LOCAL ROLE ${role}`); await reject(() => mark(row.target_id, row.claim_key, 'tiktok')); await db.query('RESET ROLE');
    }
    assert.equal(await val("SELECT has_function_privilege('service_role',$1,'EXECUTE')", [signature]), true);
    const def = (await db.query('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure', [signature])).rows[0]; assert.equal(def.prosecdef, true); assert.ok(def.proconfig.includes('search_path=""'));
    await db.query('SET LOCAL ROLE service_role');
    for (const args of [[row.target_id, randomUUID(), 'tiktok'], [row.target_id, null, 'tiktok'], [row.target_id, row.claim_key, 'instagram'], [randomUUID(), row.claim_key, 'tiktok']]) assert.equal(await mark(...args), null);
    assert.equal((await mark(row.target_id, row.claim_key, 'tiktok')).ok, true); assert.equal(await mark(row.target_id, row.claim_key, 'tiktok'), null);
    const progress = await val('SELECT public.report_social_post_progress($1,$2,now(),$3)', [row.target_id, { submission_started: true, publish_id: 'local-inbox', started_at: new Date().toISOString() }, row.claim_key]); assert.equal(progress.ok, true);
    assert.equal(await mark(row.target_id, row.claim_key, 'tiktok'), null);
    const stale = await val('SELECT public.complete_social_post_target($1,true,$2,NULL,NULL,true,$3)', [row.target_id, 'local-inbox', row.claim_key]); assert.equal(stale.code, 'CLAIM_LOST');
    const reclaimed = (await db.query('SELECT * FROM public.claim_due_social_post_targets(50)')).rows.find(r => r.target_id === row.target_id); assert.notEqual(reclaimed.claim_key, row.claim_key); assert.equal(reclaimed.provider_state.publish_id, 'local-inbox');
    assert.equal((await val('SELECT public.complete_social_post_target($1,true,$2,NULL,NULL,true,$3)', [row.target_id, 'local-inbox', reclaimed.claim_key])).ok, true);
    await db.query('RESET ROLE'); assert.equal(await val('SELECT publish_status FROM public.social_post_targets WHERE id=$1', [row.target_id]), 'delivered');
    for (const network of ['facebook','threads','pinterest','bluesky','gmb','instagram','linkedin','twitter']) {
        const claim = randomUUID(); await db.query("UPDATE public.social_post_targets SET network=$2,provider_state='{}',publish_status='publishing',claim_key=$3 WHERE id=$1", [row.target_id, network, claim]);
        await db.query('SET LOCAL ROLE service_role'); assert.equal((await mark(row.target_id, claim, network)).ok, true); await db.query('RESET ROLE');
    }
    console.log('TikTok submission fence: migration replay, service-only ACLs, tenant media ownership, exact claim, wrong network, single submission, lost claims, preserved existing networks and delivered-vs-live passed.');
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
