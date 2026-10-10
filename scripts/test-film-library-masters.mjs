const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=await PGlite.create();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.users(id uuid primary key,auth_id text unique,frozen_at timestamptz);
 CREATE TABLE public.jobs(id uuid primary key,user_id uuid references public.users(id),state text);
 CREATE TABLE public.assets(id uuid primary key,job_id uuid references public.jobs(id),sha256 text,mime_type text,expires_at timestamptz);
 CREATE TABLE public.asset_reap_queue(id uuid default gen_random_uuid(),r2_key text unique);
 CREATE TABLE public.ledger_entries(delta int);
 CREATE TABLE public.credit_balances(balance int);
 INSERT INTO public.ledger_entries VALUES(0);INSERT INTO public.credit_balances VALUES(0);
 CREATE FUNCTION public.consume_job_read_request(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
 CREATE SCHEMA cron;CREATE TABLE cron.calls(name text primary key,schedule text,command text);
 CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.calls VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET schedule=$2,command=$3 RETURNING 1::bigint $$;
 INSERT INTO public.users VALUES('11111111-1111-4111-8111-111111111111','owner',null),('22222222-2222-4222-8222-222222222222','other',null),('33333333-3333-4333-8333-333333333333','frozen',now());
 INSERT INTO public.jobs VALUES('aaaaaaaa-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','STORED'),('bbbbbbbb-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','STORED');
 INSERT INTO public.assets VALUES('aaaaaaaa-2222-4222-8222-222222222222','aaaaaaaa-1111-4111-8111-111111111111',repeat('a',64),'video/mp4',now()+interval '20 days'),('bbbbbbbb-2222-4222-8222-222222222222','bbbbbbbb-1111-4111-8111-111111111111',repeat('a',64),'video/mp4',now()+interval '20 days');
`);
const migration=readFileSync(new URL('../packages/db/schema/supabase/0279_film_library_masters.sql',import.meta.url),'utf8');
await db.exec(migration);await db.exec(migration);
const master='cccccccc-1111-4111-8111-111111111111';const source='aaaaaaaa-1111-4111-8111-111111111111';
const params=['owner',master,source,'a'.repeat(64),'Empty room — final 16:9 master','b'.repeat(64),9616540,10];
const store=async(p=params)=>(await db.query('SELECT public.store_film_library_master($1,$2,$3,$4,$5,$6,$7,$8) result',p)).rows[0].result;
const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
const stored=await store();assert.equal(stored.ok,true);assert.equal(stored.id,master);assert.equal(stored.idempotent,false);
assert.equal(stored.r2_key,`film-masters/11111111-1111-4111-8111-111111111111/${master}.mp4`);
const replay=await store([...params.slice(0,1),'dddddddd-1111-4111-8111-111111111111',...params.slice(2,4),'Changed label',...params.slice(5)]);
assert.equal(replay.idempotent,true);assert.equal(replay.id,master);assert.equal((await one('SELECT label FROM public.film_library_masters')).label,params[4]);
for(const changed of [[0,'other'],[0,'frozen'],[2,'bbbbbbbb-1111-4111-8111-111111111111'],[3,'c'.repeat(64)],[6,26214401],[7,61],[5,'bad-hash'],[4,' ']]){
 const p=[...params];p[changed[0]]=changed[1];assert.equal((await store(p)).ok,false,JSON.stringify(changed));
}
const own=(await one('SELECT public.list_film_library_masters($1) result',['owner'])).result;
assert.equal(own.masters.length,1);assert.equal('r2_key' in own.masters[0],false);assert.equal(own.masters[0].seconds,10);
assert.deepEqual((await one('SELECT public.list_film_library_masters($1) result',['other'])).result.masters,[]);
assert.equal((await one('SELECT public.get_film_library_master($1,$2) result',['other',master])).result.code,'NOT_FOUND');
assert.equal((await one('SELECT public.get_film_library_master($1,$2) result',['owner',master])).result.ok,true);
assert.equal((await one('SELECT count(*)::int n FROM public.jobs')).n,2);assert.equal((await one('SELECT count(*)::int n FROM public.assets')).n,2);
assert.equal((await one('SELECT sum(delta)::int total FROM public.ledger_entries')).total,0);assert.equal((await one('SELECT balance FROM public.credit_balances')).balance,0);
assert.equal((await one('SELECT expires_at=(SELECT expires_at FROM public.assets WHERE job_id=$1) aligned FROM public.film_library_masters',[source])).aligned,true);
for(const role of ['anon','authenticated','service_role']){
 await db.exec(`SET ROLE ${role}`);let rejected=false;
 try{await db.query('SELECT * FROM public.film_library_masters');}catch{rejected=true;}assert.equal(rejected,true,`${role} table access`);
 if(role!=='service_role'){rejected=false;try{await db.query('SELECT public.list_film_library_masters($1)',['owner']);}catch{rejected=true;}assert.equal(rejected,true,`${role} RPC access`);}
 else{assert.equal((await one('SELECT public.list_film_library_masters($1) result',['owner'])).result.masters.length,1);}
 await db.exec('RESET ROLE');
}
await db.exec(`UPDATE public.film_library_masters SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day'`);
assert.equal((await one('SELECT public.get_film_library_master($1,$2) result',['owner',master])).result.code,'NOT_FOUND');
assert.equal((await one('SELECT public.expire_film_library_masters(100) n')).n,1);
assert.equal((await one('SELECT count(*)::int n FROM public.asset_reap_queue')).n,1);
assert.equal((await one('SELECT public.expire_film_library_masters(100) n')).n,0);
assert.equal((await one('SELECT schedule FROM cron.calls')).schedule,'*/15 * * * *');
const output={verified:true,runtime:'PGlite',checks:['migration replay','owner/source/digest validation','zero Credits accepted without ledger mutation','idempotent replay keeps label and object id','size/duration/hash/label bounds','owner isolation','private table and RPC privileges','source-aligned retention','expired link refusal','reap queue and expiry replay','15-minute cron scheduling'],note:'cron.schedule is a local recording stub; PostgreSQL function bodies and table constraints are executed unchanged.'};
if(process.env.FILM_LIBRARY_REPORT_PATH) writeFileSync(process.env.FILM_LIBRARY_REPORT_PATH,JSON.stringify(output,null,2));console.log(JSON.stringify(output));await db.close();
