import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { lipSyncMp4 } from './fixtures/lipSyncMp4.mjs';
import { toPublicModels } from '../lib/publicCatalog.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
 R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
 CRUN_ENABLED: 'true', CRUN_API_KEY: 'test', APP_RUNTIME_FLAGS: '{"seedance25":true}', FREE_ALLOWANCE_ENABLED: 'false' });
const { POST } = await import('../app/api/v1/generations/route.js');
const { POST: QUOTE } = await import('../app/api/v1/generations/quote/route.js');
const AUTH='11111111-1111-4111-8111-111111111111', JOB='22222222-2222-4222-8222-222222222222', ASSET='33333333-3333-4333-8333-333333333333';
const model = task => ({ id: `seedance-2.5-${task}`, provider: 'crun', provider_endpoint: `crun:bytedance/seedance2-5-r2v:${task}`,
 modality: 'video-to-video', credits_5s: task === 'edit' ? 76 : 78, active: true, gated_flag: false });
const body = (task='edit') => ({ model_id: model(task).id, idempotency_key: 'seedance25-test', consent: true,
 references: [{ slot: 'video', origin: 'asset', asset_id: ASSET }], inputs: { prompt: 'Restyle this clip' } });
const req = b => new Request('https://veyrnox.test/api/v1/generations', { method:'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type':'application/json' }, body: JSON.stringify(b) });
function network(t, { task='edit', seconds=5.055, active=true, gated=false, refuse=false, spendRefuse=false, audio=null }={}) {
 const calls=[], state={job:null};
 const bytes=lipSyncMp4({video:seconds,audio,sampleCount:100});
 t.mock.method(globalThis,'fetch',async (url,init={}) => {
  const u=new URL(String(url)), b=init.body ? JSON.parse(init.body) : null; calls.push({path:u.pathname,host:u.hostname,body:b});
  if(u.pathname==='/rest/v1/model_catalog') return Response.json([{...model(task),active,gated_flag:gated}]);
  if(u.pathname==='/rest/v1/users') return Response.json([{id:AUTH}]);
  if(u.pathname==='/rest/v1/jobs') return Response.json(state.job && (!u.searchParams.has('idempotency_key') || u.searchParams.get('idempotency_key')===`eq.${state.job.idempotency_key}`) ? [state.job] : []);
  if(u.pathname.endsWith('/rpc/check_generation_rate_limit')) return Response.json({ok:true});
  if(u.pathname.endsWith('/rpc/get_user_asset')) return Response.json({ok:true,state:'STORED',r2_key:`jobs/${ASSET}/output.mp4`,mime_type:'video/mp4'});
  if(u.pathname.endsWith('/rpc/ledger_debit') && spendRefuse) return Response.json({code:'P0001',message:'PROVIDER_SPEND_LIMIT:closed:60'},{status:400});
  if(u.pathname.endsWith('/rpc/ledger_debit')) { state.job={id:JOB,idempotency_key:b.p_idempotency_key,model_id:b.p_model_id,inputs:b.p_inputs}; return Response.json({ok:true,job_id:JOB,balance_after:1000}); }
  if(u.pathname.includes('/rpc/')) return Response.json({ok:true});
  if(u.hostname==='api.crun.ai') return refuse ? Response.json({code:422,message:'Unsupported media format secret'}, {status:422}) : Response.json({code:200,data:{task_id:'task-25'}});
  if(u.hostname.endsWith('.r2.cloudflarestorage.com')) {
   const range=/bytes=(\d+)-(\d+)/.exec(init.headers?.Range || ''), start=range?Number(range[1]):0, end=Math.min(range?Number(range[2]):bytes.length-1,bytes.length-1);
   return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-type':'video/mp4','content-range':`bytes ${start}-${end}/${bytes.length}`}});
  }
  assert.fail(`unexpected ${u.host}${u.pathname}`);
 });
 return {calls,state,debits:()=>calls.filter(c=>c.path.endsWith('/rpc/ledger_debit')), submits:()=>calls.filter(c=>c.host==='api.crun.ai')};
}
for(const task of ['edit','extend']) {
 test(`${task}: raw control refusals leave no debit, even globally valid controls`,async t=>{
  const net=network(t,{task});
  const cases=[{resolution:'1080p'},{resolution:'720p'},{aspect_ratio:'auto'},{aspect_ratio:'16:9'},{duration_seconds:10},
   {duration:-1},{seed:1},{negative_prompt:'x'},{audio_enabled:true},{video_url:'https://attacker.test/x.mp4'}, {callback_url:'https://attacker.test/c'},
   {byteplus_fallback:true},{direct_byteplus:true},{image_url:'https://attacker.test/x.png'},{prompt:''},{prompt:'x'.repeat(30001)}];
  if(task==='edit') cases.push({duration_seconds:5});
  for(const extra of cases) {
   const b=body(task); b.inputs={...b.inputs,...extra};
   const response=await POST(req(b)); assert.equal(response.status,400,JSON.stringify(extra).slice(0,80));
   assert.equal(net.debits().length,0); assert.equal(net.submits().length,0);
  }
 });
 for(const seconds of (task==='edit' ? [4,5,5.055,10] : [4,5,5.055,6])) test(`${task}: ${seconds}s quote equals debit and replay needs no media read`,async t=>{
  const net=network(t,{task,seconds}), b=body(task);
  if(task==='extend') b.inputs.duration_seconds=5;
  const qr=await QUOTE(req(b)), q=await qr.json(); assert.equal(qr.status,200,JSON.stringify(q));
  const expected=model(task).credits_5s*(task==='edit'?Math.ceil(seconds/5):1); assert.equal(q.credits,expected);
  b.confirmed_credits=q.credits;
  const response=await POST(req(b)); assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(net.debits()[0].body.p_credits,q.credits);
  assert.equal(net.debits()[0].body.p_inputs.seedance25_billing.units,q.units);
  assert.equal(net.debits()[0].body.p_inputs.seedance25_billing.source_seconds,q.source_seconds);
  const sent=net.submits()[0].body;
  assert.deepEqual(sent,{model:'bytedance/seedance2-5-r2v',input:{prompt:b.inputs.prompt,task_type:task,duration:task==='edit'?-1:5,resolution:'720p',aspect_ratio:'auto',audio:true,reference_videos:sent.input.reference_videos}});
  assert.equal(sent.input.reference_videos.length,1);
  assert.equal(new URL(sent.input.reference_videos[0]).protocol,'https:');
  assert.equal(b.inputs.duration,undefined);
  const before=net.calls.filter(c=>c.host.endsWith('.r2.cloudflarestorage.com')).length;
  const replay=await POST(req(b)); assert.deepEqual(await replay.json(),{job_id:JOB,idempotent:true});
  assert.equal(net.debits().length,1); assert.equal(net.submits().length,1);
  assert.equal(net.calls.filter(c=>c.host.endsWith('.r2.cloudflarestorage.com')).length,before);
  b.inputs.prompt='changed'; assert.equal((await POST(req(b))).status,409);
 });
 for(const seconds of (task==='edit' ? [3.9,10.01] : [3.9,6.1])) test(`${task}: ${seconds}s refused before debit`,async t=>{
  const net=network(t,{task,seconds}); const response=await POST(req({...body(task),confirmed_credits:152}));
  assert.equal(response.status,400); assert.match((await response.json()).error,/source_too_(short|long)/); assert.equal(net.debits().length,0);
  assert.equal((await QUOTE(req(body(task)))).status,400);
 });
 test(`${task}: missing/extra/wrong slots and stale confirmation never debit`,async t=>{
  const net=network(t,{task});
  for(const references of [[],[...body(task).references,...body(task).references],[{...body(task).references[0],slot:'image'}]]) {
   assert.equal((await POST(req({...body(task),references,confirmed_credits:152}))).status,400);
  }
  assert.equal((await POST(req({...body(task),confirmed_credits:1}))).status,409);
  assert.equal(net.debits().length,0);
 });
 test(`${task}: inactive/gated catalog cannot expose placeholder or debit`,async t=>{
  const net=network(t,{task,active:false,gated:true});
  assert.deepEqual(toPublicModels([{...model(task),active:false}]),[]);
  assert.equal((await QUOTE(req(body(task)))).status,404);
  assert.equal((await POST(req(body(task)))).status,404);
  assert.equal(net.debits().length,0);
 });
 test(`${task}: provider refusal goes through existing refund`,async t=>{
  const net=network(t,{task,seconds:5,refuse:true});
  const res=await POST(req({...body(task),confirmed_credits:model(task).credits_5s}));
  assert.ok(res.status>=400); assert.equal(net.debits().length,1);
  assert.ok(net.calls.some(c=>c.path.endsWith('/rpc/ledger_refund')),JSON.stringify(net.calls.map(c=>c.path)));
 });
}

