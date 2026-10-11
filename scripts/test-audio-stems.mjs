import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {AUDIO_STEMS} from '../lib/audioStems.mjs';
const url=new URL(process.env.DATABASE_URL||'http://invalid');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/(rebuild_check|audio_stems_test)$/.test(url.pathname))throw Error('Disposable local database required');
const db=new pg.Client({connectionString:url.href});await db.connect();
const q=(sql,args=[])=>db.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
let checks=0;async function check(name,run){await q('SAVEPOINT scenario');try{await run();console.log(`ok ${++checks} - ${name}`);}finally{await q('ROLLBACK TO SAVEPOINT scenario');await q('RELEASE SAVEPOINT scenario');}}
const auth=randomUUID(),stranger=randomUUID(),job=randomUUID(),request='demucs-'+randomUUID();
const manifest=AUDIO_STEMS.map((label,i)=>({label,r2_key:`fal/${request}/${String(i+1).padStart(16,'0')}.mp3`,mime_type:'audio/mpeg',size_bytes:100+i,sha256:String(i+1).repeat(64)}));
const store=stems=>one('SELECT public.job_stored_audio_stems($1,$2)',[request,JSON.stringify(stems)]);
const count=()=>one('SELECT count(*)::int FROM public.assets WHERE job_id=$1',[job]);
try{
 await q('BEGIN');const migration=await readFile(new URL('../packages/db/schema/supabase/0291_audio_stems.sql',import.meta.url),'utf8');await q(migration);await q(migration);
 await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]);
 const owner=await one('SELECT id FROM public.users WHERE auth_id=$1',[auth]);
 await q("INSERT INTO public.jobs(id,user_id,idempotency_key,model_id,credits,state,provider,provider_job_id,inputs) VALUES($1,$2,$3,'demucs-stems',6,'SUCCEEDED','fal',$4,'{}')",[job,owner,randomUUID(),request]);
 await check('whole manifest validation prevents partial writes, duplicate labels/keys, unsafe metadata and invalid sizes',async()=>{
  for(const bad of [manifest.slice(0,5),manifest.map((x,i)=>i===5?{...x,label:'vocals'}:x),manifest.map((x,i)=>i===5?{...x,r2_key:manifest[0].r2_key}:x),...['oops','0','20971521',null].map(size=>manifest.map((x,i)=>i===5?{...x,size_bytes:size}:x)),manifest.map((x,i)=>i===5?{...x,r2_key:'fal/foreign/0000000000000001.mp3'}:x)]){assert.equal((await store(bad)).ok,false);assert.equal(await count(),0);}
  assert.equal(await one('SELECT state::text FROM public.jobs WHERE id=$1',[job]),'SUCCEEDED');
 });
 await check('one complete atomic manifest stores six named assets; replay preserves rows, expiry and ledger',async()=>{
  const ledger=await one('SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1',[owner]);
  assert.equal((await store(manifest)).ok,true);const rows=(await q('SELECT * FROM public.assets WHERE job_id=$1 ORDER BY output_label',[job])).rows;assert.equal(rows.length,6);assert.ok(rows.every(x=>x.expires_at));
  assert.equal((await store(manifest)).ok,true);assert.deepEqual((await q('SELECT * FROM public.assets WHERE job_id=$1 ORDER BY output_label',[job])).rows,rows);
  assert.equal(await one('SELECT state::text FROM public.jobs WHERE id=$1',[job]),'STORED');assert.equal(await one('SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1',[owner]),ledger);
  assert.equal((await store(manifest.map((x,i)=>i===5?{...x,size_bytes:999}:x))).code,'STEMS_IMMUTABLE');assert.equal(await count(),6);
 });
 await check('database failure rolls back every asset and completion state together',async()=>{
  await q(`CREATE FUNCTION public.fixture_stem_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.output_label='piano' THEN RAISE EXCEPTION 'fixture store fault'; END IF; RETURN NEW; END $$`);
  await q('CREATE TRIGGER fixture_stem_fault BEFORE INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION public.fixture_stem_fault()');await q('SAVEPOINT fault');
  await assert.rejects(store(manifest),/fixture store fault/);await q('ROLLBACK TO SAVEPOINT fault');assert.equal(await count(),0);assert.equal(await one('SELECT state::text FROM public.jobs WHERE id=$1',[job]),'SUCCEEDED');
 });
 await check('every RPC remains service-only with empty search path, and forced RLS protects raw asset access',async()=>{
  for(const sig of ['public.job_stored_audio_stems(text,jsonb)','public.get_user_audio_stem(text,uuid,text)','public.get_user_asset(text,uuid)']){
   for(const role of ['anon','authenticated','service_role'])assert.equal(await one("SELECT has_function_privilege($1,$2,'EXECUTE')",[role,sig]),role==='service_role');
   assert.equal(await one('SELECT prosecdef FROM pg_proc WHERE oid=$1::regprocedure',[sig]),true);assert.deepEqual(await one('SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure',[sig]),['search_path=""']);
  }assert.equal(await one("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.assets'::regclass"),true);
 });
 await check('owner reads exact named stems; outsider and invalid labels get identical no-file response',async()=>{
  await store(manifest);for(const item of manifest){const r=await one('SELECT public.get_user_audio_stem($1,$2,$3)',[auth,job,item.label]);assert.equal(r.r2_key,item.r2_key);assert.equal(r.state,'STORED');}
  assert.deepEqual(await one('SELECT public.get_user_audio_stem($1,$2,$3)',[stranger,job,'vocals']),{ok:false,code:'NOT_FOUND'});
  assert.deepEqual(await one('SELECT public.get_user_audio_stem($1,$2,$3)',[auth,job,'unknown']),{ok:false,code:'NOT_FOUND'});
  const primary=await one('SELECT public.get_user_asset($1,$2)',[auth,job]);assert.equal(primary.r2_key,manifest[0].r2_key);assert.deepEqual(primary.output_stems,AUDIO_STEMS);
 });
 await check('any held stem blocks the entire job; expired selected files are never signed',async()=>{
  await store(manifest);await q("UPDATE public.assets SET held_at=now() WHERE job_id=$1 AND output_label='bass'",[job]);
  for(const stem of AUDIO_STEMS)assert.equal((await one('SELECT public.get_user_audio_stem($1,$2,$3)',[auth,job,stem])).code,'HELD');
  await q("UPDATE public.assets SET held_at=NULL,expires_at=now()-interval '1 second' WHERE job_id=$1",[job]);assert.equal((await one('SELECT public.get_user_asset($1,$2)',[auth,job])).code,'NOT_FOUND');
 });
 await check('ordinary generation lookups and model price stay unchanged through migration replay',async()=>{
  await q("UPDATE public.jobs SET model_id='other-model' WHERE id=$1",[job]);assert.equal((await store(manifest)).code,'JOB_NOT_COMPLETABLE');
  await q("INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES($1,'ordinary/file.png','image/png',12)",[job]);const r=await one('SELECT public.get_user_asset($1,$2)',[auth,job]);assert.equal(r.r2_key,'ordinary/file.png');assert.ok(!r.output_stems);
  const price=await one("SELECT jsonb_build_array(credits_5s,provider_cost_per_unit,cost_unit) FROM public.model_catalog WHERE id='demucs-stems'");assert.deepEqual(price,[6,.084,'per_generation']);
 });
 console.log(`${checks} audio-stem database checks passed; all fixtures rolled back`);
}finally{await q('ROLLBACK').catch(()=>{});await db.end();}
