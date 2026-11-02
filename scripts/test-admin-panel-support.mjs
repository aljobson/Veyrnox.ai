// Host-run isolated local DB, same transaction/rollback discipline as S0–S3.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||new URL(url).searchParams.has('host'))throw Error('isolated local DATABASE_URL required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(s,a=[])=>(await c.query(s,a)).rows;
const one=async(s,a=[])=>(await q(s,a))[0];
const call=async(n,a)=>(await one('SELECT public.'+n+'('+a.map((_,i)=>'$'+(i+1)).join(',')+') AS v',a)).v;
async function person(role){const auth=randomUUID(),email=auth+'@example.invalid';await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,email]);const u=await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id',[auth,!!role]);if(role)await q('INSERT INTO public.admin_roles(user_id,role) VALUES($1,$2)',[u.id,role]);return{...u,auth,email};}
async function refuses(fn,code){await q('SAVEPOINT refused');try{await assert.rejects(fn,e=>e.code===code);}finally{await q('ROLLBACK TO SAVEPOINT refused');}}
try {
 await q('BEGIN');const migration=await readFile(new URL('../packages/db/schema/supabase/0432_admin_support.sql',import.meta.url),'utf8');await q(migration);await q(migration);
 const owner=await person('owner'),support=await person('support'),viewer=await person('viewer'),user=await person();
 // A support transaction cannot serialize unrelated privileged control writes.
 const supportLock=new pg.Client({connectionString:url});await supportLock.connect();
 try {
  await supportLock.query('BEGIN');await supportLock.query('SELECT pg_advisory_xact_lock(431,0)');
  await q("SET LOCAL statement_timeout='2s'");
  assert.equal((await call('admin_switch_set',[owner.auth,'generation','on','Support lock independence',randomUUID(),'aal2',new Date()])).ok,true);
 } finally {await supportLock.query('ROLLBACK');await supportLock.end();await q("SET LOCAL statement_timeout=0");}
 const create=(actor=user,key=randomUUID(),subject='Private subject',body='Private body')=>call('support_ticket_create',[actor.auth,subject,'account',body,key]);
 await q("DELETE FROM public.runtime_switches WHERE key='support_intake'");assert.equal((await create()).code,'support_unavailable');
 assert.deepEqual((await call('admin_support_list',[owner.auth])).tickets,[]);
 await q("INSERT INTO public.runtime_switches(key,state,reason,updated_by) VALUES('support_intake','on','Local proof',$1)",[owner.id]);
 for(const [subject,body]of [['','body'],['x'.repeat(201),'body'],['subject',''],['subject','x'.repeat(5001)]])await refuses(()=>create(user,randomUUID(),subject,body),'22023');
 const key=randomUUID(),ticket=await create(user,key);assert.equal(ticket.ok,true);
 assert.deepEqual(await create(user,key),ticket);assert.equal((await create(user,key,'Different')).code,'idempotency_key_reused');
 assert.equal((await create()).code,'rate_limited');
 const id=ticket.ticket_id;
 for(const actor of [user,viewer]) {
  for(const [fn,args]of [['admin_support_list',[actor.auth]],['admin_support_get',[actor.auth,id]],['admin_support_agent_log',[actor.auth,id]],['admin_support_reply',[actor.auth,id,'Reply','support-reply',randomUUID()]],['admin_support_set_status',[actor.auth,id,'solved','support-status',randomUUID()]],['admin_support_assign',[actor.auth,id,null,'support-assign',randomUUID()]]])await refuses(()=>call(fn,args),'42501');
 }
 for(const limit of [0,101])await refuses(()=>call('admin_support_list',[owner.auth,null,null,limit]),'22023');
 const replyKey=randomUUID(),reply=await call('admin_support_reply',[support.auth,id,'Quoted Private body '+user.email,'support-reply',replyKey]);assert.equal(reply.ok,true);
 assert.deepEqual(await call('admin_support_reply',[support.auth,id,'Quoted Private body '+user.email,'support-reply',replyKey]),reply);
 assert.equal((await call('admin_support_assign',[owner.auth,id,viewer.id,'support-assign',randomUUID()])).code,'assignee_invalid');
 assert.equal((await call('admin_support_assign',[owner.auth,id,support.id,'support-assign',randomUUID()])).ok,true);
 assert.equal((await call('admin_support_set_status',[support.auth,id,'pending','support-status',randomUUID()])).ok,true);
 await refuses(()=>call('admin_support_reply',[owner.auth,id,'body','Contains secret text',randomUUID()]),'22023');
 const runKey=randomUUID(),run=await call('support_agent_record',[id,'future-agent','classify','completed',runKey]);assert.equal(run.ok,true);
 assert.deepEqual(await call('support_agent_record',[id,'future-agent','classify','completed',runKey]),run);
 assert.equal((await call('support_agent_record',[id,'future-agent','reply','completed',runKey])).code,'idempotency_key_reused');
 assert.equal((await call('admin_support_agent_log',[owner.auth,id])).runs.length,1);
 const thread=await call('admin_support_get',[support.auth,id]);assert.equal(thread.messages.length,2);assert.equal(thread.ticket.status,'pending');
 const audit=await q("SELECT subject,\"before\",\"after\",reason FROM public.admin_change_log WHERE area='support'");assert.ok(audit.length>=3);
 assert.ok(!JSON.stringify(audit).includes('Private'));assert.ok(!JSON.stringify(await q("SELECT request,result FROM public.support_intake_receipts WHERE user_id=$1",[user.id])).includes('Private'));
 assert.deepEqual(await q('SELECT * FROM public.admin_mutation_receipts WHERE actor_user_id=$1',[user.id]),[]);
 for(const table of ['support_messages','support_agent_runs'])for(const sql of ['UPDATE public.'+table+' SET created_at=created_at','DELETE FROM public.'+table,'TRUNCATE public.'+table])await refuses(()=>q(sql),'42501');
 // A spoofed local setting cannot authorize a different edit, even as the fixture owner.
 await q("SELECT set_config('veyrnox.support_erasing',$1,true)",[user.id]);
 await refuses(()=>q("UPDATE public.support_messages SET body='[erased]',author_label='[erased]',created_at=now()+interval '1 second' WHERE ticket_id=$1",[id]),'42501');await q("SELECT set_config('veyrnox.support_erasing','',true)");
 for(const table of ['support_tickets','support_messages','support_agent_runs','support_intake_receipts']) {
  assert.deepEqual(await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+table]),{relrowsecurity:true,relforcerowsecurity:true});
  for(const role of ['anon','authenticated','service_role'])assert.equal((await one("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role,'public.'+table])).allowed,false);
 }
 assert.equal((await one("SELECT has_function_privilege('service_role','private.erase_support_for_user(uuid)','EXECUTE') allowed")).allowed,false);
 // Hard-delete a provisioned author with no ledger rows, like existing cleanup scripts.
 const hardAuth=randomUUID(),hardAuthor=await call('provision_user',[hardAuth,hardAuth+'@example.invalid']);
 const hardMessage=await one("INSERT INTO public.support_messages(ticket_id,author_kind,author_user_id,author_label,body) VALUES($1,'admin',$2,'Author label','Retained reply') RETURNING id",[id,hardAuthor]);
 await refuses(()=>q('UPDATE public.support_messages SET author_user_id=NULL WHERE id=$1',[hardMessage.id]),'42501');
 // Same key as another customer: independent receipt, actual intake, no admin audit FK.
 const hardCreated=await create({auth:hardAuth},key,'Hard-delete subject','Hard-delete body');assert.equal(hardCreated.ok,true);
 const hardTicket={id:hardCreated.ticket_id};assert.notEqual(hardTicket.id,id);
 assert.equal((await one('SELECT count(*)::int n FROM public.support_intake_receipts WHERE user_id=$1',[hardAuthor])).n,1);
 await q("INSERT INTO public.support_agent_runs(ticket_id,agent_name,action,summary,outcome,idem_key) VALUES($1,'future-agent','classify',$2,'completed',$3)",[hardTicket.id,'ticket='+hardTicket.id+';status=open;action=classify',randomUUID()]);
 assert.equal((await q('DELETE FROM public.users WHERE id=$1 RETURNING id',[hardAuthor])).length,1);
 assert.deepEqual(await q('SELECT * FROM public.support_intake_receipts WHERE user_id=$1',[hardAuthor]),[]);
 assert.deepEqual(await one('SELECT user_id,email,subject FROM public.support_tickets WHERE id=$1',[hardTicket.id]),{user_id:null,email:'[erased]',subject:'[erased]'});
 assert.deepEqual(await one('SELECT author_user_id,author_label,body FROM public.support_messages WHERE ticket_id=$1',[hardTicket.id]),{author_user_id:null,author_label:'[erased]',body:'[erased]'});
 assert.equal((await one('SELECT summary FROM public.support_agent_runs WHERE ticket_id=$1',[hardTicket.id])).summary,'[erased]');
 assert.deepEqual(await one('SELECT author_user_id,author_label,body FROM public.support_messages WHERE id=$1',[hardMessage.id]),{author_user_id:null,author_label:'[erased]',body:'Retained reply'});
 // Erasing an admin anonymizes their replies in other users' threads, retaining bodies.
 const departing=await person('support');
 assert.equal((await call('admin_support_reply',[departing.auth,id,'Retained admin reply','support-reply',randomUUID()])).ok,true);
 const adminMessage=await one('SELECT id FROM public.support_messages WHERE author_user_id=$1',[departing.id]);
 const adminDeletion=await call('prepare_account_deletion',[departing.auth]);assert.equal(adminDeletion.eligible,true,JSON.stringify(adminDeletion));
 assert.equal((await call('erase_account',[departing.auth,adminDeletion.confirmation_token])).ok,true);
 assert.deepEqual(await one('SELECT author_user_id,author_label,body FROM public.support_messages WHERE id=$1',[adminMessage.id]),{author_user_id:null,author_label:'[erased]',body:'Retained admin reply'});
 // Cap unresolved tickets; solved does not consume capacity, and the 30-second gate is independent.
 await q("UPDATE public.support_tickets SET created_at=now()-interval '1 minute' WHERE user_id=$1",[user.id]);
 for(let i=0;i<4;i++)await q("INSERT INTO public.support_tickets(user_id,email,subject,category,created_at) VALUES($1,$2,'Private subject','account',now()-interval '1 minute')",[user.id,user.email]);
 assert.equal((await create()).code,'ticket_limit');
 const page=await call('admin_support_list',[owner.auth,null,null,2]);assert.equal(page.tickets.length,2);assert.ok(page.next);
 const next=await call('admin_support_list',[owner.auth,null,page.next,2]);assert.equal(next.tickets.length,2);assert.ok(next.tickets.every(t=>!page.tickets.some(p=>p.id===t.id)));
 // Real account deletion, not a direct users UPDATE or a classification-only test.
 const prepared=await call('prepare_account_deletion',[user.auth]);assert.equal(prepared.eligible,true,JSON.stringify(prepared));
 assert.equal((await call('erase_account',[user.auth,prepared.confirmation_token])).ok,true);
 assert.deepEqual(await q('SELECT * FROM public.support_intake_receipts WHERE user_id=$1',[user.id]),[]);
 const erased=await call('admin_support_get',[owner.auth,id]);assert.equal(erased.ticket.user_id,null);assert.equal(erased.ticket.email,'[erased]');assert.equal(erased.ticket.subject,'[erased]');
 assert.ok(erased.messages.every(m=>m.body==='[erased]'&&m.author_label==='[erased]'));
 assert.ok((await call('admin_support_agent_log',[owner.auth,id])).runs.every(r=>r.summary==='[erased]'));
 assert.equal((await call('admin_support_reply',[owner.auth,id,'New reply','support-reply',randomUUID()])).code,'ticket_erased');
 for(const table of ['support_tickets','support_messages','support_agent_runs']){const serialized=JSON.stringify(await q('SELECT * FROM public.'+table));assert.ok(!serialized.includes(user.email));assert.ok(!serialized.includes('Private'));}
 await q(migration);await q(migration);assert.equal((await call('admin_support_get',[owner.auth,id])).ticket.subject,'[erased]');
 for(const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits'])assert.deepEqual(await q('SELECT * FROM public.'+fn+'()'),[]);
 console.log('S6 support: access, bounds, cap/rate, pagination, replay, audit, append-only, restricted erasure and real erase_account passed');
} finally {await q('ROLLBACK');await c.end();}
