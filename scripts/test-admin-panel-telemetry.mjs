// Host-run against an isolated fully migrated local database; rollback all data.
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
async function person(role){const auth=randomUUID();await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,auth+'@example.invalid']);const u=await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id',[auth,!!role]);if(role)await q('INSERT INTO public.admin_roles(user_id,role) VALUES($1,$2)',[u.id,role]);return{...u,auth};}
async function refuses(fn,code){await q('SAVEPOINT refused');try{await assert.rejects(fn,e=>e.code===code);}finally{await q('ROLLBACK TO SAVEPOINT refused');}}
try {
 await q('BEGIN');const migration=await readFile(new URL('../packages/db/schema/supabase/0431_admin_telemetry.sql',import.meta.url),'utf8');await q(migration);await q(migration);
 const owner=await person('owner'),ordinary=await person(),finance=await person('finance');
 for(const u of [ordinary,finance]){await refuses(()=>call('admin_traffic_summary',[u.auth,30]),'42501');await refuses(()=>call('admin_endpoint_usage',[u.auth]),'42501');}
 for(const days of [0,91,null])await refuses(()=>call('admin_traffic_summary',[owner.auth,days]),'22023');
 await q("DELETE FROM public.runtime_switches WHERE key='telemetry'");
 assert.equal((await call('telemetry_ingest',['[]'])).accepted,0);
 assert.equal((await call('admin_traffic_summary',[owner.auth,30])).telemetry,false);
 await q("INSERT INTO public.runtime_switches(key,state,reason,updated_by) VALUES('telemetry','on','Local proof',$1)",[owner.id]);
 const hour=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
 const traffic={kind:'traffic',hour,path_pattern:'/',country:'GB',device:'desktop',referrer_host:'direct',views:2};
 const route={kind:'route',hour,route_pattern:'/api/v1/admin/traffic',method:'GET',status_class:'2xx',calls:3,latency_ms_sum:15,latency_ms_max:8};
 for(const batch of [Array(501).fill(traffic),[{...traffic,ip:'1.2.3.4'}],[{...traffic,path_pattern:null}],[{...route,route_pattern:12}],[{...traffic,path_pattern:'x'.repeat(513)}],[{...traffic,views:1.5}],[{...traffic,referrer_host:'alice.example.com'}],[{...route,calls:null}],[{...route,latency_ms_max:60001}]])await refuses(()=>call('telemetry_ingest',[JSON.stringify(batch)]),'22023');
 assert.equal((await call('telemetry_ingest',[JSON.stringify([traffic,route])])).accepted,2);
 assert.equal((await call('telemetry_ingest',[JSON.stringify([traffic])])).accepted,1);
 assert.deepEqual((await call('admin_traffic_summary',[owner.auth,30])).paths,[],'four-view hourly tuple is suppressed');
 assert.deepEqual((await call('admin_endpoint_usage',[owner.auth])).usage,[],'three-call hourly tuple is suppressed');
 // Deploy skew must not discard the known rows sharing an unknown-pattern batch.
 assert.equal((await call('telemetry_ingest',[JSON.stringify([traffic,route,{...traffic,path_pattern:'/future/private-path'},{...route,route_pattern:'/api/future/private-path'}])])).accepted,4);
 const paths=(await call('admin_traffic_summary',[owner.auth,30])).paths;
 assert.equal(paths.find(r=>r.path_pattern==='/').views,6);assert.ok(!paths.some(r=>r.path_pattern==='other'));
 assert.equal((await one("SELECT views FROM public.traffic_hourly WHERE path_pattern='other'")).views,2,'unknown row retained safely despite report suppression');
 const usage=(await call('admin_endpoint_usage',[owner.auth])).usage;
 assert.equal(usage.find(r=>r.route_pattern===route.route_pattern).calls,6);assert.ok(!usage.some(r=>r.route_pattern==='other'));
 assert.equal((await one("SELECT calls FROM public.route_usage_hourly WHERE route_pattern='other'")).calls,3);
 assert.ok(!JSON.stringify([paths,usage]).includes('private-path'));
 const rare={...traffic,path_pattern:'/about',country:'FR',device:'tablet',referrer_host:'bing.com',views:4};
 await call('telemetry_ingest',[JSON.stringify([rare])]);
 let report=await call('admin_traffic_summary',[owner.auth,30]);
 for(const [key,field,value]of [['paths','path_pattern','/about'],['countries','country','FR'],['devices','device','tablet'],['referrers','referrer_host','bing.com']])assert.ok(!report[key].some(r=>r[field]===value));
 assert.equal(report.days.reduce((n,r)=>n+r.views,0),6,'daily totals use the same suppression');
 await call('telemetry_ingest',[JSON.stringify([{...rare,views:1}])]);
 report=await call('admin_traffic_summary',[owner.auth,30]);assert.equal(report.paths.find(r=>r.path_pattern==='/about').views,5,'threshold is inclusive');
 await q("INSERT INTO public.traffic_hourly VALUES(now()-interval '91 days','other','ZZ','other','other',1)");await call('telemetry_ingest',['[]']);
 assert.equal((await one("SELECT count(*)::int n FROM public.traffic_hourly WHERE hour<now()-interval '90 days'")).n,0);
 for(const table of ['traffic_hourly','route_usage_hourly']) {
  assert.deepEqual(await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+table]),{relrowsecurity:true,relforcerowsecurity:true});
  for(const role of ['anon','authenticated','service_role'])assert.equal((await one('SELECT has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') AS allowed',[role,'public.'+table])).allowed,false);
  const columns=await q('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1',[table]);assert.ok(columns.every(r=>!/(ip|user_id|cookie|url|agent)/.test(r.column_name)));
 }
 await q(migration);await q(migration);
 for(const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits'])assert.deepEqual(await q('SELECT * FROM public.'+fn+'()'),[]);
 console.log('S5 telemetry: bounds, privacy shape, permissions, aggregation, retention, RLS and replay passed');
}finally{await q('ROLLBACK');await c.end();}
