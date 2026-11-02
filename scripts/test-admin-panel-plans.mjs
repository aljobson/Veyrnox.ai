// Host-run, isolated fully migrated local database. Every fixture rolls back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||new URL(url).searchParams.has('host')) throw Error('isolated local DATABASE_URL required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,args=[]) => (await c.query(sql,args)).rows;
const one=async(sql,args=[]) => (await q(sql,args))[0];
const call=async(name,args)=>(await one('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).value;
async function person(role) {
 const auth=randomUUID();await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,auth+'@example.invalid']);
 const user=await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id',[auth,!!role]);
 if(role)await q('INSERT INTO public.admin_roles(user_id,role) VALUES($1,$2)',[user.id,role]);return {...user,auth};
}
async function rejects(run,code) {await q('SAVEPOINT refused');try{await assert.rejects(run,e=>e.code===code);}finally{await q('ROLLBACK TO SAVEPOINT refused');}}
try {
 await q('BEGIN');
 const migration=await readFile(new URL('../packages/db/schema/supabase/0430_admin_plans.sql',import.meta.url),'utf8');await q(migration);await q(migration);
 const owner=await person('owner'),finance=await person('finance'),ordinary=await person();
 const set=(actor,id='web-209',active=false,key=randomUUID(),aal='aal2',at=new Date(),kind='pack',reason='Catalog availability')=>call('admin_plan_set_active',[actor.auth,kind,id,active,reason,key,aal,at]);
 await rejects(()=>call('admin_plans_list',[ordinary.auth]),'42501');
 assert.equal((await call('admin_plans_list',[finance.auth])).ok,true);
 for(const actor of [finance,ordinary])await rejects(()=>set(actor),'42501');
 await rejects(()=>set(owner,'web-209',false,randomUUID(),'aal1'),'P0001');
 await rejects(()=>set(owner,'web-209',false,randomUUID(),'aal2',new Date(Date.now()-301000)),'P0001');
 await rejects(()=>set(owner,'web-209',false,randomUUID(),'aal2',new Date(),'pack',''),'22023');
 // Freshness is checked after a pack lock wait, not just when the route received the request.
 const blocker=new pg.Client({connectionString:url});await blocker.connect();await q('SAVEPOINT contention');
 try {
  await blocker.query('BEGIN');await blocker.query("SELECT id FROM public.credit_packs WHERE id='web-209' FOR UPDATE");
  const waiting=assert.rejects(()=>set(owner,'web-209',false,randomUUID(),'aal2',new Date(Date.now()-299500)),e=>e.message==='mfa_required');
  await new Promise(r=>setTimeout(r,800));await blocker.query('ROLLBACK');await waiting;
 } finally {await blocker.query('ROLLBACK');await blocker.end();await q('ROLLBACK TO SAVEPOINT contention');}
 const plans=(await call('admin_plans_list',[owner.auth])).plans;
 for(const p of plans) for(const active of [true,false]) assert.equal((await set(owner,p.id,active,randomUUID(),'aal2',new Date(),'subscription')).code,'plan_read_only');
 assert.equal((await set(owner,'web-100',true)).code,'plan_read_only');
 const stores=await q("SELECT id,active FROM public.credit_packs WHERE sales_channel IN ('ios','android') ORDER BY id");
 const web=(await call('admin_plans_list',[owner.auth])).packs.find(p=>p.id==='web-209');assert.equal(web.matching_store_packs.length,2);
 assert.deepEqual(web.matching_store_packs,await q("SELECT id,sales_channel AS channel,active FROM public.credit_packs WHERE credits=$1 AND sales_channel IN ('ios','android') ORDER BY sales_channel,id",[web.credits]));
 // Zero pending, exact replay and immutable price/credits. Catalog IDs are the current 0420 set.
 const before=await one("SELECT price_usd_cents,credits FROM public.credit_packs WHERE id='web-209'");
 const key=randomUUID(),saved=await set(owner,'web-209',false,key);assert.equal(saved.ok,true,JSON.stringify(saved));
 assert.deepEqual(await set(owner,'web-209',false,key,'aal2',new Date(Date.now()-301000)),saved);
 assert.deepEqual(await set(owner,'web-209',false,key),saved);assert.equal((await set(owner,'web-209',true,key)).code,'idempotency_key_reused');
 assert.deepEqual(await one("SELECT price_usd_cents,credits FROM public.credit_packs WHERE id='web-209'"),before);
 assert.equal((await one('SELECT count(*)::int n FROM public.admin_change_log WHERE id=$1',[saved.change_id])).n,1);
 assert.equal((await set(owner,'web-209',true)).ok,true);
 const pending=await call('create_pending_top_up',[ordinary.auth,'web-209',randomUUID(),'admin-test',10,60]);assert.equal(pending.ok,true,JSON.stringify(pending));
 const row=await one('SELECT * FROM public.top_ups WHERE user_id=$1',[ordinary.id]);
 // Checkout expires at most two hours after creation; allow one further hour.
 await q("UPDATE public.top_ups SET created_at=now()-interval '4 hours' WHERE id=$1",[row.id]);
 assert.equal((await set(owner)).ok,true,'abandoned pending checkout does not block forever');
 assert.equal((await set(owner,'web-209',true)).ok,true);
 await q('UPDATE public.top_ups SET created_at=now() WHERE id=$1',[row.id]);
 const refused=await set(owner);assert.equal(refused.code,'plan_in_use');assert.equal(refused.counts.unsettled_top_ups,1);
 const order='pi_'+randomUUID().replaceAll('-','');
 assert.equal((await call('credit_top_up',[row.id,order,row.price_usd_cents,'USD',null])).ok,true);
 // Refunds retain status=credited; there is no refunded status in the CHECK.
 assert.equal((await call('apply_top_up_refund',[order,row.price_usd_cents,row.price_usd_cents,row.id])).ok,true);
 assert.deepEqual(await one('SELECT status,refunded_cents FROM public.top_ups WHERE id=$1',[row.id]),{status:'credited',refunded_cents:row.price_usd_cents});
 assert.equal((await set(owner)).ok,true,'refunded purchase is terminal');
 // Late duplicate settlement still succeeds with the pack inactive, no catalog lookup.
 assert.equal((await call('credit_top_up',[row.id,order,row.price_usd_cents,'USD',null])).ok,true);
 assert.equal((await call('create_pending_top_up',[ordinary.auth,'web-209',randomUUID(),'admin-test',10,60])).code,'PACK_NOT_FOUND');
 // Simulate a checkout holding an earlier catalog snapshot and inserting after the toggle.
 const late=await one("INSERT INTO public.top_ups(user_id,pack_id,idempotency_key,sales_channel,credits,price_usd_cents,consent_at,consent_version) VALUES($1,'web-209',$2,'web',$3,$4,now(),'admin-test') RETURNING id",[ordinary.id,randomUUID(),row.credits,row.price_usd_cents]);
 assert.equal((await call('credit_top_up',[late.id,'pi_'+randomUUID().replaceAll('-',''),row.price_usd_cents,'USD',null])).ok,true);

 assert.equal((await set(owner,'web-209',true)).ok,true);
 const earlier=await call('create_pending_top_up',[ordinary.auth,'web-209',randomUUID(),'admin-test',10,60]);assert.equal(earlier.ok,true);
 await q("UPDATE public.top_ups SET created_at=now()-interval '4 hours' WHERE id=$1",[earlier.top_up_id]);
 assert.equal((await set(owner)).ok,true);
 const earlierRow=await one('SELECT * FROM public.top_ups WHERE id=$1',[earlier.top_up_id]);
 assert.equal(earlierRow.status,'pending');
 assert.equal((await call('credit_top_up',[earlierRow.id,'pi_'+randomUUID().replaceAll('-',''),earlierRow.price_usd_cents,'USD',null])).ok,true,'first settlement of an already-pending purchase survives deactivation');
 await q(migration);await q(migration);assert.equal((await one("SELECT active FROM public.credit_packs WHERE id='web-209'")).active,false);
 assert.deepEqual(await q("SELECT id,active FROM public.credit_packs WHERE sales_channel IN ('ios','android') ORDER BY id"),stores,'web availability does not change store sales');
 for(const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits'])assert.deepEqual(await q('SELECT * FROM public.'+fn+'()'),[]);
 console.log('S4 plans: permission, MFA, read-only plans, pack guard, replay, audit, snapshot settlement and reconciliation passed');
} finally {await q('ROLLBACK');await c.end();}
