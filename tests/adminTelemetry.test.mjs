import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createTelemetry,telemetryDimensions,telemetryPattern,refreshTelemetryControl } from '../lib/telemetry.js';
import { createRuntimeSwitchCache } from '../lib/runtimeSwitchCache.js';
import { prepareRuntimeAdmission } from '../lib/runtimeAdmission.js';
const request=(path='/',headers={})=>new Request('https://veyrnox.ai'+path,{headers});
const response=()=>new Response('',{headers:{'content-type':'text/html'}});
test('disabled telemetry is one cached read with no clock, parsing, network or waitUntil',()=>{
 let reads=0;const fail=()=>assert.fail('disabled collector did work');
 const c=createTelemetry({enabled:()=>{reads++;return false;},send:fail,now:fail});
 const started=c.start();c.finish(null,null,started,{waitUntil:fail});assert.equal(reads,1);assert.equal(started,null);
});
test('telemetry control and admission share one TTL refresh and waitUntil catches rejection',async()=>{
 let time=0,reads=0,resolve;const waits=[],ctx={waitUntil:p=>waits.push(p)};
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
 const cache=createRuntimeSwitchCache({now:()=>time,read:()=>{reads++;return new Promise(r=>resolve=r);}});
 const req=new Request('https://test/api/v1/generations',{method:'POST'});
 refreshTelemetryControl(env,ctx,cache.refreshIfDue);
 const pending=prepareRuntimeAdmission(req,env,ctx,cache.refresh);
 await Promise.resolve();assert.equal(reads,1);resolve([{key:'generation',state:'off'}]);await pending;await Promise.all(waits);
 assert.equal(cache.cachedKilled('generation'),true);
 const scheduled=waits.length;
 time=14999;refreshTelemetryControl(env,ctx,cache.refreshIfDue);assert.equal(waits.length,scheduled,'fresh cache schedules no waitUntil promise');
 await prepareRuntimeAdmission(req,env,ctx,cache.refresh);assert.equal(reads,1,'fresh shared cache skips the DB read');
 time=15000;refreshTelemetryControl(env,ctx,cache.refreshIfDue);
 const next=prepareRuntimeAdmission(req,env,ctx,cache.refresh);
 await Promise.resolve();assert.equal(reads,2);resolve([]);await next;
 refreshTelemetryControl(env,ctx,()=>Promise.reject(Error('control refresh rejected')));
 await Promise.all(waits); // waitUntil receives a fulfilled promise, not an unhandled rejection.
});
test('telemetry control does not schedule the resolved refresh on failure back-off',async()=>{
 let reads=0;const waits=[],ctx={waitUntil:p=>waits.push(p)};
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
 const cache=createRuntimeSwitchCache({now:()=>0,read:async()=>{reads++;throw Error('down');},log:()=>{}});
 refreshTelemetryControl(env,ctx,cache.refreshIfDue);await Promise.all(waits);
 assert.equal(waits.length,1);assert.equal(reads,1);
 refreshTelemetryControl(env,ctx,cache.refreshIfDue);
 assert.equal(waits.length,1);assert.equal(reads,1);
 assert.equal(typeof cache.refresh().then,'function','cron callers still receive a promise');
});
test('Worker returns the finished response unchanged if either telemetry callback throws',async()=>{
 const source=await readFile(new URL('../worker.js',import.meta.url),'utf8');
 const start=source.indexOf('        try {',source.indexOf('const response = bounded.response'));
 const tail=source.slice(start,source.indexOf('\n    },',start));
 assert.ok(start>0);assert.ok(tail.includes('finishTelemetry(')&&tail.includes('refreshTelemetryControl('));
 const finish=new Function('finishTelemetry','refreshTelemetryControl','request','response','telemetryStarted','ctx','env','stripTechnologyHeaders','console',tail);
 for(const which of ['finish','refresh']) {
  const original=new Response('finished body',{status:202,headers:{'x-proof':'unchanged'}}),logs=[];
  const fail=()=>{throw Error('private telemetry detail');};
  const result=finish(which==='finish'?fail:()=>{},which==='refresh'?fail:()=>{},request(),original,0,{}, {},r=>r,{error:s=>logs.push(s)});
  assert.equal(result,original);assert.equal(result.status,202);assert.equal(result.headers.get('x-proof'),'unchanged');assert.equal(await result.text(),'finished body');
  assert.deepEqual(logs,['[telemetry] response instrumentation failed']);
 }
});
test('normalization discards user IDs, queries, arbitrary referrers, IP and raw UA',()=>{
 assert.equal(telemetryPattern('/api/v1/chat/threads/secret/messages'),'/api/v1/chat/threads/:id/messages');
 assert.equal(telemetryPattern('/api/v1/not-a-real-route/private'),'other');
 assert.equal(telemetryPattern('/api/v1/developer/models'),'/api/v1/developer/:id*');
 const d=telemetryDimensions(request('/unknown/private?email=secret@example.test',{'referer':'https://alice.private.test/path?secret=1','cf-ipcountry':'GB','user-agent':'iphone alice','x-forwarded-for':'1.2.3.4'}));
 assert.deepEqual(d,{path:'other',country:'GB',device:'mobile',referrer_host:'other'});
});
test('flush uses waitUntil, at most once per minute, caps keys, aggregates and swallows one failed batch',async()=>{
 let now=1800000000000,enabled=true,logs=0,sends=[];const waits=[];
 const c=createTelemetry({enabled:()=>enabled,now:()=>now,send:async b=>{sends.push(b);},log:()=>logs++});const ctx={waitUntil:p=>waits.push(p)};
 c.finish(request(),response(),c.start(),ctx);assert.equal(sends.length,0,'send is deferred');await Promise.all(waits);assert.equal(sends.length,1);
 for(let i=0;i<700;i++){now++;const country=String.fromCharCode(65+Math.floor(i/26)%26)+String.fromCharCode(65+i%26);c.finish(request('/',{'cf-ipcountry':country}),response(),c.start(),ctx);}
 assert.equal(waits.length,1);now+=60000;c.finish(request(),response(),c.start(),ctx);await Promise.all(waits);assert.ok(sends[1].length<=500);
 assert.ok(sends[1].some(r=>r.path_pattern==='other'));assert.equal(sends[1].filter(r=>r.kind==='traffic').reduce((n,r)=>n+r.views,0),701);
 enabled=false;const count=sends.length;c.finish(request(),response(),c.start(),ctx);assert.equal(sends.length,count);assert.equal(logs,0);
 const failing=createTelemetry({enabled:()=>true,send:async()=>{throw Error('secret');},now:()=>now,log:()=>logs++});failing.finish(request(),response(),failing.start(),ctx);await Promise.all(waits);assert.equal(logs,1);
});
test('prefetch, RSC and failed page responses do not become page views',async()=>{
 for(const headers of [{'rsc':'1'},{'next-router-prefetch':'1'}]) {
  const batches=[],waits=[];const c=createTelemetry({enabled:()=>true,send:async b=>batches.push(b)});c.finish(request('/',headers),response(),c.start(),{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.ok(batches[0].every(r=>r.kind==='route'));
 }
});
test('SQL and code allowlists agree for all inventory patterns; telemetry has no user FK',async()=>{
 const sql=await readFile(new URL('../packages/db/schema/supabase/0431_admin_telemetry.sql',import.meta.url),'utf8');
 const inventory=JSON.parse(await readFile(new URL('../lib/adminRouteInventory.json',import.meta.url),'utf8'));
 const expected=[...new Set([...inventory.map(r=>r.path.replace(/:[A-Za-z0-9_]+/g,':id')).filter(p=>p!=='/api/v1/:id*'),'other'])].sort();
 const replacement=await readFile(new URL('../packages/db/schema/supabase/0455_best_cut.sql',import.meta.url),'utf8');
 const names=(await readdir(new URL('../packages/db/schema/supabase/',import.meta.url))).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&n>'0455').sort();
 const base=replacement.match(/SELECT p_path = ANY \(ARRAY\[([^\]]+)\]::text\[\]\)/)[1].split(',').map(p=>p.slice(1,-1));
 const added=[];
 for(const name of names){const m=(await readFile(new URL('../packages/db/schema/supabase/'+name,import.meta.url),'utf8')).match(/SELECT (p_path (?:= '[^']+'|IN \([^)]+\)))\s+OR public\.telemetry_path_allowed_pre_\d{4}\(p_path\)/);if(m)added.push(...[...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]));}
 assert.ok(added.includes('/app/music/instruments'),'route migrations must extend the prior telemetry allowlist');
 const actual=[...new Set([...base,...added])].sort();
 assert.deepEqual(actual,expected,'update SQL patterns with inventory; the generic 404 catch-all never emits');
 assert.doesNotMatch(sql,/REFERENCES (?:public\.)?users|user_id|user_agent|ip_address/);
});

test('Traffic and Endpoints label sums of retained cells without weakening suppression',async()=>{
 for(const [page,unit]of [['traffic','views'],['endpoints','calls']]) {
  const source=await readFile(new URL('../app/veyrnox/app/admin/'+page+'/page.js',import.meta.url),'utf8');
  assert.ok(source.includes('cells with at least 5 '+unit));
  assert.ok(source.includes('small cells hidden for privacy'));assert.ok(source.includes('totals undercount'));
  assert.ok(source.includes('cells with 5+ '+unit));
 }
});

test('unknown HTML page responses collapse to other without retaining the path',async()=>{
 const batches=[],waits=[];const c=createTelemetry({enabled:()=>true,send:async b=>batches.push(b)});
 c.finish(request('/unknown/alice?email=private'),response(),c.start(),{waitUntil:p=>waits.push(p)});await Promise.all(waits);
 assert.ok(batches[0].some(r=>r.kind==='traffic'&&r.path_pattern==='other'));assert.ok(!JSON.stringify(batches).includes('alice'));
});

test('observing telemetry off drops buffered counts before a later re-enable',async()=>{
 let enabled=true,time=1800000000000;const batches=[],waits=[];
 const c=createTelemetry({enabled:()=>enabled,now:()=>time,send:async b=>batches.push(b)}),ctx={waitUntil:p=>waits.push(p)};
 c.finish(request('/about'),response(),c.start(),ctx);await Promise.all(waits);
 time++;c.finish(request('/pricing'),response(),c.start(),ctx); // Buffered inside the minute.
 enabled=false;assert.equal(c.start(),null);
 enabled=true;time+=60000;c.finish(request('/models'),response(),c.start(),ctx);await Promise.all(waits);
 assert.equal(batches.length,2);assert.ok(batches[1].every(r=>(r.path_pattern||r.route_pattern)==='/models'));
 // A change while a handler is running also discards the older buffer.
 time++;c.finish(request('/pricing'),response(),c.start(),ctx);const started=c.start();enabled=false;
 c.finish(null,null,started,ctx);
 enabled=true;time+=60000;c.finish(request('/about'),response(),c.start(),ctx);await Promise.all(waits);
 assert.ok(batches[2].every(r=>(r.path_pattern||r.route_pattern)==='/about'));
});

test('off invalidates a queued batch even if re-enabled before its microtask runs',async()=>{
 let enabled=true;const waits=[];
 const c=createTelemetry({enabled:()=>enabled,send:()=>assert.fail('pre-disable batch must be discarded')});
 c.finish(request(),response(),c.start(),{waitUntil:p=>waits.push(p)});
 enabled=false;assert.equal(c.start(),null);enabled=true;
 await Promise.all(waits);
});
