#!/usr/bin/env node
// Disposable local DB only. Everything, including activation and replay, rolls back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL required');
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) throw Error('Local test database required');
const db = new pg.Client({ connectionString }); await db.connect();
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) => Object.values((await query(sql, args)).rows[0])[0];
const call = (fn, ...args) => value(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
const migrations = ['0549_music_beat_ace_step_loop.sql','0550_music_beat_loop_dispatch.sql','0551_music_beat_held_contexts.sql','0552_music_beat_held_admission.sql'];
try {
  await query('BEGIN');
  // 0554 prices the row and switches it on; check that, then start from the state 0549 leaves so its replay guard holds.
  const priced = (await query("SELECT credits_5s, active FROM public.model_catalog WHERE id='ace-step-loop'")).rows[0];
  assert.deepEqual([priced.credits_5s, priced.active], [5, true], '0554 prices ace-step-loop at 5 and switches it on');
  await query("UPDATE public.model_catalog l SET active=false, credits_5s=s.credits_5s FROM public.model_catalog s WHERE l.id='ace-step-loop' AND s.id='ace-step-1.5'");
  for (let replay = 0; replay < 2; replay++) for (const file of migrations) await query(await readFile(new URL(`../packages/db/schema/supabase/${file}`, import.meta.url), 'utf8'));
  // These replays intentionally reinstall the historical pair quote/submit
  // functions after the current schema. Keep that rolled-back fixture coherent
  // by suspending only 0619's live one-track quote normalizer here.
  await query('ALTER TABLE public.music_generation_quotes DISABLE TRIGGER music_quote_aaa_single_generation');
  const source = (await query("SELECT * FROM public.model_catalog WHERE id='ace-step-1.5'")).rows[0];
  const loop = (await query("SELECT * FROM public.model_catalog WHERE id='ace-step-loop'")).rows[0];
  assert.equal(loop.active, false);
  for (const field of Object.keys(source).filter(k => !['id','name','active','updated_at'].includes(k))) assert.deepEqual(loop[field], source[field], field);
  console.log('PASS inactive catalog copy and replay');
  const auth = randomUUID();
  await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@example.invalid`]);
  const user = await value('SELECT id FROM public.users WHERE auth_id=$1', [auth]);
  await query(`INSERT INTO public.credit_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,credits,consent_version,status,current_period_end)
    SELECT $1,id,$2,price_usd_cents,credits,'test','active',now()+interval '1 day' FROM public.credit_subscription_plans WHERE active LIMIT 1`, [user, randomUUID()]);
  assert.equal(await value('SELECT private.music_paid_plan_active($1)', [user]), true);
  assert.equal((await call('ledger_grant', user, 1000, 'beat AI disposable acceptance', randomUUID())).ok, true);
  const quote = model => value('SELECT public.music_create_quote($1::text,$2::text,$3::text,$4::text,$5::integer,$6::integer,$7::text,$8::integer,$9::integer,$10::text,$11::text)',
    [auth, 'Instrumental keys', 'Part', model, null, null, null, 10, 120, 'C Major', '4']);
  assert.equal((await quote('ace-step-loop')).code, 'MODEL_UNAVAILABLE');
  // 0611 unlists ACE-Step 1.5 in production. This disposable rolled-back proof opts both
  // historical quote fixtures back in after confirming the loop starts unavailable.
  await query("UPDATE public.model_catalog SET active=true WHERE id IN ('ace-step-loop','ace-step-1.5')");
  for (const model of ['ace-step-loop','ace-step-1.5']) {
    await query('SAVEPOINT generation');
    const q = await quote(model); assert.equal(q.ok,true,JSON.stringify(q)); assert.equal(q.total_credits,source.credits_5s*2);
    const key=`beat-ai.${randomUUID()}`, accepted=await call('music_submit_pair',auth,q.quote_id,key);
    assert.equal(accepted.ok,true,JSON.stringify(accepted)); assert.equal(accepted.job_ids.length,2);
    const replay=await call('music_submit_pair',auth,q.quote_id,key); assert.equal(replay.idempotent,true);assert.deepEqual(replay.job_ids,accepted.job_ids);
    for(const row of (await query('SELECT payload FROM public.fal_dispatch WHERE job_id=ANY($1::uuid[])',[accepted.job_ids])).rows)
      for(const [key,v] of Object.entries({duration:10,bpm:120,key_scale:'C Major',time_signature:'4'})) assert.equal(row.payload[key],v);
    await query('ROLLBACK TO SAVEPOINT generation');
  }
  console.log('PASS loop and unchanged premium quote → submit → dispatch → replay');
  // A local source gives all four context readers a real owned current version.
  const song=randomUUID(),version=randomUUID(),job=randomUUID(),asset=randomUUID(),sibling=randomUUID(),key=randomUUID(),sha='a'.repeat(64);
  assert.equal((await call('music_reserve_mixdown',auth,song,version,job,asset,key,'AI source',1920044,sha,10,'[]',false,false)).ok,true);
  assert.equal((await call('music_commit_mixdown',auth,key,version,1920044,sha,10)).ok,true);
  await query("UPDATE public.assets SET mime_type='audio/mpeg' WHERE id=$1",[asset]);
  await query("INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes,sha256) VALUES($1,$2,$3,'audio/wav',100,$4)",[sibling,job,`test/${sibling}`,sha]);
  const definitions=[
    ['stem','music_create_stem_quote',[auth,song,version,true],'music_submit_stem_request'],
    ['target_stem','music_create_target_stem_quote',[auth,song,version,'drums',true,10],'music_submit_target_stem_request'],
    ['extend','music_create_extend_quote',[auth,song,version,'Keys',true,10],'music_submit_extend_pair'],
    ['replace','music_create_replace_quote',[auth,song,version,'Keys',1,3,true,10],'music_submit_replace_pair'],
  ];
  await query("UPDATE public.model_catalog SET active=true WHERE id=ANY($1)",[['mureka-stems-v3','sam-audio-target-stem','ace-step-extend','ace-step-replace-section']]);
  for(const [op,quoteFn,args,submitFn] of definitions) for(const heldAsset of [asset,sibling]) {
    await query('SAVEPOINT operation');
    const q=await call(quoteFn,...args); assert.equal(q.ok,true,`${op}: ${JSON.stringify(q)}`);
    const requestKey=`beat-ai.${randomUUID()}`;
    const before=await value("SELECT jsonb_build_object('ledger',(SELECT count(*) FROM public.ledger_entries),'jobs',(SELECT count(*) FROM public.jobs),'dispatch',(SELECT count(*) FROM public.fal_dispatch))");
    await query('UPDATE public.assets SET held_at=now() WHERE id=$1',[heldAsset]);
    assert.equal((await call(`music_get_${op}_source_context`,auth,song,version)).code,'HELD');
    assert.equal((await call(`music_get_${op}_dispatch_context`,auth,song,q.quote_id,requestKey)).code,'HELD');
    assert.equal((await call(submitFn,auth,song,q.quote_id,requestKey,'https://fixture.invalid/source.mp3')).code,'HELD');
    assert.deepEqual(await value("SELECT jsonb_build_object('ledger',(SELECT count(*) FROM public.ledger_entries),'jobs',(SELECT count(*) FROM public.jobs),'dispatch',(SELECT count(*) FROM public.fal_dispatch))"),before);
    await query('ROLLBACK TO SAVEPOINT operation');
    const acceptedQuote=await call(quoteFn,...args), accepted=await call(submitFn,auth,song,acceptedQuote.quote_id,requestKey,'https://fixture.invalid/source.mp3');
    assert.equal(accepted.ok,true,`${op} admission: ${JSON.stringify(accepted)}`);
    await query('UPDATE public.assets SET held_at=now() WHERE id=$1',[heldAsset]);
    assert.equal((await call(`music_get_${op}_dispatch_context`,auth,song,acceptedQuote.quote_id,requestKey)).idempotent,true);
    const replay=await call(submitFn,auth,song,acceptedQuote.quote_id,requestKey,'https://fixture.invalid/source.mp3');
    assert.equal(replay.idempotent,true);assert.equal(replay.request_id,accepted.request_id);
    if(op==='stem'||op==='target_stem') {
      // Pure DB output fixtures; no provider/storage calls. All writes roll back.
      for(const state of ['SUBMITTED','SUCCEEDED','STORED']) await query('UPDATE public.jobs SET state=$2 WHERE id=$1',[accepted.job_id,state]);
      const output=randomUUID(),residual=randomUUID();
      await query('INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes,sha256,held_at) VALUES($1,$2,$3,$4,100,$5,now())',
        [output,accepted.job_id,`test/${output}`,op==='stem'?'application/zip':'audio/wav',sha]);
      if(op==='stem') assert.equal((await call('music_get_stem_archive_context',auth,accepted.request_id)).code,'HELD');
      else {
        await query("INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes,sha256,held_at) VALUES($1,$2,$3,'audio/wav',100,$4,now())",[residual,accepted.job_id,`test/${residual}`,sha]);
        await query('INSERT INTO public.music_target_stem_assets(request_id,user_id,target_asset_id,residual_asset_id) VALUES($1,$2,$3,$4)',[accepted.request_id,user,output,residual]);
        for(const kind of ['target','residual']) assert.equal((await call('music_get_target_stem_asset_context',auth,accepted.request_id,kind)).code,'HELD');
      }
    }
    await query('ROLLBACK TO SAVEPOINT operation');
  }
  for(const file of migrations) {
    const text=await readFile(new URL(`../packages/db/schema/supabase/${file}`,import.meta.url),'utf8');
    for(const match of text.matchAll(/REVOKE ALL ON FUNCTION ([\w.]+\([^)]*\))/g)) {
      for(const role of ['anon','authenticated']) assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE')",[role,match[1]]),false);
      assert.equal(await value("SELECT has_function_privilege('service_role',$1,'EXECUTE')",[match[1]]),!match[1].startsWith('private.'));
    }
  }
  console.log('PASS source holds refuse all four contexts and admissions without ledger/job/dispatch writes; grants remain private');
} finally { await query('ROLLBACK'); await db.end(); }
