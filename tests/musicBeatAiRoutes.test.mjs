import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote={ok:true,quote_id:uuid(1),total_credits:37,unit_credits:18,balance:100,balance_after:63,affordable:true};
let held=false,signs=0;const calls=[];
globalThis.beatAiRouteFixture={
  rpc:async(name,args)=>{calls.push({name,args});if(name==='music_get_custom_draft')return {ok:true,draft:{id:uuid(6),revision:1,styles:'Warm keys',lyrics:''}};return /context$/.test(name)?held?{ok:false,code:'HELD'}:{ok:true,r2_key:'source',mime_type:'audio/mpeg',song_id:uuid(2)}:quote;},
  select:async(table)=>table==='model_catalog'?[{
    id:'ace-step-1.5',name:'ACE-Step 1.5',modality:'audio',credits_5s:3,gated_flag:false,
    provider:'fal',provider_endpoint:'fal-ai/ace-step-1.5',updated_at:'2026-11-22T12:00:00Z',
  }]:[],
  envConfig:()=>({supabaseUrl:'https://fixture.invalid',serviceRoleKey:'fixture'}),
  r2Env:()=>({}),isConfigured:()=>true,
  presignGetUrl:async()=>{signs++;return {url:'https://fixture.invalid/audio',expires:300};},
  inspectStoredSource:async()=>({ok:true,seconds:10,url:'https://fixture.invalid/audio'}),
};
const hooks=registerHooks({load(url,context,next){
  if(url.endsWith('/packages/db/supabase-client.js'))return {format:'module',shortCircuit:true,source:'export const { rpc, select, envConfig } = globalThis.beatAiRouteFixture;'};
  if(url.endsWith('/packages/adapters/r2.js'))return {format:'module',shortCircuit:true,source:'export const { r2Env: envConfig, isConfigured, presignGetUrl } = globalThis.beatAiRouteFixture;'};
  if(url.endsWith('/lib/resolveSource.js'))return {format:'module',shortCircuit:true,source:'export const { inspectStoredSource } = globalThis.beatAiRouteFixture;'};
  return next(url,context);
}});
Object.assign(process.env,{MUSIC_RUNTIME_FLAGS:JSON.stringify({schema:true,generation:true,dispatch:true,ui:true,beatEditor:true,beatAi:true,library:true,stems:true,targetStems:true,extend:true,replace:true})});
const routes=[];
for(const [op,path,body] of [
 ['generate','generation-quotes',{mode:'simple',model_id:'ace-step-loop',prompt:'Keys',bpm:120,key_scale:'C Major',time_signature:'4',duration_seconds:10}],
 ['stems',`songs/[id]/stem-quotes`,{version_id:uuid(3),rights_confirmed:true}],
 ['target',`songs/[id]/target-stem-quotes`,{version_id:uuid(3),rights_confirmed:true,instrument:'drums'}],
 ['extend',`songs/[id]/extend-quotes`,{version_id:uuid(3),rights_confirmed:true,prompt:'Keys'}],
 ['replace',`songs/[id]/replace-quotes`,{version_id:uuid(3),rights_confirmed:true,prompt:'Keys',start_seconds:1,end_seconds:3}],
])routes.push({op,body,POST:(await import(`../app/api/v1/music/${path}/route.js`)).POST});
const downloads=[(await import('../app/api/v1/music/stem-requests/[id]/archive/route.js')).GET,(await import('../app/api/v1/music/target-stem-requests/[id]/[kind]/route.js')).GET];
hooks.deregister();
const request=body=>new Request('https://fixture.invalid/api/v1/music',{method:body?'POST':'GET',headers:{'x-veyrnox-auth-id':uuid(4),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
for(const {op,body,POST} of routes)test(`${op} quote copies exact SQL total and balance without client arithmetic`,async()=>{
 held=false;calls.length=0;const response=await POST(request(body),{params:Promise.resolve({id:uuid(2)})});
 assert.equal(response.status,201);const result=await response.json();assert.equal(result.total_credits,37);assert.equal(result.balance_after,63);
 assert.ok(calls.some(c=>/create.*quote/.test(c.name)));
});
test('held archives and targets return 404 held without signing',async()=>{
 held=true;signs=0;for(const GET of downloads){const response=await GET(request(),{params:Promise.resolve({id:uuid(1),kind:'target'})});assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'held'});}assert.equal(signs,0);
});
test('all paid source quotes refuse held context with 409 source_held before a quote',async()=>{
 held=true;for(const {op,body,POST} of routes.filter(r=>r.op!=='generate')){calls.length=0;const response=await POST(request(body),{params:Promise.resolve({id:uuid(2)})});assert.equal(response.status,409,op);assert.deepEqual(await response.json(),{error:'source_held'});assert.equal(calls.length,1);}
});

test('valid custom mode follows the dedicated custom RPC and cannot select the loop model', async () => {
  held = false; calls.length = 0;
  const body = { mode: 'custom', draft_revision: 1, instrumental: true, rights_confirmed: false, duration_seconds: 10 };
  const { POST } = routes[0];
  const response = await POST(request(body));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.deepEqual(calls.map(c => c.name), ['music_get_custom_draft', 'music_create_custom_quote']);
  assert.equal(Object.hasOwn(calls[1].args, 'p_model_id'), false, 'custom RPC takes no model selection');
  calls.length = 0;
  assert.equal((await POST(request({ ...body, model_id: 'ace-step-loop' }))).status, 400);
  assert.deepEqual(calls, [], 'model selection cannot reach any RPC through custom mode');
});
