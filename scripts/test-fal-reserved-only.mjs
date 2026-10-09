#!/usr/bin/env node
// Local real transactions only. Never calls providers or touches a live policy.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.DATABASE_URL||'http://invalid');
if(!['localhost','127.0.0.1'].includes(url.hostname)||!/^\/(veyrnox_capacity|rebuild_check)$/.test(url.pathname)) throw Error('disposable local rebuild_check or veyrnox_capacity required');
const pool=new pg.Pool({connectionString:url.toString(),max:16});
const q=(s,a=[])=>pool.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const tag=randomUUID().slice(0,8),models={},authIds=[],userIds=[];let checks=0;
const migration=await readFile(new URL('../packages/db/schema/supabase/0240_fal_reserved_only_admission.sql',import.meta.url),'utf8');
async function user(){const id=randomUUID();authIds.push(id);await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`${id}@example.invalid`]);const u=(await one('SELECT id FROM public.users WHERE auth_id=$1',[id])).id;userIds.push(u);return u;}
const paid=(u,m,key=randomUUID(),client=pool)=>client.query("SELECT public.ledger_debit($1,$2,2,'debit:generation',$3,$4) r",[u,key,m,{prompt:'test',reserved:true}]).then(r=>r.rows[0].r);
const free=(u,m,key=randomUUID())=>one('SELECT public.submit_free_job($1,$2,$3,$4) r',[u,key,m,{prompt:'test'}]).then(r=>r.r);
const admit=(u,key=randomUUID(),f=false)=>one('SELECT public.admit_fal_dispatch($1,$2,$3,$4,$4,$5,$6) r',[u,key,models.fal,{prompt:'test'},'fal-ai/flux-2-pro',f]).then(r=>r.r);
const counts=()=>one(`SELECT (SELECT count(*)::int FROM public.jobs WHERE model_id=ANY($1::text[]) AND user_id=ANY($2::uuid[])) jobs,
 (SELECT count(*)::int FROM public.ledger_entries WHERE job_id IN(SELECT id FROM public.jobs WHERE model_id=ANY($1::text[]) AND user_id=ANY($2::uuid[]))) ledger,
 (SELECT count(*)::int FROM public.model_free_allowance_claims WHERE model_id=ANY($1::text[]) AND user_id=ANY($2::uuid[])) claims,
 (SELECT count(*)::int FROM public.fal_capacity_reservations) reservations`,[Object.values(models),userIds]);
