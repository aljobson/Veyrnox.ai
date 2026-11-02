// Host-run against a fully migrated isolated local DB. No fixture survives.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||new URL(url).searchParams.has('host')) throw Error('isolated local DATABASE_URL required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,params=[]) => (await c.query(sql,params)).rows;
const one=async(sql,params=[]) => (await q(sql,params))[0];
const call=async(name,args)=>(await one('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).value;
async function person(role) {
  const auth=randomUUID();await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,auth+'@example.invalid']);
  const user=await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id',[auth,!!role]);
  if(role)await q('INSERT INTO public.admin_roles(user_id,role) VALUES($1,$2)',[user.id,role]);
  return {...user,auth};
}
async function rejects(run,code,message) {
  await q('SAVEPOINT rejected');
  try {await assert.rejects(run,e=>e.code===code&&(!message||e.message===message));}
  finally {await q('ROLLBACK TO SAVEPOINT rejected');await q('RELEASE SAVEPOINT rejected');}
}
const fresh=()=>new Date().toISOString();
const set=(actor,key='generation',state='off',idem=randomUUID(),aal='aal2',at=fresh(),reason='Pause new work')=>call('admin_switch_set',[actor.auth,key,state,reason,idem,aal,at]);
try {
  await q('BEGIN');
  const migration=await readFile(new URL('../packages/db/schema/supabase/0429_runtime_switches.sql',import.meta.url),'utf8');
  await q(migration);await q(migration);
  const owner=await person('owner'),finance=await person('finance'),ordinary=await person();
  const first=await call('admin_switch_list',[owner.auth]);assert.equal(first.switches.length,6);
  for(const actor of [ordinary,finance]) {
    await rejects(()=>call('admin_switch_list',[actor.auth]),'42501',actor===ordinary?'not_admin':'permission_denied');
    await rejects(()=>set(actor),'42501');
  }
  // Hold the same advisory lock on another connection until the trusted MFA expires.
  const blocker=new pg.Client({connectionString:url});await blocker.connect();await q('SAVEPOINT contention');
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(427,0)');
    const waiting=assert.rejects(()=>set(owner,'chat','off',randomUUID(),'aal2',new Date(Date.now()-299500).toISOString()),e=>e.message==='mfa_required');
    await new Promise(r=>setTimeout(r,800));await blocker.query('ROLLBACK');await waiting;
  } finally {await blocker.query('ROLLBACK');await blocker.end();await q('ROLLBACK TO SAVEPOINT contention');}
  for(const [aal,at] of [['aal1',fresh()],['aal2',null],['aal2',new Date(Date.now()-301000).toISOString()],['aal2',new Date(Date.now()+10000).toISOString()]]) await rejects(()=>set(owner,'chat','off',randomUUID(),aal,at),'P0001','mfa_required');
  for(const [key,state,reason] of [['unknown','off','test'],['chat','invalid','test'],['chat','off',''],['chat','off','x'.repeat(501)]]) await rejects(()=>set(owner,key,state,randomUUID(),'aal2',fresh(),reason),'22023');
  const idem=randomUUID(),saved=await set(owner,'generation','off',idem);assert.equal(saved.ok,true);
  assert.deepEqual(await set(owner,'generation','off',idem,'aal2',new Date(Date.now()-301000).toISOString()),saved);
  assert.deepEqual(await set(owner,'generation','off',idem),saved);
  assert.equal((await set(owner,'generation','on',idem)).code,'idempotency_key_reused');
  assert.equal((await one('SELECT count(*)::int AS n FROM public.admin_change_log WHERE id=$1',[saved.change_id])).n,1);
  const audit=await one('SELECT area,"before","after",reason FROM public.admin_change_log WHERE id=$1',[saved.change_id]);
  assert.equal(audit.area,'switch');assert.deepEqual(audit.after,{state:'off'});assert.equal(audit.reason,'Pause new work');
  for(const key of ['chat','publish','cinema','telemetry','support_intake']) assert.equal((await set(owner,key,'on')).ok,true);
  await q(migration);await q(migration);
  assert.equal((await one("SELECT state FROM public.runtime_switches WHERE key='generation'")).state,'off');
  const history=await call('admin_changes_feed',[owner.auth,'switch']);assert.ok(history.entries.some(r=>r.id===saved.change_id));
  for(const sql of ['UPDATE public.admin_change_log SET reason=reason','DELETE FROM public.admin_change_log','TRUNCATE public.admin_change_log']) await rejects(()=>q(sql),'42501');
  assert.deepEqual(await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.runtime_switches'::regclass"),{relrowsecurity:true,relforcerowsecurity:true});
  for(const role of ['anon','authenticated']) assert.equal((await one("SELECT has_table_privilege($1,'public.runtime_switches','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[role])).allowed,false);
  assert.equal((await one("SELECT has_table_privilege('service_role','public.runtime_switches','SELECT') AS allowed")).allowed,true);
  assert.equal((await one("SELECT has_table_privilege('service_role','public.runtime_switches','INSERT,UPDATE,DELETE,TRUNCATE') AS allowed")).allowed,false);
  // A paused fresh publish claim is restored exactly without a failed attempt.
  const brand=await one("INSERT INTO public.social_brands(owner_user_id,label) VALUES($1,'Pause fixture') RETURNING id",[owner.id]);
  const account=await one("INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc) VALUES($1,'twitter',$2,'\\x01') RETURNING id",[brand.id,randomUUID()]);
  const post=await one("INSERT INTO public.social_posts(brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES($1,$2,now(),$3) RETURNING id",[brand.id,owner.id,randomUUID()]);
  const claim=randomUUID();
  const target=await one("INSERT INTO public.social_post_targets(post_id,account_id,network,publish_status,attempts,provider_state,claim_key,claimed_from_status,claimed_attempts,claimed_provider_state) VALUES($1,$2,'twitter','publishing',2,'{}',$3,'pending',1,'{}') RETURNING id",[post.id,account.id,claim]);
  assert.equal((await call('runtime_defer_publish',[target.id,randomUUID()])).code,'claim_lost');
  assert.equal((await call('runtime_defer_publish',[target.id,claim])).ok,true);
  assert.deepEqual(await one('SELECT publish_status,attempts,claim_key FROM public.social_post_targets WHERE id=$1',[target.id]),{publish_status:'pending',attempts:1,claim_key:null});
  await q("UPDATE public.social_post_targets SET publish_status='publishing',claim_key=$2,provider_state='{\"submission_started\":true}' WHERE id=$1",[target.id,claim]);
  assert.equal((await call('runtime_defer_publish',[target.id,claim])).code,'claim_lost','in-flight provider state cannot be reset');
  // With a one-slot batch, older fresh work cannot starve a continuation.
  const older=await one("INSERT INTO public.social_posts(brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES($1,$2,now()-interval '1 hour',$3) RETURNING id",[brand.id,owner.id,randomUUID()]);
  const queued=await one("INSERT INTO public.social_post_targets(post_id,account_id,network,publish_status) VALUES($1,$2,'twitter','pending') RETURNING id",[older.id,account.id]);
  await q("UPDATE public.social_post_targets SET publish_status='submitted',next_attempt_at=now()-interval '1 second',claim_key=NULL WHERE id=$1",[target.id]);
  assert.equal((await set(owner,'publish','off')).ok,true);
  const continuing=await q('SELECT * FROM public.claim_due_social_post_targets_v2(1)');
  assert.deepEqual(continuing.map(r=>r.target_id),[target.id]);
  assert.deepEqual(await one('SELECT publish_status,attempts FROM public.social_post_targets WHERE id=$1',[queued.id]),{publish_status:'pending',attempts:0});
  assert.equal((await set(owner,'publish','on')).ok,true);
  assert.deepEqual((await q('SELECT * FROM public.claim_due_social_post_targets_v2(1)')).map(r=>r.target_id),[queued.id]);
  for(const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) assert.deepEqual(await q('SELECT * FROM public.'+fn+'()'),[]);
  console.log('S3 switches: permissions, bounds, MFA after contention, idempotency, audit, replay, RLS and publish claim restoration passed');
} finally {await q('ROLLBACK');await c.end();}
