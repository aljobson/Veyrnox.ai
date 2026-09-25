// Isolated local Postgres only; never reads Stream or production credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname))throw Error('isolated local database required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,args=[]) =>(await c.query(sql,args)).rows;
const val=async(sql,args=[]) =>(await q(sql,args))[0]?.value;
const actor=randomUUID(), ids=[];
const claim=(key,client=c)=>client.query('SELECT public.claim_cinema_upload_checks($1) AS value',[key]).then(r=>r.rows[0].value.items);
const finish=(id,key,ok)=>val('SELECT public.finish_cinema_upload_check($1,$2,$3) AS value',[id,key,ok]);
const snapshot=async()=>{await q('SELECT public.refresh_recovery_health()');return val('SELECT public.recovery_status() AS value');};
try {
 const migration=await readFile(new URL('../packages/db/schema/supabase/0138_cinema_upload_recovery.sql',import.meta.url),'utf8');await c.query(migration);await c.query(migration);
 const balances=await q('SELECT * FROM public.credit_balances ORDER BY user_id');
 await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,`${actor}@example.invalid`]);
 await val('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:`u_${actor.replaceAll('-','').slice(0,20)}`,display_name:'Recovery test'}]);
 const user=await val('SELECT id AS value FROM public.users WHERE auth_id=$1',[actor]);
 // Owner-built fixtures bypass reservation caps solely in this disposable DB.
 for(let n=0;n<31;n++) {
  const content=randomUUID(),id=randomUUID();ids.push(id);
  await q("INSERT INTO public.cinema_content(id,creator_id,content_type,title,language) VALUES($1,$2,'SHORT','Recovery fixture','en')",[content,user]);
  await q("INSERT INTO public.cinema_uploads(id,content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid) VALUES($1,$2,$3,$4,100,$5,'uploading',$6)",[id,content,user,randomUUID(),'a'.repeat(64),randomUUID().replaceAll('-','')]);
 }
 const keys=[randomUUID(),randomUUID()];
 const batches=await Promise.all(keys.map(async key=>{const peer=new pg.Client({connectionString:url});await peer.connect();try{return await claim(key,peer);}finally{await peer.end();}}));
 assert.equal(batches.flat().length,31);assert.equal(new Set(batches.flat().map(x=>x.id)).size,31);
 assert.ok(batches.every(batch=>batch.length<=20));assert.deepEqual(batches.flat().map(x=>x.id).sort(),[...ids].sort());
 for(const row of batches.flat())assert.deepEqual(Object.keys(row).sort(),['id','stream_uid']);
 assert.deepEqual(await claim(keys[0]),batches[0]);assert.deepEqual(await claim(randomUUID()),[]);
 const target=batches[0][0];assert.equal((await finish(target.id,keys[0],false)).ok,true);
 const first=await val('SELECT recovery_checked_at AS value FROM public.cinema_uploads WHERE id=$1',[target.id]);
 await finish(target.id,keys[0],true);assert.equal(await val('SELECT recovery_failed AS value FROM public.cinema_uploads WHERE id=$1',[target.id]),true);
 assert.deepEqual(await val('SELECT recovery_checked_at AS value FROM public.cinema_uploads WHERE id=$1',[target.id]),first);
 // Lease expiry permits retry; older claims cannot overwrite the new attempt.
 await q("UPDATE public.cinema_uploads SET recovery_claimed_at=now()-interval '6 minutes' WHERE id=ANY($1::uuid[])",[ids]);
 const nextKey=randomUUID(),next=await claim(nextKey);assert.equal(next.length,20);
 const renewed=next[0],oldKey=batches[0].some(x=>x.id===renewed.id)?keys[0]:keys[1];
 await finish(renewed.id,nextKey,true);await finish(renewed.id,oldKey,false);
 assert.equal(await val('SELECT recovery_failed AS value FROM public.cinema_uploads WHERE id=$1',[renewed.id]),false);
 // Lost-webhook recovery uses the same terminal/idempotent observation RPC.
 const observation=[renewed.stream_uid,'ready',new Date().toISOString(),30,1080,1920];
 assert.equal((await val('SELECT public.observe_cinema_upload($1,$2,$3,$4,$5,$6) AS value',observation)).ok,true);
 assert.equal((await val('SELECT public.observe_cinema_upload($1,$2,$3,$4,$5,$6) AS value',observation)).idempotent,true);
 assert.equal(await val('SELECT lifecycle_status AS value FROM public.cinema_content WHERE id=(SELECT content_id FROM public.cinema_uploads WHERE id=$1)',[renewed.id]),'DRAFT');
 assert.equal(await val('SELECT visibility AS value FROM public.cinema_content WHERE id=(SELECT content_id FROM public.cinema_uploads WHERE id=$1)',[renewed.id]),'PRIVATE');
 // Fairness: still-unclaimed old rows must precede the twenty renewed leases.
 const remaining=await claim(randomUUID());assert.equal(remaining.length,11);assert.ok(remaining.every(x=>!next.some(y=>y.id===x.id)));
 // Build isolated health cases, relative to other suites' fixture counts.
 await q("UPDATE public.cinema_uploads SET state='ready',recovery_failed=false WHERE id=ANY($1::uuid[])",[ids]);
 const baseline=await snapshot();
 await q("UPDATE public.cinema_uploads SET state='provisioning',stream_uid=null,created_at=now()-interval '6 minutes' WHERE id=$1",[ids[0]]);
 await q("UPDATE public.cinema_uploads SET state='processing',created_at=now()-interval '4 hours',recovery_checked_at=now()-interval '41 minutes',recovery_failed=true WHERE id=$1",[ids[1]]);
 await q("UPDATE public.cinema_uploads SET state='uploading',expires_at=now()-interval '16 minutes',recovery_checked_at=now() WHERE id=$1",[ids[2]]);
 await q("UPDATE public.cinema_uploads SET state='error' WHERE id=$1",[ids[3]]);
 const health=await snapshot();
 for(const [field,delta] of Object.entries({cinema_provisioning_stuck:1,cinema_processing_stuck:1,cinema_poll_overdue:1,cinema_poll_failed:1,cinema_cleanup_required:2}))assert.equal(health[field],baseline[field]+delta,field);
 assert.equal(JSON.stringify(health).includes(actor),false);assert.equal(JSON.stringify(health).includes(renewed.stream_uid),false);
 // Browser roles cannot claim/finish; service role can invoke RPCs but not read tables.
 for(const role of ['anon','authenticated'])for(const sql of ['SELECT public.claim_cinema_upload_checks(null)','SELECT public.finish_cinema_upload_check(null,null,true)']){
  await q('BEGIN');await q(`SET LOCAL ROLE ${role}`);await assert.rejects(c.query(sql),e=>e.code==='42501');await q('ROLLBACK');
 }
 await q('BEGIN');await q('SET LOCAL ROLE service_role');assert.equal((await val('SELECT public.claim_cinema_upload_checks(null) AS value')).error,'invalid_claim');await assert.rejects(c.query('SELECT * FROM public.cinema_uploads'),e=>e.code==='42501');await q('ROLLBACK');
 assert.equal(await val('SELECT count(*)::int AS value FROM public.cinema_uploads WHERE id=ANY($1::uuid[])',[ids]),31);
 assert.deepEqual(await q('SELECT * FROM public.credit_balances WHERE user_id<>$1 ORDER BY user_id',[user]),balances);
 console.log('Cinema recovery: concurrent bounded claims, replay, lease expiry, stale completion, fairness, terminal recovery, private content, aggregate health and RPC isolation passed.');
} finally {await c.end();}
