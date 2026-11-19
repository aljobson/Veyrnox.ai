#!/usr/bin/env node
// Dedicated local throwaway DB only. Committed fixtures are needed for real two-session locks.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString=process.env.DATABASE_URL;
if(!connectionString) throw Error('DATABASE_URL required');
const target=new URL(connectionString);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) throw Error('Local test database required');
const a=new pg.Client({connectionString}),b=new pg.Client({connectionString});
await a.connect();await b.connect();
await a.query("SET default_transaction_isolation='read committed'");
await b.query("SET default_transaction_isolation='read committed'");
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0])[0];
const owner=randomUUID(), barrier=562991;
let project,org,pending;
const signIn=async c=>{await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner]);await c.query('SET LOCAL ROLE authenticated');};
const oldFile=async()=>{
 const id=randomUUID();await a.query(`INSERT INTO public.project_files(id,project_id,r2_key,label,declared_bytes,actor_id,request_key,state,byte_size,content_sha256,schema_version,content_fingerprint,created_at,inspected_at)
 VALUES($1,$2,$3,'Race.fcproj',100,$4,$5,'inspected',100,repeat('a',64),17,repeat('b',64),now()-interval '31 days',now())`,[id,project,`org/${org}/project/${project}/file/${id}/v1.fcproj`,owner,randomUUID()]);return id;
};
async function waitForLock(pid) {
 const deadline=Date.now()+8000;
 while(Date.now()<deadline) {
  await a.query('SELECT pg_stat_clear_snapshot()');
  if(await value(a,"SELECT wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 FROM pg_stat_activity WHERE pid=$1",[pid]))return;
  await new Promise(r=>setTimeout(r,10));
 }
 throw Error('Expected database lock was not observed');
}
try {
 await a.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[owner,`race-${owner}@example.invalid`]);
 const workspace=await value(a,'SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1',[owner]);
 org=await value(a,'SELECT organisation_id FROM public.workspaces WHERE id=$1',[workspace]);
 await a.query('BEGIN');await signIn(a);
 project=(await value(a,'SELECT public.create_project($1,$2,$3)',[workspace,'File race fixture',randomUUID()])).project.id;await a.query('COMMIT');
 const money=await value(a,"SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.ledger_entries),'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM public.credit_balances b))");
 await b.query("SET statement_timeout='12s'");const pid=await value(b,'SELECT pg_backend_pid()');
 // Instrument a session-local copy of the actual SQL, adding only a barrier
 // between candidate selection and file locking. No production function is changed.
 await b.query('CREATE TEMP TABLE pro_file_race_marker(id integer)');
 const original=await value(b,"SELECT pg_get_functiondef('public.claim_project_file_cleanup(uuid)'::regprocedure)");
 assert.ok(original.includes('locked:=NULL;'));
 const instrumented=original.replace('public.claim_project_file_cleanup','pg_temp.claim_project_file_cleanup')
  .replace('locked:=NULL;',`PERFORM pg_advisory_xact_lock(${barrier}::bigint); locked:=NULL;`);
 await b.query(instrumented);
 const promoted=await oldFile();
 await a.query('SELECT pg_advisory_lock($1::bigint)',[barrier]);
 pending=value(b,'SELECT pg_temp.claim_project_file_cleanup($1)',[randomUUID()]).then(result=>({result}),error=>({error}));
 await waitForLock(pid);
 await a.query('BEGIN');await signIn(a);
 await value(a,'SELECT public.set_pro_project_head($1,0,$2,$3)',[project,promoted,randomUUID()]);await a.query('COMMIT');
 await a.query('SELECT pg_advisory_unlock($1::bigint)',[barrier]);
 const first=await pending;pending=null;if(first.error)throw first.error;
 assert.ok(!first.result.items.some(x=>x.id===promoted),'fresh recheck must see promotion committed after candidate selection');
 console.log('ok - promotion commits between cleanup selection and file lock: claim skips');
 const claimed=await oldFile();
 await a.query('BEGIN');const claim=await value(a,'SELECT public.claim_project_file_cleanup($1)',[randomUUID()]);
 assert.ok(claim.items.some(x=>x.id===claimed));
 await b.query('BEGIN');await signIn(b);
 pending=value(b,'SELECT public.set_pro_project_head($1,1,$2,$3)',[project,claimed,randomUUID()]).then(result=>({result}),error=>({error}));
 await waitForLock(pid);await a.query('COMMIT');const second=await pending;pending=null;await b.query('ROLLBACK');
 assert.equal(second.error?.code,'PT409');assert.equal(second.error?.message,'FILE_UNAVAILABLE');
 console.log('ok - cleanup holds file lock: promotion waits, then refuses claimed bytes');
 const overlap=await oldFile();
 await a.query('BEGIN');const sweepA=await value(a,'SELECT public.claim_project_file_cleanup($1)',[randomUUID()]);
 const sweepB=await value(b,'SELECT public.claim_project_file_cleanup($1)',[randomUUID()]);await a.query('COMMIT');
 assert.ok(sweepA.items.some(x=>x.id===overlap));assert.ok(!sweepB.items.some(x=>x.id===overlap));
 assert.equal(await value(a,'SELECT cleanup_attempts FROM public.project_files WHERE id=$1',[overlap]),1);
 assert.deepEqual(await value(a,"SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.ledger_entries),'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM public.credit_balances b))"),money);
 console.log('ok - overlapping sweeps claim once; operations leave the ledger and balances unchanged');
} finally {
 await a.query('ROLLBACK').catch(()=>{});
 await a.query('SELECT pg_advisory_unlock($1::bigint)',[barrier]).catch(()=>{});
 if(pending)await pending;
 await b.query('ROLLBACK').catch(()=>{});
 // Test-only removal of exactly this script's committed file/history fixtures.
 // Guards are disabled and restored atomically, only in this local throwaway DB.
 try {
  if(project) {
   await a.query('BEGIN');
   await a.query('ALTER TABLE public.project_pro_heads DISABLE TRIGGER project_pro_head_guard');
   await a.query('ALTER TABLE public.project_files DISABLE TRIGGER project_file_guard');
   await a.query('DELETE FROM public.project_pro_heads WHERE project_id=$1',[project]);
   await a.query('DELETE FROM public.project_files WHERE project_id=$1',[project]);
   await a.query('ALTER TABLE public.project_pro_heads ENABLE TRIGGER project_pro_head_guard');
   await a.query('ALTER TABLE public.project_files ENABLE TRIGGER project_file_guard');
   await a.query('COMMIT');
  }
 } finally {await a.query('ROLLBACK').catch(()=>{});await Promise.all([a.end(),b.end()]);}
}