async function cleanup(){await q('DELETE FROM public.fal_capacity_reservations WHERE job_id IN(SELECT id FROM public.jobs WHERE model_id=ANY($1::text[]) AND user_id=ANY($2::uuid[]))',[Object.values(models),userIds]);await q('DELETE FROM public.fal_dispatch WHERE job_id IN(SELECT id FROM public.jobs WHERE model_id=ANY($1::text[]) AND user_id=ANY($2::uuid[]))',[Object.values(models),userIds]);await q('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[authIds]);authIds.length=0;userIds.length=0;}
async function mode(enabled,paused=false){await q("UPDATE public.fal_capacity_policy SET enabled=$1,provider_account='reserved-fixture',model_id=$2,outstanding_limit=2,daily_limit=10,daily_budget_microusd=300000",[enabled,models.fal]);await q('UPDATE public.fal_admission_control SET paused=$1',[paused]);}
async function check(name,fn){await cleanup();await mode(true);await fn();checks++;console.log(`  ok ${name}`);}
try{
 await q(migration);
 for(const [name,provider,endpoint] of [['fal','fal','fal-ai/flux-2-pro'],['auto','veyrnox','auto-short:v1'],['edit','veyrnox','clip-edit:v1'],['agent','veyrnox','montage:v1'],['kie','kie','fixture:v1']]){
  models[name]=`reserved-${name}-${tag}`;
  await q(`INSERT INTO public.model_catalog(id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,cost_unit,gated_flag,active,free_allowance_per_day,free_allowance_daily_budget)
    VALUES($1,'Reserved-only fixture',$2,$3,'text-to-image',2,0.03,'per_generation',false,true,3,10)`,[models[name],provider,endpoint]);
 }
 await check('enabled policy rejects paid/free legacy fal and all composites before effects',async()=>{
  const u=await user(),before=await counts(),balance=(await one('SELECT balance FROM public.credit_balances WHERE user_id=$1',[u])).balance;
  for(const model of [models.fal,models.auto,models.edit,models.agent]) for(const call of [paid,free]) assert.equal((await call(u,model)).code,'PROVIDER_ADMISSION_PAUSED');
  assert.deepEqual(await counts(),before);assert.equal((await one('SELECT balance FROM public.credit_balances WHERE user_id=$1',[u])).balance,balance);
 });
 await check('different-user mixed races commit only two reserved paid jobs',async()=>{
  const uu=await Promise.all(Array.from({length:12},user));
  const rr=await Promise.all(uu.map((u,i)=>i%3===0?admit(u):paid(u,i%3===1?models.fal:models.auto)));
  assert.equal(rr.filter(r=>r.ok).length,2);assert.equal(rr.filter(r=>r.code==='PROVIDER_ADMISSION_PAUSED').length,8);
  assert.equal(rr.filter(r=>r.code==='PROVIDER_CAPACITY_UNAVAILABLE').length,2);
  assert.deepEqual(await counts(),{jobs:2,ledger:2,claims:0,reservations:2});
 });
 await check('free reserved admissions share the cap; direct free jobs cannot bypass it',async()=>{
  const uu=await Promise.all(Array.from({length:12},user));
  const rr=await Promise.all(uu.map((u,i)=>i%3===0?admit(u,randomUUID(),true):free(u,i%3===1?models.fal:models.edit)));
  assert.equal(rr.filter(r=>r.ok&&r.free).length,2);assert.equal(rr.filter(r=>r.code==='PROVIDER_ADMISSION_PAUSED').length,8);
  assert.equal(rr.filter(r=>r.code==='PROVIDER_CAPACITY_UNAVAILABLE').length,2);
  assert.deepEqual(await counts(),{jobs:2,ledger:0,claims:2,reservations:2});
 });
 await check('existing legacy paid/free replay stays valid without upgrading to a reservation',async()=>{
  await mode(false);const u=await user(),aKey=randomUUID(),bKey=randomUUID();
  const a=await paid(u,models.auto,aKey),b=await free(u,models.fal,bKey);assert.equal(a.ok,true);assert.equal(b.taken,true);
  await mode(true);const before=await counts(),aa=await paid(u,models.auto,aKey),bb=await free(u,models.fal,bKey);
  assert.equal(aa.idempotent,true);assert.equal(aa.job_id,a.job_id);assert.equal(bb.idempotent,true);assert.equal(bb.job_id,b.job_id);
  assert.deepEqual(await counts(),before);assert.equal(before.reservations,0);
 });
 await check('global pause rejects reserved paid/free admission and replay still works',async()=>{
  const u=await user(),key=randomUUID(),first=await admit(u,key);assert.equal(first.ok,true);await mode(true,true);
  const before=await counts();for(const f of [false,true]) assert.equal((await admit(u,randomUUID(),f)).code,'PROVIDER_ADMISSION_PAUSED');
  assert.equal((await admit(u,key)).job_id,first.job_id);assert.deepEqual(await counts(),before);
  const claim=(await one('SELECT public.claim_fal_dispatch($1) r',[first.job_id])).r;assert.equal(claim.disposition,'CLAIMED');
 });
 await check('unrelated providers continue paid/free admission in reserved-only mode',async()=>{
  const u=await user();assert.equal((await paid(u,models.kie)).ok,true);assert.equal((await free(u,models.kie)).taken,true);
 });
 await check('disabling capacity restores legacy admission but never overrides global pause',async()=>{
  const u=await user();await mode(false);assert.equal((await paid(u,models.auto)).ok,true);assert.equal((await free(u,models.fal)).taken,true);
  await mode(false,true);assert.equal((await paid(u,models.fal)).code,'PROVIDER_ADMISSION_PAUSED');assert.equal((await free(u,models.edit)).code,'PROVIDER_ADMISSION_PAUSED');
 });
 await check('mode activation waits for earlier legacy admission, then rejects fresh legacy jobs',async()=>{
  await mode(false);const u=await user(),c=await pool.connect(),op=await pool.connect();let update;
  try{
   await c.query('BEGIN');assert.equal((await paid(u,models.fal,randomUUID(),c)).ok,true);
   const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid,opPid=(await op.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   update=op.query('UPDATE public.fal_capacity_policy SET enabled=true');let blocked=false;
   for(let i=0;i<50&&!blocked;i++){blocked=(await one('SELECT $1::int=ANY(pg_blocking_pids($2)) blocked',[pid,opPid])).blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}
   assert.equal(blocked,true);await c.query('COMMIT');await update;
   assert.equal((await paid(u,models.fal)).code,'PROVIDER_ADMISSION_PAUSED');
  }finally{await c.query('ROLLBACK');if(update)await update;c.release();op.release();}
 });
 await check('application roles cannot invoke private debit/free helpers or set reserved authorization',async()=>{
  const sigs=['private.ledger_debit_for_admission(uuid,text,integer,text,text,jsonb,integer,integer,boolean)','private.submit_free_job_for_admission(uuid,text,text,jsonb,integer,integer,boolean)','private.fal_admission_paused(text,boolean)'];
  for(const role of ['anon','authenticated','service_role']) for(const sig of sigs) assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') yes',[role,sig])).yes,false);
  const u=await user(),c=await pool.connect();
  try{
   await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role');
   await assert.rejects(c.query("SELECT private.ledger_debit_for_admission($1,$2,2,'debit:generation',$3,'{}',0,60,true)",[u,randomUUID(),models.fal]),e=>e.code==='42501');
  }finally{await c.query('ROLLBACK');c.release();}
  for(const name of ['ledger_debit','submit_free_job']){
   const rr=(await q("SELECT pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1",[name])).rows;
   assert.equal(rr.length,1);assert.ok(!rr[0].args.includes('reserved'));
  }
  assert.equal((await paid(u,models.fal)).code,'PROVIDER_ADMISSION_PAUSED');
 });
 await check('missing capacity policy fails closed for fresh legacy admissions',async()=>{
  await mode(false);const u=await user(),c=await pool.connect();
  try{
   await c.query('BEGIN');await c.query('DELETE FROM public.fal_capacity_policy');
   assert.equal((await paid(u,models.fal,randomUUID(),c)).code,'PROVIDER_ADMISSION_PAUSED');
   assert.equal((await paid(u,models.auto,randomUUID(),c)).code,'PROVIDER_ADMISSION_PAUSED');
  }finally{await c.query('ROLLBACK');c.release();}
 });
 await check('migration replay preserves both operator controls and private helper boundaries',async()=>{
  await mode(true,true);await q(migration);
  assert.equal((await one('SELECT enabled FROM public.fal_capacity_policy')).enabled,true);
  assert.equal((await one('SELECT paused FROM public.fal_admission_control')).paused,true);
  const u=await user();assert.equal((await admit(u)).code,'PROVIDER_ADMISSION_PAUSED');
 });
 for(const name of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) assert.equal((await q(`SELECT * FROM public.${name}()`)).rows.length,0,name);
 console.log(`${checks} reserved-only checks passed; reconciliation clean`);
}finally{
 await cleanup();await q("UPDATE public.fal_capacity_policy SET enabled=false,provider_account=NULL,model_id='flux-2-pro',outstanding_limit=2,daily_limit=10,daily_budget_microusd=300000");
 await q('UPDATE public.fal_admission_control SET paused=false');await pool.end();
}
