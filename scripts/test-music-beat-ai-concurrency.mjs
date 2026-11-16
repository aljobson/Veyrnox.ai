#!/usr/bin/env node
// Two real connections: a hold after source inspection must win admission.
// Local disposable DB only. No fixture grant/debit; committed fixture rows removed in finally.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw Error('DATABASE_URL required');
const target=new URL(connectionString);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname))throw Error('Local test database required');
const a=new pg.Client({connectionString}),b=new pg.Client({connectionString});await a.connect();await b.connect();
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0])[0];
const call=(c,name,...args)=>value(c,`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args);
const auth=randomUUID(),song=randomUUID(),version=randomUUID(),job=randomUUID(),asset=randomUUID(),sibling=randomUUID(),key=randomUUID();
let user,pending;
try {
  await a.query('BEGIN');
  await a.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,`${auth}@example.invalid`]);
  user=await value(a,'SELECT id FROM public.users WHERE auth_id=$1',[auth]);
  assert.equal(Number(await value(a,'SELECT count(*) FROM public.ledger_entries WHERE user_id=$1',[user])),0,'unconfirmed fixture must not receive a signup grant');
  await a.query(`INSERT INTO public.credit_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,credits,consent_version,status,current_period_end)
    SELECT $1,id,$2,price_usd_cents,credits,'test','active',now()+interval '1 day' FROM public.credit_subscription_plans WHERE active LIMIT 1`,[user,randomUUID()]);
  const sha='a'.repeat(64);
  assert.equal((await call(a,'music_reserve_mixdown',auth,song,version,job,asset,key,'Held source',1920044,sha,10,'[]',false,false)).ok,true);
  assert.equal((await call(a,'music_commit_mixdown',auth,key,version,1920044,sha,10)).ok,true);
  await a.query("UPDATE public.assets SET mime_type='audio/mpeg' WHERE id=$1",[asset]);
  await a.query("INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes,sha256) VALUES($1,$2,$3,'audio/wav',100,$4)",[sibling,job,`test/${sibling}`,sha]);
  const definitions=[
    ['stem','music_create_stem_quote',[auth,song,version,true],'music_submit_stem_request'],
    ['target_stem','music_create_target_stem_quote',[auth,song,version,'drums',true,10],'music_submit_target_stem_request'],
    ['extend','music_create_extend_quote',[auth,song,version,'Keys',true,10],'music_submit_extend_pair'],
    ['replace','music_create_replace_quote',[auth,song,version,'Keys',1,3,true,10],'music_submit_replace_pair'],
  ];
  const models=(await a.query('SELECT id,active FROM public.model_catalog WHERE id=ANY($1)',[['mureka-stems-v3','sam-audio-target-stem','ace-step-extend','ace-step-replace-section']])).rows;
  await a.query('UPDATE public.model_catalog SET active=true WHERE id=ANY($1)',[models.map(r=>r.id)]);
  const quotes=[];
  for(const [op,name,args,submit] of definitions){const q=await call(a,name,...args);assert.equal(q.ok,true,`${op}: ${JSON.stringify(q)}`);quotes.push({op,submit,id:q.quote_id});}
  for(const row of models)await a.query('UPDATE public.model_catalog SET active=$2 WHERE id=$1',[row.id,row.active]);
  await a.query('COMMIT');
  await a.query("SET statement_timeout='12s'");
  const pid=await value(a,'SELECT pg_backend_pid()');
  for(const q of quotes) for(const heldAsset of [asset,sibling]){
    await a.query('UPDATE public.assets SET held_at=NULL WHERE job_id=$1',[job]);
    assert.equal((await call(a,`music_get_${q.op}_source_context`,auth,song,version)).ok,true);
    const requestKey=`beat-ai.${randomUUID()}`;
    assert.equal((await call(a,`music_get_${q.op}_dispatch_context`,auth,song,q.id,requestKey)).ok,true);
    const before=await value(a,"SELECT jsonb_build_object('ledger',(SELECT count(*) FROM public.ledger_entries),'jobs',(SELECT count(*) FROM public.jobs),'dispatch',(SELECT count(*) FROM public.fal_dispatch))");
    await b.query('BEGIN');await b.query('UPDATE public.assets SET held_at=now() WHERE id=$1',[heldAsset]);
    let done=false,result,error;
    pending=call(a,q.submit,auth,song,q.id,requestKey,'https://fixture.invalid/source.mp3').then(r=>result=r,e=>error=e).finally(()=>{done=true;});
    const deadline=Date.now()+8000;let blocked=false;
    while(!done&&!blocked){
      await b.query('SELECT pg_stat_clear_snapshot()');
      blocked=await value(b,"SELECT wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 FROM pg_stat_activity WHERE pid=$1",[pid]);
      assert.ok(Date.now()<deadline,'admission did not reach source hold lock');
    }
    assert.equal(blocked,true);await b.query('COMMIT');await pending;if(error)throw error;
    assert.equal(result.code,'HELD');
    assert.deepEqual(await value(a,"SELECT jsonb_build_object('ledger',(SELECT count(*) FROM public.ledger_entries),'jobs',(SELECT count(*) FROM public.jobs),'dispatch',(SELECT count(*) FROM public.fal_dispatch))"),before);
    console.log(`PASS ${q.op} ${heldAsset===sibling?'sibling':'source'}: hold committed after context, admission waited and refused without spend or dispatch`);
  }
} finally {
  await b.query('ROLLBACK').catch(()=>{});if(pending)await pending;await a.query('ROLLBACK').catch(()=>{});
  if(user){
    await a.query('BEGIN');
    assert.equal(Number(await value(a,'SELECT count(*) FROM public.ledger_entries WHERE user_id=$1',[user])),0,'never delete a ledger fixture');
    for(const table of ['music_stem_quotes','music_target_stem_quotes','music_generation_quotes','music_prompt_specs','music_mixdown_reservations'])await a.query(`DELETE FROM public.${table} WHERE user_id=$1`,[user]);
    await a.query('UPDATE public.music_songs SET current_version_id=NULL WHERE id=$1',[song]);
    await a.query('DELETE FROM public.music_song_versions WHERE id=$1',[version]);await a.query('DELETE FROM public.music_songs WHERE id=$1',[song]);
    await a.query('DELETE FROM public.assets WHERE job_id=$1',[job]);await a.query('DELETE FROM public.jobs WHERE id=$1',[job]);
    await a.query('DELETE FROM public.credit_subscriptions WHERE user_id=$1',[user]);await a.query('DELETE FROM public.music_workspaces WHERE user_id=$1',[user]);
    await a.query('DELETE FROM public.credit_balances WHERE user_id=$1',[user]);await a.query('DELETE FROM public.users WHERE id=$1',[user]);
    await a.query('DELETE FROM auth.users WHERE id=$1',[auth]);await a.query('COMMIT');
  }
  await Promise.all([a.end(),b.end()]);
}