test('runtime switch hides both offers and refuses admission/quote without a charge', async t => {
 const net=network(t);
 const previous=process.env.APP_RUNTIME_FLAGS;
 process.env.APP_RUNTIME_FLAGS='{}';
 try {
  assert.deepEqual(toPublicModels([model('edit'),model('extend')]),[]);
  assert.equal((await QUOTE(req(body()))).status,404);
  assert.equal((await POST(req(body()))).status,404);
  assert.equal(net.debits().length,0);assert.equal(net.submits().length,0);
 } finally {process.env.APP_RUNTIME_FLAGS=previous;}
});

test('quote refuses unauthenticated, malformed and unconsented requests without debit', async t => {
 const net=network(t);
 assert.equal((await QUOTE(new Request('https://veyrnox.test/api/v1/generations/quote',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await QUOTE(req(null))).status,404);
 for(const patch of [{inputs:[]},{inputs:null},{consent:false},{inputs:{prompt:'x',duration_seconds:5}},{references:'wrong'}]) {
  assert.equal((await QUOTE(req({...body(),...patch}))).status,400);
 }
 assert.equal((await QUOTE(new Request('https://veyrnox.test/api/v1/generations/quote',{method:'POST',headers:{'x-veyrnox-auth-id':AUTH},body:'{'}))).status,400);
 assert.equal(net.debits().length,0);assert.equal(net.submits().length,0);
});
test('an active but gated placeholder still cannot be quoted or debited',async t=>{
 const net=network(t,{gated:true});
 assert.equal((await QUOTE(req(body()))).status,402);
 assert.equal((await POST(req(body()))).status,402);
 assert.equal(net.debits().length,0);
});
test('replay lookup failures fail closed before signing or debit',async t=>{
 const {replaySeedance25}=await import('../lib/seedance25Replay.js');
 const cfg={supabaseUrl:'https://db.test',serviceRoleKey:'test'};
 t.mock.method(globalThis,'fetch',async url => new URL(String(url)).pathname.endsWith('/users') ? Response.json([{id:AUTH}]) : Response.json({bad:true}));
 assert.deepEqual(await replaySeedance25(AUTH,'seedance-2.5-edit','key','hash',cfg),{status:503,body:{error:'admission_unknown'}});
});

for (const task of ['edit','extend']) {
 test(`${task}: typed spend guard rolls back admission without a debit or stranded job`,async t=>{
  const net=network(t,{task,seconds:5,spendRefuse:true});
  const res=await POST(req({...body(task),confirmed_credits:model(task).credits_5s}));
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{error:'supplier_capacity_unavailable',retry_after_seconds:60});
  assert.equal(net.state.job,null); assert.equal(net.submits().length,0);
  assert.equal(net.calls.filter(c=>c.path.endsWith('/rpc/ledger_refund')).length,0);
 });
 test(`${task}: picture minimum and conservative container maximum include longer audio`,async t=>{
  const net=network(t,{task,seconds:3.9,audio:5});
  assert.equal((await POST(req({...body(task),confirmed_credits:78}))).status,400);
  assert.equal(net.debits().length,0);
 });
}
test('edit bills conservative container duration when audio outlasts picture',async t=>{
 const net=network(t,{seconds:5,audio:5.5}), b=body();
 const quote=await QUOTE(req(b)), q=await quote.json();
 assert.equal(quote.status,200);assert.equal(q.source_seconds,5.5);assert.equal(q.credits,152);
 assert.equal((await POST(req({...b,confirmed_credits:q.credits}))).status,200);
 assert.equal(net.debits()[0].body.p_credits,q.credits);
});
test('extend refuses longer audio beyond six seconds even when picture is five seconds',async t=>{
 const net=network(t,{task:'extend',seconds:5,audio:6.1});
 for(const handler of [QUOTE,POST]) {
  const r=await handler(req({...body('extend'),confirmed_credits:78}));
  assert.equal(r.status,400);assert.equal((await r.json()).error,'source_too_long');
 }
 assert.equal(net.debits().length,0);
});
for(const task of ['edit','extend']) test(`${task}: cancel API reports submitted job as non-cancellable`,async t=>{
 const net=network(t,{task,seconds:5});
 assert.equal((await POST(req({...body(task),confirmed_credits:model(task).credits_5s}))).status,200);
 assert.equal(net.state.job.model_id,model(task).id);
 const previous=process.env.JOB_CANCEL_ENABLED;process.env.JOB_CANCEL_ENABLED='true';
 const original=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/rpc/get_user_job_cancel'))return Response.json({ok:true,cancellable:false,credits:model(task).credits_5s});
  if(path.endsWith('/rpc/cancel_user_job'))return Response.json({ok:false,code:'JOB_STARTED'});
  return original(url,init);
 });
 try{
  const {GET:status,POST:cancel}=await import('../app/api/v1/jobs/[id]/cancel/route.js');
  const context={params:Promise.resolve({id:JOB})};
  const read=await status(req({}),context);assert.equal(read.status,200);assert.equal((await read.json()).cancellable,false);
  const response=await cancel(req({}),context);assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'job_started'});
  assert.equal(net.debits().length,1);assert.ok(!net.calls.some(c=>c.path.endsWith('/rpc/ledger_refund')));
 }finally{if(previous===undefined)delete process.env.JOB_CANCEL_ENABLED;else process.env.JOB_CANCEL_ENABLED=previous;}
});

