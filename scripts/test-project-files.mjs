#!/usr/bin/env node
// Local full-replay database only. All single-session fixtures and migration replay roll back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL required (local throwaway database)');
const target = new URL(connectionString);
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) throw Error('Local test database required');
const db = new pg.Client({ connectionString }); await db.connect();
const q = (sql,args=[]) => db.query(sql,args);
const value = async(sql,args=[]) => Object.values((await q(sql,args)).rows[0])[0];
const actor = async id => { await q('RESET ROLE'); await q("SELECT set_config('request.jwt.claim.sub',$1,true)",[id]); await q('SET LOCAL ROLE authenticated'); };
const denied = async(sql,args,code,message) => {
 await q('SAVEPOINT denied');
 try { await assert.rejects(q(sql,args),e=>e.code===code && (!message || e.message===message)); }
 finally { await q('ROLLBACK TO SAVEPOINT denied'); }
};
let count=0;
const check = async(name,fn) => { await q('SAVEPOINT fixture'); try { await fn(); console.log(`ok ${++count} - ${name}`); } finally { await q('ROLLBACK TO SAVEPOINT fixture'); } };
const owner=randomUUID(), editor=randomUUID(), viewer=randomUUID(), reviewer=randomUUID(), stranger=randomUUID();
let project, org, workspace;
const reserveSQL='SELECT public.reserve_project_file($1,$2,$3,$4)';
const headSQL='SELECT public.set_pro_project_head($1,$2,$3,$4)';
const inspectSQL='SELECT public.record_project_file_inspection($1,$2,$3,$4,$5,$6)';
const reserve=async(key=randomUUID(),size=100)=>value(reserveSQL,[project,'Cut.fcproj',size,key]);
const inspect=async id=>{ await q('RESET ROLE'); return value(inspectSQL,[id,'a'.repeat(64),100,17,'b'.repeat(64),null]); };
const fixture=async({state='inspected',age='31 days',size=100,cleanup='live'}={})=>{
 await q('RESET ROLE'); const id=randomUUID();
 await q(`INSERT INTO public.project_files(id,project_id,r2_key,label,declared_bytes,actor_id,request_key,state,created_at,inspected_at,byte_size,content_sha256,schema_version,content_fingerprint,reject_reason,cleanup_state,claim_key,claimed_at)
 VALUES($1,$2,$3,'Fixture.fcproj',$4::bigint,$5,$6,$7,now()-$8::interval,CASE WHEN $7='quarantined' THEN NULL ELSE now() END,
 CASE WHEN $7='inspected' THEN $4::bigint ELSE NULL END,CASE WHEN $7='inspected' THEN repeat('a',64) ELSE NULL END,
 CASE WHEN $7='inspected' THEN 17 ELSE NULL END,CASE WHEN $7='inspected' THEN repeat('b',64) ELSE NULL END,
 CASE WHEN $7='rejected' THEN 'invalid_json' ELSE NULL END,$9,CASE WHEN $9='claimed' THEN gen_random_uuid() ELSE NULL END,CASE WHEN $9='claimed' THEN now()-interval '2 hours' ELSE NULL END)`,
 [id,project,`org/${org}/project/${project}/file/${id}/v1.fcproj`,size,owner,randomUUID(),state,age,cleanup]);
 return id;
};
try {
 await q('BEGIN');
 const sql=(await readFile(new URL('../packages/db/schema/supabase/0562_pro_project_files.sql',import.meta.url),'utf8')).replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
 await q(sql); await q(sql);
 await q('GRANT USAGE ON SCHEMA auth TO authenticated');
 for(const id of [owner,editor,viewer,reviewer,stranger]) await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`file-${id}@example.invalid`]);
 workspace=await value('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1',[owner]);
 org=await value('SELECT organisation_id FROM public.workspaces WHERE id=$1',[workspace]);
 await q("INSERT INTO public.organisation_members VALUES($1,$2,'EDITOR'),($1,$3,'VIEWER'),($1,$4,'REVIEWER')",[org,editor,viewer,reviewer]);
 await actor(owner); project=(await value('SELECT public.create_project($1,$2,$3)',[workspace,'File acceptance',randomUUID()])).project.id;
 await check('reservations are replay-safe in every verdict state and reject payload collisions',async()=>{
  const key=randomUUID(), first=await reserve(key); assert.equal(first.state,'quarantined'); assert.equal((await reserve(key)).file_id,first.file_id);
  await denied(reserveSQL,[project,'Other.fcproj',100,key],'PT409','IDEMPOTENCY_CONFLICT');
  await inspect(first.file_id); await actor(owner);
  const replay=await reserve(key); assert.equal(replay.state,'inspected'); assert.equal(replay.content_sha256,'a'.repeat(64)); assert.equal(replay.cleanup_state,'live');
  const secondKey=randomUUID(), second=await reserve(secondKey); await q('RESET ROLE'); await value(inspectSQL,[second.file_id,null,null,null,null,'invalid_json']);
  await actor(owner); assert.equal((await reserve(secondKey)).reject_reason,'invalid_json');
 });
 await check('roles, cross-project denial and RLS: only write roles see file rows (viewers and reviewers see none until owner sign-off)',async()=>{
  const first=await reserve(); await inspect(first.file_id); await actor(owner); const pending=await reserve();
  for(const id of [viewer,reviewer,stranger]) {
   await actor(id); await denied(reserveSQL,[project,'Cut.fcproj',100,randomUUID()],'PT404');
   await denied('SELECT public.consume_project_file_inspection($1,$2)',[project,first.file_id],'PT404');
   assert.equal(Number(await value('SELECT count(*) FROM public.project_files WHERE project_id=$1',[project])),0);
  }
  await actor(editor); assert.equal((await reserve()).state,'quarantined');
  await denied('SELECT public.consume_project_file_inspection($1,$2)',[randomUUID(),pending.file_id],'PT404');
  await denied('SELECT request_key FROM public.project_files',[],'42501');
 });
 await check('head CAS, replay, payload collision, file ownership, final verdict and append-only guards',async()=>{
  const f=await reserve(); await denied(headSQL,[project,0,f.file_id,randomUUID()],'PT400');
  await inspect(f.file_id); await actor(owner);
  const key=randomUUID(); assert.equal((await value(headSQL,[project,0,f.file_id,key])).revision,1);
  assert.equal((await value(headSQL,[project,0,f.file_id,key])).idempotent,true);
  await denied(headSQL,[project,1,f.file_id,key],'PT409','IDEMPOTENCY_CONFLICT');
  await denied(headSQL,[project,0,f.file_id,randomUUID()],'PT409','VERSION_CONFLICT');
  await denied(headSQL,[project,1,randomUUID(),randomUUID()],'PT404');
  await q('RESET ROLE');
  await denied(inspectSQL,[f.file_id,'c'.repeat(64),100,17,'b'.repeat(64),null],'PT409','VERDICT_FINAL');
  for(const table of ['project_files','project_pro_heads']) {
   await denied(`DELETE FROM public.${table}`,[],'42501');
   // project_pro_heads has a foreign key to project_files, and Postgres checks foreign keys before
   // it fires BEFORE TRUNCATE triggers: project_files is refused with 0A000 (the trigger is a second
   // line), while project_pro_heads, which nothing references, reaches the guard (P0001).
   await denied(`TRUNCATE public.${table}`,[],table==='project_files'?'0A000':'P0001');
  }
  await denied('UPDATE public.project_files SET label=$1 WHERE id=$2',['rewrite',f.file_id],'42501');
  await denied('UPDATE public.project_pro_heads SET actor_id=$1',[stranger],'42501');
 });
 await check('quotas count claimed bytes/objects; only confirmed purge releases the allocation',async()=>{
  const ids=[]; for(let i=0;i<25;i++) ids.push(await fixture({size:8388608,cleanup:'claimed'}));
  await actor(owner); await denied(reserveSQL,[project,'Cut.fcproj',1,randomUUID()],'PT429','STORAGE_QUOTA_EXCEEDED');
  await q('RESET ROLE'); const key=await value('SELECT claim_key FROM public.project_files WHERE id=$1',[ids[0]]);
  await value('SELECT public.finish_project_file_cleanup($1,$2,$3)',[ids[0],key,'delete_failed']);
  await actor(owner); await denied(reserveSQL,[project,'Cut.fcproj',1,randomUUID()],'PT429','STORAGE_QUOTA_EXCEEDED');
  await q('RESET ROLE'); assert.equal(await value('SELECT public.finish_project_file_cleanup($1,$2)',[ids[0],key]),true);
  await actor(owner); assert.equal((await reserve()).state,'quarantined');
 });
 await check('object cap 100 and quarantine cap 20 are enforced separately',async()=>{
  await q('SAVEPOINT object_cap'); for(let i=0;i<100;i++) await fixture({size:1});
  await actor(owner); await denied(reserveSQL,[project,'Cut.fcproj',1,randomUUID()],'PT429','STORAGE_QUOTA_EXCEEDED'); await q('ROLLBACK TO SAVEPOINT object_cap');
  for(let i=0;i<20;i++) await reserve();
  await denied(reserveSQL,[project,'Cut.fcproj',1,randomUUID()],'PT429','STORAGE_QUOTA_EXCEEDED');
 });
 await check('reserve 30/min, inspect 10/min and head 1000 revision caps have distinct errors',async()=>{
  const f=await reserve(); await inspect(f.file_id); await actor(owner);
  for(let i=0;i<10;i++) await value('SELECT public.consume_project_file_inspection($1,$2)',[project,f.file_id]);
  await denied('SELECT public.consume_project_file_inspection($1,$2)',[project,f.file_id],'PT429','RATE_LIMITED');
  await q('RESET ROLE');
  await q("INSERT INTO private.project_file_requests(actor_id,kind) SELECT $1,'reserve' FROM generate_series(1,29)",[owner]);
  await actor(owner); await denied(reserveSQL,[project,'Cut.fcproj',100,randomUUID()],'PT429','RATE_LIMITED');
  await q('RESET ROLE'); await q("INSERT INTO public.project_pro_heads(project_id,revision,file_id,actor_id,expected_revision,request_key) SELECT $1,n,$2,$3,n-1,'fixture-head-'||n FROM generate_series(1,1000) n",[project,f.file_id,owner]);
  await actor(owner); await denied(headSQL,[project,1000,f.file_id,randomUUID()],'PT429','LIMIT_REACHED');
 });
 await check('cleanup fences promotion, retains live head references, retries stale claims and keeps tombstones',async()=>{
  const kept=await fixture(), orphan=await fixture(), recent=await fixture({age:'1 day'}), pending=await fixture({state:'quarantined',age:'25 hours'}), rejected=await fixture({state:'rejected',age:'25 hours'});
  await actor(owner); await value(headSQL,[project,0,kept,randomUUID()]); await q('RESET ROLE');
  const key=randomUUID(), claim=await value('SELECT public.claim_project_file_cleanup($1)',[key]);
  assert.deepEqual(new Set(claim.items.map(x=>x.id)),new Set([orphan,pending,rejected]));
  await actor(owner); await denied(headSQL,[project,1,orphan,randomUUID()],'PT409','FILE_UNAVAILABLE');
  await q('RESET ROLE'); assert.equal((await value('SELECT public.claim_project_file_cleanup($1)',[randomUUID()])).items.length,0);
  assert.equal(await value('SELECT public.finish_project_file_cleanup($1,$2)',[orphan,randomUUID()]),false);
  assert.equal(await value('SELECT public.finish_project_file_cleanup($1,$2)',[orphan,key]),true);
  assert.equal(await value('SELECT cleanup_state FROM public.project_files WHERE id=$1',[orphan]),'purged');
  assert.equal(await value('SELECT cleanup_state FROM public.project_files WHERE id=$1',[recent]),'live');
  const stale=await fixture({cleanup:'claimed'}); assert.ok((await value('SELECT public.claim_project_file_cleanup($1)',[randomUUID()])).items.some(x=>x.id===stale));
 });
 await check('deleted projects retain heads through grace, then reap even referenced files',async()=>{
  const f=await fixture(); await actor(owner); await value(headSQL,[project,0,f,randomUUID()]); await q('RESET ROLE');
  await q("UPDATE public.projects SET deleted_at=now()-interval '29 days' WHERE id=$1",[project]);
  assert.equal((await value('SELECT public.claim_project_file_cleanup($1)',[randomUUID()])).items.length,0);
  await q("UPDATE public.projects SET deleted_at=now()-interval '31 days' WHERE id=$1",[project]);
  const key=randomUUID(); assert.ok((await value('SELECT public.claim_project_file_cleanup($1)',[key])).items.some(x=>x.id===f));
  await value('SELECT public.finish_project_file_cleanup($1,$2)',[f,key]);
  assert.equal(Number(await value('SELECT count(*) FROM public.project_pro_heads WHERE file_id=$1',[f])),1);
 });
 await check('expired and purged reservations never replay as persisted',async()=>{
  const f=await fixture({state:'quarantined',age:'2 days'}); await q('RESET ROLE'); const key=await value('SELECT request_key FROM public.project_files WHERE id=$1',[f]);
  await actor(owner); await denied(reserveSQL,[project,'Fixture.fcproj',100,key],'PT409','UPLOAD_CLOSED');
  await q('RESET ROLE'); const claim=randomUUID(); await value('SELECT public.claim_project_file_cleanup($1)',[claim]); await value('SELECT public.finish_project_file_cleanup($1,$2)',[f,claim]);
  await actor(owner); await denied(reserveSQL,[project,'Fixture.fcproj',100,key],'PT409','FILE_UNAVAILABLE');
 });
 await check('exact RPC privilege layers, no direct writes, forced RLS and no user FKs',async()=>{
  await q('RESET ROLE');
  const browser=['reserve_project_file(uuid,text,bigint,text)','consume_project_file_inspection(uuid,uuid)','set_pro_project_head(uuid,integer,uuid,text)'];
  for(const signature of browser) for(const schema of ['public','private']) {
   assert.equal(await value('SELECT has_function_privilege($1,$2,$3)',['authenticated',`${schema}.${signature}`,'EXECUTE']),true);
   for(const role of ['public','anon']) assert.equal(await value('SELECT has_function_privilege($1,$2,$3)',[role,`${schema}.${signature}`,'EXECUTE']),false);
   const meta=(await q('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[`${schema}.${signature}`])).rows[0];
   assert.equal(meta.prosecdef,schema==='private'); assert.ok(meta.proconfig.includes('search_path=""'));
  }
  for(const sig of ['record_project_file_inspection(uuid,text,bigint,integer,text,text)','claim_project_file_cleanup(uuid)','finish_project_file_cleanup(uuid,uuid,text)']) {
   for(const role of ['public','anon','authenticated']) assert.equal(await value('SELECT has_function_privilege($1,$2,$3)',[role,`public.${sig}`,'EXECUTE']),false);
   assert.equal(await value('SELECT has_function_privilege($1,$2,$3)',['service_role',`public.${sig}`,'EXECUTE']),true);
  }
  for(const table of ['project_files','project_pro_heads']) {
   for(const role of ['anon','authenticated','service_role']) for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) assert.equal(await value('SELECT has_table_privilege($1,$2,$3)',[role,`public.${table}`,privilege]),false);
   assert.equal(await value('SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[`public.${table}`]),true);
  }
  assert.equal(Number(await value("SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN ('public.project_files'::regclass,'public.project_pro_heads'::regclass) AND confrelid IN ('public.users'::regclass,'auth.users'::regclass)")),0);
 });
 console.log(`Project files: ${count} acceptance cases passed; migration replay twice in rollback transaction.`);
} finally { await q('ROLLBACK').catch(()=>{}); await db.end(); }
await import('./test-project-files-concurrency.mjs');
