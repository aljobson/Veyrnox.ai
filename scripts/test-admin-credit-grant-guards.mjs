// Actual local PostgreSQL: no production writes, no immutable audit cleanup.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated database required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(s,a=[])=> (await c.query(s,a)).rows;
async function person(admin=false){ const auth=randomUUID(); await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]); const [u]=await q('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id',[auth,admin]);return {auth,id:u.id}; }
const grant=async(a,t,key,reason='support correction',amount=7,aal='aal2',at=Math.floor(Date.now()/1000)) => (await q('SELECT public.admin_credit_grant_guarded($1,$2,$3,$4,$5,$6,$7) AS value',[a.auth,aal,at,t.id,amount,reason,key]))[0].value;
async function denied(fn){await q('SAVEPOINT denied');try {await fn();assert.fail('must refuse');}catch(e){assert.equal(e.code,'42501');}finally{await q('ROLLBACK TO SAVEPOINT denied');}}
try{
const source=await readFile(new URL('../packages/db/schema/supabase/0278_admin_credit_grant_guards.sql',import.meta.url),'utf8');await q(source);await q(source);await q('BEGIN');
const a=await person(true), b=await person(true), t=await person(), other=await person();const key=randomUUID();
const before=Number((await q('SELECT count(*) FROM public.ledger_entries'))[0].count);
const first=await grant(a,t,key);assert.equal(first.ok,true);const again=await grant(a,t,key);assert.equal(again.replayed,true);assert.equal(again.action_id,first.action_id);
for(const args of [[a,t,key,'changed reason'],[b,t,key],[a,other,key],[a,t,key,'support correction',8]]) assert.equal((await grant(...args)).code,'IDEMPOTENCY_KEY_REUSED');
assert.equal(Number((await q('SELECT count(*) FROM public.ledger_entries'))[0].count),before+1);
assert.equal((await grant(a,t,randomUUID(),'support correction',7,'aal1')).code,'MFA_REQUIRED');
assert.equal((await grant(a,t,randomUUID(),'support correction',7,'aal2',Math.floor(Date.now()/1000)-301)).code,'MFA_REQUIRED');
assert.equal((await grant(a,t,randomUUID(),'support correction',7,'aal2',Math.floor(Date.now()/1000)+10)).code,'MFA_REQUIRED');
await q('UPDATE public.users SET frozen_at=now() WHERE id=$1',[a.id]);await denied(()=>grant(a,t,randomUUID()));await q('UPDATE public.users SET frozen_at=NULL WHERE id=$1',[a.id]);
await q('DELETE FROM auth.users WHERE id=$1',[a.auth]);await denied(()=>grant(a,t,randomUUID()));await denied(()=>grant(t,other,randomUUID()));
for(const role of ['anon','authenticated','service_role']) assert.equal((await q("SELECT has_function_privilege($1,'public.admin_credit_grant(text,uuid,integer,text,text)','EXECUTE') AS allowed",[role]))[0].allowed,false);
for(const role of ['anon','authenticated']) assert.equal((await q("SELECT has_function_privilege($1,'public.admin_credit_grant_guarded(text,text,bigint,uuid,integer,text,text)','EXECUTE') AS allowed",[role]))[0].allowed,false);
assert.equal((await q("SELECT has_function_privilege('service_role','public.admin_credit_grant_guarded(text,text,bigint,uuid,integer,text,text)','EXECUTE') AS allowed"))[0].allowed,true);
await q('ROLLBACK');
// Two connections, different recipients, same global key: one grant and one conflict.
const ca=await person(true),t1=await person(),t2=await person(), ck=randomUUID();const d=new pg.Client({connectionString:url});await d.connect();
try{
await q('BEGIN');await q('SELECT pg_advisory_xact_lock(278,hashtext($1))',[ck]);
let finished=false;const second=d.query('SELECT public.admin_credit_grant_guarded($1,$2,$3,$4,7,$5,$6) AS value',[ca.auth,'aal2',Math.floor(Date.now()/1000),t2.id,'support correction',ck]).then(r=>{finished=true;return r.rows[0].value;});
await new Promise(r=>setTimeout(r,100));assert.equal(finished,false,'cross-recipient request waits on the key');assert.equal((await grant(ca,t1,ck)).ok,true);await q('COMMIT');assert.equal((await second).code,'IDEMPOTENCY_KEY_REUSED');
assert.equal(Number((await q('SELECT count(*) FROM public.account_actions WHERE idempotency_key=$1',[ck]))[0].count),1);
}finally{await d.end();}
console.log('PASS admin grants: current Auth/unfrozen role, fresh MFA, strict actor/target/amount/reason replay, cross-target serialization and service-only grants');
}finally{await c.end();}