for(const task of ['edit','extend']) {
 test(`${task}: exhausting the quote quota cannot exhaust generation admission`,async t=>{
  const net=network(t,{task,seconds:5}), original=globalThis.fetch;
  const counts={quote:0,generation:0};
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   const path=new URL(String(url)).pathname;
   const bucket=path.endsWith('/rpc/consume_seedance25_quote_request')?'quote':path.endsWith('/rpc/check_generation_rate_limit')?'generation':null;
   if(bucket) return Response.json(++counts[bucket]>20 ? {ok:false,code:'RATE_LIMITED',retry_after_seconds:60}:{ok:true});
   return original(url,init);
  });
  const b=body(task);
  for(let i=0;i<20;i++){b.inputs.prompt=`Change ${i}`;assert.equal((await QUOTE(req(b))).status,200);}
  const reads=net.calls.filter(c=>c.host.endsWith('.r2.cloudflarestorage.com')).length;
  for(let i=0;i<10;i++){
   const limited=await QUOTE(req(b));assert.equal(limited.status,429);assert.equal((await limited.json()).error,'rate_limited');
  }
  assert.equal(net.calls.filter(c=>c.host.endsWith('.r2.cloudflarestorage.com')).length,reads,'denied quotes must not inspect media');
  assert.equal(counts.generation,0,'quotes must never consume generation attempts');
  assert.equal((await POST(req({...b,confirmed_credits:model(task).credits_5s}))).status,200);
  assert.equal(counts.generation,1);assert.equal(net.debits().length,1);assert.equal(net.submits().length,1);
 });
 test(`${task}: disabled offers hide valid, malformed and template inputs, but allow exact replay`,async t=>{
  const net=network(t,{task,seconds:5}), b={...body(task),confirmed_credits:model(task).credits_5s};
  assert.equal((await POST(req(b))).status,200);
  const old=process.env.APP_RUNTIME_FLAGS;process.env.APP_RUNTIME_FLAGS='{}';
  try {
   for(const patch of [{},{inputs:null},{inputs:[]},{inputs:{prompt:'x',resolution:'1080p'}},{inputs:{prompt:'x',duration_seconds:-1}},
    {inputs:{prompt:''}},{template_clip:'x'},{template_swap:'x'},{template_id:'x'},{preset:'x'},{swap:'x'},
    {idempotency_key:null},{confirmed_credits:-1}]) {
    const fresh={...b,idempotency_key:'new-hidden-request',...patch};
    for(const handler of [POST,QUOTE]){
     const res=await handler(req(fresh));assert.equal(res.status,404,JSON.stringify(patch));
     assert.deepEqual(await res.json(),{error:'model_not_found'});
    }
   }
   // Even an existing key cannot turn a modified request into a successful replay.
   assert.equal((await POST(req({...b,template_clip:'x'}))).status,404);
   assert.equal((await POST(req({...b,inputs:{prompt:'changed'}}))).status,404);
   const replay=await POST(req(b));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{job_id:JOB,idempotent:true});
   assert.equal(net.debits().length,1);assert.equal(net.submits().length,1);
  } finally {process.env.APP_RUNTIME_FLAGS=old;}
 });
}
test('quote limiter failures fail closed before source reads or debit',async t=>{
 const net=network(t),original=globalThis.fetch;
 for(const verdict of [null,{ok:false,code:'UNAVAILABLE'},'throw']) {
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   if(new URL(String(url)).pathname.endsWith('/rpc/consume_seedance25_quote_request')){
    if(verdict==='throw')throw new Error('limiter unavailable');return Response.json(verdict);
   }
   return original(url,init);
  });
  const res=await QUOTE(req(body()));assert.equal(res.status,503);assert.equal((await res.json()).error,'rate_check_unavailable');
 }
 assert.equal(net.debits().length,0);assert.equal(net.calls.filter(c=>c.host.endsWith('.r2.cloudflarestorage.com')).length,0);
});
