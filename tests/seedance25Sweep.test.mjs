import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweepCrun, TIMEOUT_MINUTES } from '../lib/crunSweep.js';
import { POLLED_PROVIDERS } from '../lib/adminPolledProviders.js';
const cfg={supabaseUrl:'https://db.test',serviceRoleKey:'test'},r2cfg={accountId:'test',accessKeyId:'test',secretAccessKey:'test',bucket:'test'};
const now=new Date('2026-11-23T12:00:00Z');
const bytes=readFileSync(new URL('./fixtures/editor-render-360p30.mp4',import.meta.url));
for(const task of ['edit','extend']) for(const state of ['success','fail','pending']) test(`${task}: ${state} settles through existing R2/refund path`,async t=>{
 const model=`seedance-2.5-${task}`, calls=[];
 const job={id:'11111111-1111-4111-8111-111111111111',user_id:'owner',credits:152,model_id:model,state:'SUBMITTED',provider_job_id:'task-25',created_at:new Date(+now-12*60000).toISOString()};
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=new URL(String(url)); calls.push({path:u.pathname,host:u.hostname,method:init.method,body:typeof init.body==='string'?JSON.parse(init.body):null});
  if(u.pathname==='/rest/v1/model_routes')return Response.json([{model_id:model,endpoint:`crun:bytedance/seedance2-5-r2v:${task}`}]);
  if(u.pathname==='/rest/v1/jobs')return Response.json([job]);
  if(u.pathname==='/rest/v1/webhook_events')return init.method==='PATCH'?new Response(null,{status:204}):Response.json([{id:'event'}],{status:201});
  if(u.pathname.includes('/rpc/'))return Response.json({ok:true});
  if(u.hostname==='static.mediaoss.bar')return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length)}});
  if(u.hostname.endsWith('.r2.cloudflarestorage.com'))return new Response(null,{status:200});
  assert.fail(`unexpected ${u.hostname}${u.pathname}`);
 });
 const out=await sweepCrun({cfg,r2cfg,apiKey:'test',now,read:async()=>({ok:true,state,outputUrl:'https://static.mediaoss.bar/output.mp4',errorCode:'Unsupported signed https://private.test/video'})});
 assert.equal(out.errors,0);
 if(state==='pending') {assert.equal(out.pending,1);assert.equal(calls.some(c=>c.path.includes('/rpc/')),false);}
 if(state==='fail') {
  assert.equal(out.applied,1);
  assert.equal(calls.find(c=>c.path.endsWith('/rpc/job_failed')).body.p_error_code,'provider_failed');
  assert.equal(calls.find(c=>c.path.endsWith('/rpc/ledger_refund')).body.p_credits,152);
 }
 if(state==='success') {
  assert.equal(out.applied,1);
  const copy=calls.findIndex(c=>c.host.endsWith('.r2.cloudflarestorage.com'));
  const stored=calls.findIndex(c=>c.path.endsWith('/rpc/job_stored'));
  assert.ok(copy>0 && stored>copy,'first read copies before STORED');
  assert.equal(calls[stored].body.p_mime_type,'video/mp4');
 }
 assert.ok(TIMEOUT_MINUTES>10);assert.equal(POLLED_PROVIDERS.crun.timeoutMinutes,TIMEOUT_MINUTES);
});
