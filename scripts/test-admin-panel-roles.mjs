import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||new URL(url).searchParams.has('host')) throw Error('isolated local DATABASE_URL required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,params=[]) => (await c.query(sql,params)).rows;
const one=async(sql,params=[]) => (await q(sql,params))[0];
const migration=await readFile(new URL('../packages/db/schema/supabase/0428_admin_roles.sql',import.meta.url),'utf8');
const call=async(name,args)=>(await one('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).value;
async function person(admin) {
  const auth=randomUUID();await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,auth+'@example.invalid']);
  return {...await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id',[auth,admin]),auth};
}
async function rejects(run,code,message) {
  await q('SAVEPOINT rejected');
  try {await assert.rejects(run,e=>e.code===code&&(!message||e.message===message));}
  finally {await q('ROLLBACK TO SAVEPOINT rejected');await q('RELEASE SAVEPOINT rejected');}
}
const fresh=()=>new Date().toISOString();
const set=(actor,target,role,key=randomUUID(),aal='aal2',at=fresh())=>call('admin_role_set',[actor.auth,target.id,role,'Test owner decision',key,aal,at]);
const revoke=(actor,target,key=randomUUID())=>call('admin_role_revoke',[actor.auth,target.id,'Test owner decision',key,'aal2',fresh()]);
try {
  await q('BEGIN');
  const owner=await person(true), target=await person(true), finance=await person(true), ordinary=await person(false);
  await q("INSERT INTO public.admin_roles(user_id,role) VALUES($1,'owner')",[owner.id]);
  // Real contention, before this transaction acquires the global mutation lock.
  const blocker=new pg.Client({connectionString:url});await blocker.connect();
  await q('SAVEPOINT wait_test');
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(427,0)');
    const at=new Date(Date.now()-299500).toISOString();
    const waiting=assert.rejects(()=>set(owner,target,'viewer',randomUUID(),'aal2',at),e=>e.message==='mfa_required');
    await new Promise(resolve=>setTimeout(resolve,800));
    await blocker.query('ROLLBACK');await waiting;
  } finally {await blocker.query('ROLLBACK');await blocker.end();await q('ROLLBACK TO SAVEPOINT wait_test');}
  // First-install simulation, entirely inside this rollback transaction.
  await q('DELETE FROM public.admin_roles');
  await q('DROP TABLE public.admin_roles_init');
  await q(migration);
  assert.equal((await one('SELECT count(*)::int AS n FROM public.admin_roles_init')).n,1);
  for(const u of [owner,target,finance]) assert.equal((await one('SELECT role FROM public.admin_roles WHERE user_id=$1',[u.id])).role,'owner');
  assert.equal((await one('SELECT count(*)::int AS n FROM public.admin_roles WHERE user_id=$1',[ordinary.id])).n,0);
  const receiptKey=()=>one("SELECT oid,conindid,conkey,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.admin_mutation_receipts'::regclass AND contype='p'");
  const originalKey=await receiptKey();assert.equal(originalKey.definition,'PRIMARY KEY (actor_user_id, idem_key)');
  await q(migration);await q(migration);
  assert.deepEqual(await receiptKey(),originalKey,'replays must preserve the constraint and backing index OIDs');
  await rejects(()=>call('admin_roles_list',[ordinary.auth]),'42501','not_admin');
  const key=randomUUID(), result=await set(owner,target,'viewer',key);
  assert.equal(result.ok,true);
  assert.deepEqual(await set(owner,target,'viewer',key,'aal2',new Date(Date.now()-301000).toISOString()),result);
  assert.deepEqual(await set(owner,target,'viewer',key),result);
  assert.equal((await set(finance,target,'viewer',key)).ok,true,'another actor can independently use the same key');
  assert.equal((await one("SELECT count(*)::int AS n FROM public.admin_change_log WHERE id=$1",[result.change_id])).n,1);
  for(const table of ['admin_roles_init','admin_mutation_receipts','admin_change_log']) {
    for(const operation of ['DELETE FROM public.'+table,'TRUNCATE public.'+table]) await rejects(()=>q(operation),'42501');
  }
  assert.equal((await set(owner,target,'support',key)).code,'idempotency_key_reused');
  await q(migration);await q(migration);
  assert.equal((await one('SELECT role FROM public.admin_roles WHERE user_id=$1',[target.id])).role,'viewer','replay never promotes a demoted owner');
  const revokeKey=randomUUID(),removed=await revoke(owner,target,revokeKey);assert.equal(removed.ok,true);
  assert.deepEqual(await revoke(owner,target,revokeKey),removed,'successful revoke still replays after the row is gone');
  const counts=()=>one('SELECT (SELECT count(*) FROM public.admin_change_log) AS audit,(SELECT count(*) FROM public.admin_mutation_receipts) AS receipts');
  const beforeNoop=await counts(),noopKey=randomUUID();
  for(let i=0;i<2;i++)assert.deepEqual(await revoke(owner,target,noopKey),{ok:false,code:'no_role'});
  assert.deepEqual(await counts(),beforeNoop,'missing role creates neither an audit nor a success receipt');
  assert.equal((await revoke(owner,{id:randomUUID()})).code,'user_not_found');
  await q(migration);await q(migration);
  assert.equal((await one('SELECT count(*)::int AS n FROM public.admin_roles WHERE user_id=$1',[target.id])).n,0,'replay never recreates a revoked role');
  assert.equal((await one('SELECT is_admin FROM public.users WHERE id=$1',[target.id])).is_admin,true);
  const late=await person(true);await q(migration);
  assert.equal((await one('SELECT count(*)::int AS n FROM public.admin_roles WHERE user_id=$1',[late.id])).n,0,'receipt prevents a later admin being automatically made owner');
  assert.equal((await set(owner,finance,'finance')).ok,true);
  assert.equal((await call('admin_permissions',[finance.auth])).role,'finance');
  await rejects(()=>call('admin_permissions',[ordinary.auth]),'42501','not_admin');
  await rejects(()=>call('admin_roles_list',[finance.auth]),'42501','permission_denied');
  assert.equal(await call('admin_has_permission',[finance.auth,'plans.read']),true);
  assert.equal(await call('admin_has_permission',[finance.auth,'plans.write']),false);
  await rejects(()=>set(finance,target,'owner'),'42501','permission_denied');
  await rejects(()=>call('admin_changes_feed',[finance.auth]),'42501','permission_denied');
  assert.equal((await call('admin_referrals_summary',[finance.auth,30,10])).ok,true);
  for(const [aal,at] of [['aal1',fresh()],['aal2',null],['aal2',new Date(Date.now()-301000).toISOString()],['aal2',new Date(Date.now()+10000).toISOString()]]) {
    await rejects(()=>set(owner,target,'viewer',randomUUID(),aal,at),'P0001','mfa_required');
  }
  assert.equal((await set(owner,owner,'owner')).code,'self_role_change');
  // Other fixture owners have been demoted/revoked. Any pre-existing owner is
  // demoted only in this isolated rollback fixture to exercise the sole-owner guard.
  await q("UPDATE public.admin_roles SET role='viewer' WHERE role='owner' AND user_id<>$1",[owner.id]);
  assert.equal((await one("SELECT count(*)::int n FROM public.admin_roles WHERE role='owner'")).n,1);
  const beforeSelf=await counts();
  assert.equal((await set(owner,owner,'viewer')).code,'self_role_change');
  assert.equal((await revoke(owner,owner)).code,'self_role_change');
  assert.deepEqual(await counts(),beforeSelf,'self changes write neither audit nor receipt');
  assert.equal((await one('SELECT role FROM public.admin_roles WHERE user_id=$1',[owner.id])).role,'owner');
  await q("INSERT INTO public.admin_roles(user_id,role) VALUES($1,'owner')",[ordinary.id]);
  await rejects(()=>call('admin_has_permission',[ordinary.auth,'roles.write']),'42501','not_admin');
  for(const table of ['admin_roles','admin_roles_init','admin_mutation_receipts']) {
    assert.deepEqual(await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",['public.'+table]),{relrowsecurity:true,relforcerowsecurity:true});
    for(const role of ['anon','authenticated','service_role']) assert.equal((await one("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[role,'public.'+table])).allowed,false);
  }
  for(const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) assert.deepEqual(await q('SELECT * FROM public.'+fn+'()'),[]);
  console.log('S2 roles: first install, receipt, demotion/revocation replay, exact idempotency, permission checks, MFA after contention, own/last-owner guards and RLS passed');
} finally {await q('ROLLBACK');await c.end();}
