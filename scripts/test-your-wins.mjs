#!/usr/bin/env node
// Run against a local database rebuilt by scripts/replay-migrations.mjs. All fixtures roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated local DATABASE_URL required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const scalar = async (sql, args = []) => (await q(sql, args))[0]?.r;
const wins = u => scalar('SELECT public.read_your_wins($1) AS r', [u.auth]);
async function user() {
    const auth=randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]);
    const id=await scalar('SELECT id AS r FROM public.users WHERE auth_id=$1',[auth]);
    assert.notEqual(id,auth);return {auth,id};
}
async function model(modality, endpoint='wins:unknown', provider='fal') {
    const id=`wins-${randomUUID()}`;
    await q('INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit) VALUES($1,$1,$2,$3,$4,1,0.01)',[id,provider,endpoint,modality]);
    return id;
}
async function job(u, modelId, { inputs={}, state='STORED', created, provider='fal' }={}) {
    return scalar(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs,created_at,provider)
        VALUES($1,$2,$3,1,$4,$5,COALESCE($6::timestamptz,now()),$7) RETURNING id AS r`,[u.id,randomUUID(),modelId,state,inputs,created??null,provider]);
}
async function debit(u,modelId,reason='debit:generation',inputs={}) {
    const r=await scalar('SELECT public.ledger_debit($1,$2,4,$3,$4,$5::jsonb) AS r',[u.id,randomUUID(),reason,modelId,inputs]);
    assert.equal(r.ok,true);return r.job_id;
}
async function denied(role, auth) {
    await q('SAVEPOINT denied');
    // A SET ROLE failure must not masquerade as an EXECUTE denial.
    await q(`SET LOCAL ROLE ${role}`);
    try { await wins({auth});assert.fail('browser EXECUTE allowed'); }
    catch(e) { assert.equal(e.code,'42501'); }
    finally { await q('ROLLBACK TO SAVEPOINT denied'); }
}
try {
    await q('BEGIN');await q("SET LOCAL timezone='Pacific/Honolulu'");
    const migration=await readFile(new URL('../packages/db/schema/supabase/0408_your_wins.sql',import.meta.url),'utf8');
    await q(migration);await q(migration);
    const img=await model('text-to-image'), vid=await model('text-to-video','fal-ai/kling-video/v2.6/pro/text-to-video');
    const other=await model('unknown'), audio=[];
    for(const type of ['audio','text-to-speech','text-to-audio','audio-to-audio']) audio.push(await model(type));
    const u=await user(), foreign=await user();
    const { week_start: monday }=await wins(u);
    const start=Date.parse(monday), before=new Date(start-1).toISOString();
    const deleted=await job(u,img);assert.equal((await scalar('SELECT public.delete_user_job($1,$2) AS r',[u.auth,deleted])).ok,true);
    await job(u,img,{state:'FAILED'});await job(u,img,{state:'SUCCEEDED'});await job(u,img,{inputs:{kind:'chat'}});await job(foreign,img);
    await job(u,img,{created:before});await job(u,img,{created:monday});
    for(const m of audio) await job(u,m);
    await job(u,other);await job(u,'missing-catalog-row');
    let r=await wins(u);
    assert.equal(r.all.creations.total,8);assert.equal(r.week.creations.total,7);
    assert.deepEqual(r.all.creations.by_type,{image:2,video:0,audio:4,other:2});
    assert.equal(Date.parse(r.milestones.find(m=>m.key==='first_image').reached_at),Date.parse(before));
    // Newly generated footage only; editing/rendering that footage adds zero seconds.
    const footage=await job(u,vid,{inputs:{duration_seconds:10}});await job(u,vid);
    assert.equal((await wins(u)).all.video_seconds,15,'generation duration plus proven five-second default');
    const clip=await model('video-to-video','clip-edit:v1','veyrnox');
    await job(u,clip,{provider:'veyrnox',inputs:{duration_seconds:100,edit:{output_s:3.9,clips:[{job_id:footage}]}}});
    const render=await model('text-to-video','concat-render:v1','concat-render');
    await job(u,render,{provider:'concat-render',inputs:{kind:'editor-render',seconds:7.9,source_job_ids:[footage]}});
    assert.equal((await wins(u)).all.video_seconds,15,'edits and renders of counted footage add zero');
    const unknown=await model('text-to-video');await job(u,unknown,{inputs:{duration_seconds:99}});
    const hailuo=await model('text-to-video','market:hailuo/02-text-to-video-standard','kie');
    await job(u,hailuo,{provider:'kie',inputs:{duration_seconds:5}});
    await job(u,vid,{inputs:{duration_seconds:'bad'}});
    r=await wins(u);assert.equal(r.all.video_seconds,15);assert.equal(r.week.video_seconds,15);
    assert.ok(r.milestones.find(m=>m.key==='first_video').reached_at);
    assert.equal(r.all.views,null);assert.equal(r.all.posts,0);
    // Recorded completed routes survive catalog reorder; failed attempts must not classify output.
    const routed=await user();
    const routedModel=await model('text-to-video','fal-ai/kling-video/v2.6/pro/text-to-video');
    const routedJob=await job(routed,routedModel,{inputs:{duration_seconds:10}});
    const recordedRoute=await scalar("INSERT INTO public.model_routes(model_id,supplier,endpoint,cost_per_unit,priority,provenance) VALUES($1,'fal','fal-ai/kling-video/v2.6/pro/text-to-video',0.01,1,'official') RETURNING id AS r",[routedModel]);
    await q("INSERT INTO public.job_attempts(job_id,attempt_no,route_id,outcome,cost_snapshot) VALUES($1,1,$2,'completed',0.01)",[routedJob,recordedRoute]);
    const unknownRoute=await scalar("INSERT INTO public.model_routes(model_id,supplier,endpoint,cost_per_unit,priority,provenance) VALUES($1,'fal','wins:unverified',0.01,2,'official') RETURNING id AS r",[routedModel]);
    await q("INSERT INTO public.job_attempts(job_id,attempt_no,route_id,outcome,cost_snapshot) VALUES($1,2,$2,'failed',0.01)",[routedJob,unknownRoute]);
    assert.equal((await wins(routed)).all.video_seconds,10);
    // Same-provider endpoint changes can happen when catalog dispatch is reordered (0374).
    await q("UPDATE public.model_catalog SET provider_endpoint='wins:unverified' WHERE id=$1",[routedModel]);
    assert.equal((await wins(routed)).all.video_seconds,10,'completed route takes precedence over current catalog');
    const unverifiedJob=await job(routed,routedModel,{inputs:{duration_seconds:90}});
    await q("INSERT INTO public.job_attempts(job_id,attempt_no,route_id,outcome,cost_snapshot) VALUES($1,1,$2,'completed',0.01)",[unverifiedJob,unknownRoute]);
    await q("UPDATE public.model_catalog SET provider_endpoint='fal-ai/kling-video/v2.6/pro/text-to-video' WHERE id=$1",[routedModel]);
    assert.equal((await wins(routed)).all.video_seconds,10,'unverified completed route cannot inherit a newly supported catalog endpoint');
    await job(routed,routedModel,{inputs:{duration_seconds:5}});
    assert.equal((await wins(routed)).all.video_seconds,15,'legacy jobs without attempt records retain the documented catalog fallback');
    // Credit fixtures only use the money RPCs, including compensating refunds.
    const spender=await user(), chatOnly=await user();
    for(const a of [spender,chatOnly]) await scalar("SELECT public.ledger_grant($1,100,'grant:wins-test',$2) AS r",[a.id,randomUUID()]);
    const refunded=await debit(spender,img);await scalar("SELECT public.ledger_refund($1,$2,4,'refund:provider_failed') AS r",[refunded,spender.id]);
    const spent=await debit(spender,img);await q("UPDATE public.jobs SET state='STORED' WHERE id=$1",[spent]);
    assert.equal((await scalar('SELECT public.delete_user_job($1,$2) AS r',[spender.auth,spent])).ok,true);
    for(const a of [spender,chatOnly]) {
        const chat=await debit(a,other,'debit:chat',{kind:'chat'});
        // delete_user_job intentionally refuses chat; simulate input erasure directly.
        // Keep this unfinished chat job non-STORED so it is not a Library creation.
        await q("UPDATE public.jobs SET inputs='{}'::jsonb WHERE id=$1",[chat]);
        assert.deepEqual(await scalar('SELECT inputs AS r FROM public.jobs WHERE id=$1',[chat]),{});
        await debit(a,other,'debit:chat:research',{kind:'chat'});
    }
    await debit(spender,other,'debit:generation',{kind:'chat'});
    assert.equal((await wins(spender)).all.credits_used,4);assert.equal((await wins(spender)).all.creations.total,0);
    assert.equal((await wins(chatOnly)).all.credits_used,0);
    // Exact ordinal timestamps, including 10th and 50th creations.
    const milestones=await user(), dates=[];
    for(let i=0;i<50;i++) { const date=new Date(start-86400000*60+i*1000).toISOString();dates.push(date);await job(milestones,i===0?vid:img,{created:date}); }
    r=await wins(milestones);
    for(const [key,index] of [['first_image',1],['first_video',0],['creations_10',9],['creations_50',49]]) assert.equal(Date.parse(r.milestones.find(m=>m.key===key).reached_at),Date.parse(dates[index]),key);
    // Longest consecutive grant run, a gap, then yesterday/today. Current uses the cache rule.
    const streak=await user();
    for(const ago of [20,19,18,17,16,15,14,1,0]) await scalar("SELECT public.ledger_grant($1,1,'grant:checkin',to_char((now() AT TIME ZONE 'UTC')::date-$2::int,'YYYY-MM-DD')) AS r",[streak.id,ago]);
    await q("INSERT INTO public.checkin_streaks(user_id,streak,last_checkin_date) VALUES($1,2,(now() AT TIME ZONE 'UTC')::date)",[streak.id]);
    r=await wins(streak);assert.equal(r.streak.current,2);assert.equal(r.streak.best,7);assert.deepEqual(r.streak.last7,[false,false,false,false,false,true,true]);
    const reached=await scalar("SELECT ((now() AT TIME ZONE 'UTC')::date-14)::timestamp AT TIME ZONE 'UTC' AS r");
    assert.equal(Date.parse(r.milestones.find(m=>m.key==='streak_7').reached_at),reached.getTime());
    await q("UPDATE public.checkin_streaks SET last_checkin_date=(now() AT TIME ZONE 'UTC')::date-1 WHERE user_id=$1",[streak.id]);assert.equal((await wins(streak)).streak.current,2);
    await q("UPDATE public.checkin_streaks SET last_checkin_date=(now() AT TIME ZONE 'UTC')::date-2 WHERE user_id=$1",[streak.id]);assert.equal((await wins(streak)).streak.current,0);
    // Two published targets count once. Analytics for another author's post in the same brand must not leak.
    const brand=(await scalar('SELECT public.get_or_create_default_social_brand($1) AS r',[u.auth])).brand_id;
    const accounts=[];
    for(const network of ['instagram','facebook']) {
        // Historical published targets remain after disconnecting an account. Disconnect the first
        // through the RPC before connecting the second, respecting the free-tier active-account cap.
        if(accounts.length) {
            const disconnected=await scalar('SELECT public.disconnect_social_account($1,$2) AS r',[u.auth,accounts[0]]);
            assert.equal(disconnected.ok,true);
        }
        const connected=await scalar('SELECT public.record_social_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS r',[u.auth,brand,network,randomUUID(),'Wins fixture',null,[],Buffer.from('cipher'),null,null]);
        assert.equal(connected.ok,true);assert.ok(connected.account_id);accounts.push(connected.account_id);
    }
    async function post(author,stamp,targets) {
        const id=await scalar("INSERT INTO public.social_posts(brand_id,created_by_user_id,status,scheduled_at,idempotency_key) VALUES($1,$2,'published',now(),$3) RETURNING id AS r",[brand,author.id,randomUUID()]);
        for(const [index,platform] of targets.entries()) await q("INSERT INTO public.social_post_targets(post_id,account_id,network,publish_status,platform_post_id,published_at) VALUES($1,$2,$3,'published',$4,$5)",[id,accounts[index],['instagram','facebook'][index],platform,stamp]);
        return id;
    }
    await post(u,monday,['own-ig','own-fb']);await post(u,before,['old-ig']);await post(foreign,monday,['foreign-ig']);
    for(const [index,id,views] of [[0,'own-ig',9],[1,'own-fb',11],[0,'old-ig',3],[0,'foreign-ig',999],[0,'external-ig',888]]) await q('INSERT INTO public.social_analytics_posts(account_id,platform_post_id,published_at,metrics) VALUES($1,$2,now(),$3)',[accounts[index],id,{views}]);
    r=await wins(u);assert.equal(r.all.posts,2);assert.equal(r.week.posts,1);assert.deepEqual(r.week.views,{total:20,networks:['facebook','instagram']});assert.equal(r.all.views.total,23);
    assert.equal(Date.parse(r.milestones.find(m=>m.key==='first_post').reached_at),Date.parse(before));
    await q("UPDATE public.social_analytics_posts SET metrics='{\"views\":0}' WHERE account_id=ANY($1::uuid[])",[accounts]);
    assert.equal((await wins(u)).all.views.total,0,'numeric zero is available data');
    await q("UPDATE public.social_analytics_posts SET metrics='{\"views\":\"not a number\"}' WHERE account_id=ANY($1::uuid[])",[accounts]);assert.equal((await wins(u)).all.views,null);
    // Cinema creator_id references cinema_profiles.user_id, the internal users id.
    await scalar('SELECT public.create_cinema_profile($1,$2,$3) AS r',[u.auth,randomUUID(),{username:`wins_${randomUUID().replaceAll('-','').slice(0,16)}`,display_name:'Wins fixture'}]);
    const content=randomUUID();await q("INSERT INTO public.cinema_content(id,creator_id,content_type,title,language) VALUES($1,$2,'SHORT','Wins fixture','en')",[content,u.id]);
    await q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,created_at) VALUES($1,$2,$3,1,$4,'ready',$5)",[content,u.id,randomUUID(),'a'.repeat(64),before]);
    assert.equal(Date.parse((await wins(u)).milestones.find(m=>m.key==='first_cinema_upload').reached_at),Date.parse(before));
    assert.deepEqual(await wins({auth:randomUUID()}),{ok:false,code:'ACCOUNT_UNAVAILABLE'});
    const tomb=await user();const prep=await scalar('SELECT public.prepare_account_deletion($1) AS r',[tomb.auth]);
    assert.equal((await scalar('SELECT public.erase_account($1,$2) AS r',[tomb.auth,prep.confirmation_token])).ok,true);
    // Use the tombstoned auth_id as well as the now-unresolvable original identity.
    assert.deepEqual(await wins(tomb),{ok:false,code:'ACCOUNT_UNAVAILABLE'});
    const tombAuth=await scalar('SELECT auth_id AS r FROM public.users WHERE id=$1',[tomb.id]);assert.deepEqual(await wins({auth:tombAuth}),{ok:false,code:'ACCOUNT_UNAVAILABLE'});
    for(const role of ['anon','authenticated','service_role']) {
        assert.equal(await scalar("SELECT has_function_privilege($1,'public.read_your_wins(text)','EXECUTE') AS r",[role]),role==='service_role',`${role} EXECUTE ACL`);
    }
    for(const role of ['anon','authenticated']) await denied(role,u.auth);
    const beforeRead=await q('SELECT * FROM public.credit_balances ORDER BY user_id');
    await wins(u);assert.deepEqual(await q('SELECT * FROM public.credit_balances ORDER BY user_id'),beforeRead);
    console.log('Your wins: creation, duration, credit, publication, views, streak, milestone, tombstone and ACL acceptance passed');
} finally { await q('ROLLBACK');await c.end(); }
