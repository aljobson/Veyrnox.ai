import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import { createRuntimeSwitchCache, isFeatureKilled } from '../lib/runtimeSwitchCache.js';
import { cinemaRuntimeGate, CINEMA_ADMISSIONS, admitPublishTarget, prepareRuntimeAdmission } from '../lib/runtimeAdmission.js';
import { RUNTIME_SWITCHES } from '../lib/runtimeSwitches.js';
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}"));

test('cold admission reads are silent no-ops with no network request', t => {
  t.mock.method(globalThis,'fetch',()=>assert.fail('admission must not initiate refresh'));
  t.mock.method(console,'error',()=>assert.fail('a cold cache is not a request failure'));
  for(const key of ['generation','chat','publish','cinema']) assert.equal(isFeatureKilled(key),false);
});
test('Worker refresh covers generation, developer, MCP, chat and Cinema admissions, never settlement', async () => {
  const waits=[],ctx={waitUntil:p=>waits.push(p)};
  const calls=[],refresh=async cfg=>calls.push(cfg),env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
  const admissions=['/api/v1/generations','/api/v1/developer/generations','/api/v1/mcp','/api/v1/chat/threads/id/messages',...CINEMA_ADMISSIONS.map(p=>'/api/v1/cinema/'+p)];
  for(const path of admissions) await prepareRuntimeAdmission(new Request('https://test'+path,{method:'POST'}),env,ctx,refresh);
  await Promise.all(waits);
  assert.equal(calls.length,admissions.length);assert.deepEqual(calls[0],{supabaseUrl:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});
  for(const path of ['/api/webhook/stripe','/api/v1/chat/threads/id/close-send','/api/v1/cinema/play/heartbeat','/api/v1/cinema/pass/cancel','/api/v1/cinema/uploads/id/transfer','/api/v1/admin/switches']) {
    await prepareRuntimeAdmission(new Request('https://test'+path,{method:'POST'}),env,ctx,()=>assert.fail('settlement/admin paths never refresh the feature cache'));
  }
  await prepareRuntimeAdmission(new Request('https://test/api/v1/generations'),env,ctx,()=>assert.fail('GET does not admit work'));
});
test('cold kill refresh precedes evaluation; fresh admission resolves without another read', async () => {
  let calls=0;const cache=createRuntimeSwitchCache({read:async()=>{calls++;return [{key:'generation',state:'off'},{key:'cinema',state:'off'}];}});
  const req=new Request('https://test/api/v1/generations',{method:'POST'});
  const pending=prepareRuntimeAdmission(req,{},null,cache.refresh);assert.ok(pending instanceof Promise);
  await pending;assert.equal(cache.cachedKilled('generation'),true);
  const fresh=prepareRuntimeAdmission(req,{},null,cache.refresh);assert.equal(typeof fresh.then,'function');await fresh;assert.equal(calls,1);
  assert.equal((await cinemaRuntimeGate(new Request('https://test/api/v1/cinema/play',{method:'POST'}),{},cache.cachedKilled)).status,503);
});
test('hung read is bounded to 400ms once per back-off and shares the control refresh', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let calls=0,time=0;
  const cache=createRuntimeSwitchCache({now:()=>time,read:()=>{calls++;return new Promise(()=>{});},log:()=>{}});
  const req=new Request('https://test/api/v1/generations',{method:'POST'});
  const pending=prepareRuntimeAdmission(req,{},null,cache.refresh);
  assert.equal(cache.refresh(),pending,'control plane shares the exact in-flight refresh');
  await Promise.resolve();let done=false;pending.then(()=>{done=true;});
  t.mock.timers.tick(399);await Promise.resolve();assert.equal(done,false);
  t.mock.timers.tick(1);await pending;assert.equal(cache.cachedKilled('generation'),false);assert.equal(calls,1);
  time=4999;const fresh=prepareRuntimeAdmission(req,{},null,cache.refresh);assert.equal(typeof fresh.then,'function');await fresh;assert.equal(calls,1);
  time=5000;const retry=cache.refresh();await Promise.resolve();t.mock.timers.tick(400);await retry;assert.equal(calls,2);
});
test('cache shares a fetch, uses 15s TTL, retains paused kills on error and throttles errors for 5s', async () => {
  let time=0,calls=0,logs=0,finish,fail=false;
  const cache=createRuntimeSwitchCache({now:()=>time,log:()=>logs++,read:()=>{calls++;if(fail)throw Error('down');return new Promise(r=>finish=r);}});
  const a=cache.isKilled('generation'), b=cache.isKilled('chat');await Promise.resolve();assert.equal(calls,1);
  finish([{key:'generation',state:'off'},{key:'telemetry',state:'on'}]);assert.equal(await a,true);assert.equal(await b,false);
  assert.equal(cache.cachedEnabled('telemetry'),true);
  time=14999;assert.equal(await cache.isKilled('generation'),true);assert.equal(calls,1);
  time=15000;fail=true;assert.equal(await cache.isKilled('generation'),true);assert.equal(calls,2);assert.equal(logs,1);
  time=19999;assert.equal(await cache.isKilled('generation'),true);assert.equal(calls,2);
  time=20000;fail=false;const recovered=cache.isKilled('generation');await Promise.resolve();finish([]);assert.equal(await recovered,false);assert.equal(cache.cachedEnabled('telemetry'),false);
});
test('refresh always returns a thenable on cold, shared, fresh, expired and back-off paths', async () => {
  let time=0,fail=false;
  const cache=createRuntimeSwitchCache({now:()=>time,read:async()=>{if(fail)throw Error('down');return [];},log:()=>{}});
  const thenable=p=>{assert.equal(typeof p?.then,'function');return p;};
  const cold=thenable(cache.refresh());assert.equal(thenable(cache.refresh()),cold);await cold;
  await thenable(cache.refresh());
  time=15000;fail=true;await thenable(cache.refresh());
  time=15001;await thenable(cache.refresh());
});
test('a loaded pause survives a hung refresh and the five-second back-off', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let time=0,hung=false,reads=0;
  const cache=createRuntimeSwitchCache({now:()=>time,read:()=>{reads++;return hung?new Promise(()=>{}):Promise.resolve([{key:'generation',state:'off'},{key:'publish',state:'off'}]);},log:()=>{}});
  await cache.refresh();hung=true;time=15000;
  const pending=cache.refresh();await Promise.resolve();t.mock.timers.tick(400);await pending;
  assert.equal(cache.cachedKilled('generation'),true);assert.equal(cache.cachedKilled('publish'),true);
  time=19999;await cache.refresh();assert.equal(reads,2);assert.equal(cache.cachedKilled('generation'),true);
});
test('cold failure opens kill gates, keeps enable gates off, and rejects unknown keys', async () => {
  let calls=0,time=0;
  const cache=createRuntimeSwitchCache({now:()=>time,log:()=>{},read:()=>{calls++;throw Error('down');}});
  assert.equal(await cache.isKilled('generation'),false);assert.equal(await cache.isKilled('cinema'),false);assert.equal(calls,1);
  assert.equal(cache.cachedEnabled('support_intake'),false);
  time=5000;assert.equal(await cache.isKilled('chat'),false);assert.equal(calls,2);
  await assert.rejects(()=>cache.isKilled('unknown'));
});
test('Cinema pauses admissions with a typed 503 and leaves settlement, reads and cancellation alone', async () => {
  const killed=async key=>{assert.equal(key,'cinema');return true;};
  for(const path of CINEMA_ADMISSIONS) {
    const res=await cinemaRuntimeGate(new Request('https://test/api/v1/cinema/'+path,{method:'POST'}),{},killed);
    assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'feature_paused'});assert.equal(res.headers.get('cache-control'),'no-store');
  }
  for(const path of ['play/heartbeat','uploads/id/transfer','uploads/refresh','pass/cancel','pass/return','content/withdraw']) {
    assert.equal(await cinemaRuntimeGate(new Request('https://test/api/v1/cinema/'+path,{method:'POST'}),{},()=>assert.fail('settlement must not consult kill switch')),null);
  }
  assert.equal(await cinemaRuntimeGate(new Request('https://test/api/v1/cinema/play'),{},killed),null);
  assert.equal(await cinemaRuntimeGate(new Request('https://test/api/webhook/revenuecat',{method:'POST'}),{},killed),null);
});
test('publishing restores a fresh claim, never consumes a retry, and lets checkpoints settle', async () => {
  const calls=[];const deps={killed:async()=>true,call:async(name,args)=>{calls.push({name,args});return {ok:true};}};
  assert.deepEqual(await admitPublishTarget({target_id:'target',claim_key:'claim',provider_state:{}},{},deps),{error:'feature_paused',status:503});
  assert.deepEqual(calls,[{name:'runtime_defer_publish',args:{p_target_id:'target',p_claim_key:'claim'}}]);
  for(const state of [{submission_started:true},{container_id:'id'},{phase:'processing'},{publish_id:'id'},{result:{id:'id'}}]) {
    assert.equal(await admitPublishTarget({provider_state:state},{},{killed:()=>assert.fail('in-flight must not be paused')}),null);
  }
});
test('generation and chat pause before any debit or provider call', async t => {
  const env={SUPABASE_URL:'https://db.runtime.test',SUPABASE_SERVICE_ROLE_KEY:'test',PUBLIC_HOST:'test',OPENROUTER_API_KEY:'test'};
  const prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  t.after(()=>{for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));if(String(url).includes('/users?'))return Response.json([]);assert.match(String(url),/\/rest\/v1\/runtime_switches\?/);return Response.json([{key:'generation',state:'off'},{key:'chat',state:'off'}]);});
  const waits=[];prepareRuntimeAdmission(new Request('https://test/api/v1/generations',{method:'POST'}),env,{waitUntil:p=>waits.push(p)});
  await Promise.all(waits);
  // Simulate a second bundled copy as used by OpenNext: isolate state is shared.
  const separatelyLoaded=await import('../lib/runtimeSwitchCache.js?handler-copy');
  assert.equal(separatelyLoaded.isFeatureKilled('generation'),true);
  const {POST}=await import('../app/api/v1/generations/route.js');
  const response=await POST(new Request('https://test/api/v1/generations',{method:'POST',headers:{'x-veyrnox-auth-id':'test'},body:JSON.stringify({model_id:'test',idempotency_key:'runtime-test-001',inputs:{prompt:'Hello'}})}));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'feature_paused'});
  const {runChatTurn}=await import('../lib/chatTurn.js');
  const chat=await runChatTurn({authId:'test',threadId:'11111111-1111-4111-8111-111111111111',body:{text:'Hello',idempotency_key:'runtime-test-0001'},cfg:{supabaseUrl:env.SUPABASE_URL,serviceRoleKey:'test'},env:{OPENROUTER_API_KEY:'test'},deps:{rpc:()=>assert.fail('no debit or admission RPC')}});
  assert.equal(chat.status,503);assert.deepEqual(await chat.json(),{error:'feature_paused'});assert.equal(calls.length,3);
});
test('registry agrees with SQL key constraint, and other wrangler bindings are unchanged', async () => {
  const sql=await readFile(new URL('../packages/db/schema/supabase/0429_runtime_switches.sql',import.meta.url),'utf8');
  const keys=sql.match(/CHECK \(key IN \(([^)]+)\)\)/)[1].split(',').map(s=>s.trim().replaceAll("'",''));
  assert.deepEqual(keys,Object.keys(RUNTIME_SWITCHES));
  const previous=execFileSync('git',['show','HEAD:wrangler.jsonc'],{encoding:'utf8'});
  // MC-R1 explicitly adds this default-off admission gate. Keep the byte-for-byte
  // assertion for every other binding, rather than discarding the config guard.
  const allowance='    "FREE_ALLOWANCE_ENABLED": "true",\n';
  const rollout='    // ADR-0069: do not enable while FAL_DURABLE_DISPATCH_ENABLED is true in production until PR B capped durable admission exists.\n    "MAX_CHARGE_ENABLED": "false",\n';
  let expected=previous.includes('"MAX_CHARGE_ENABLED"') ? previous : previous.replace(allowance,allowance+rollout);
  // ADR-0335: reviewed Worker-first vision admission; all other bytes stay pinned.
  expected=expected.replace(
    '    // answers them (lib/showcaseVideo.js). Everything else stays edge-served:',
    '    // answers them (lib/showcaseVideo.js). ADR-0335 also admits the two pinned\n    // vision prefixes here before ASSETS.fetch for gates/CSP. Other assets stay edge-served:',
  ).replace('"run_worker_first": ["/showcase/*.mp4"]','"run_worker_first": ["/showcase/*.mp4", "/editor-vision/*"]');
  assert.equal(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'),expected);
});
test('switch route requires owner permission, an exact registry key and trusted freshness', async t => {
  const {POST}=await import('../app/api/v1/admin/switches/route.js');
  const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',ADMIN_REQUIRE_AAL2:'true',ACCESS_TEAM_DOMAIN:'',ACCESS_AUD:''};
  const prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  t.after(()=>{for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const now=Math.floor(Date.now()/1000),calls=[];let permissions=['switches.write'];
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json(String(url).endsWith('/admin_permissions')?{ok:true,permissions}:{ok:true});});
  const headers={'x-veyrnox-auth-id':'11111111-1111-4111-8111-111111111111','x-veyrnox-auth-aal':'aal2','x-veyrnox-auth-mfa-at':String(now),'idempotency-key':'switch-test-001','content-type':'application/json'};
  const body={key:'generation',state:'off',reason:'Pause submissions'};
  const req=(b=body,h=headers)=>new Request('https://test/api/v1/admin/switches',{method:'POST',headers:h,body:JSON.stringify(b)});
  for(const b of [{...body,key:'unknown'},{...body,key:'__proto__'},{...body,state:'enabled'},{...body,p_mfa_at:new Date().toISOString()}]) assert.equal((await POST(req(b))).status,400);
  assert.equal((await POST(req(body,{...headers,'x-veyrnox-auth-mfa-at':'invalid'}))).status,403);
  assert.equal((await POST(req(body,{...headers,'idempotency-key':''}))).status,400);assert.equal(calls.length,0);
  permissions=['plans.read'];assert.equal((await POST(req())).status,403);assert.equal(calls.length,1);
  permissions=['switches.write'];const res=await POST(req());assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  assert.deepEqual(calls.at(-1).body,{p_auth_id:headers['x-veyrnox-auth-id'],p_key:'generation',p_state:'off',p_reason:'Pause submissions',p_idem_key:'switch-test-001',p_aal:'aal2',p_mfa_at:new Date(now*1000).toISOString()});
});
