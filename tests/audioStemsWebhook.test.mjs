import test from 'node:test';
import assert from 'node:assert/strict';
import {createFalWebhookHandler} from '../lib/falWebhookHandler.js';
import {AUDIO_STEMS} from '../lib/audioStems.mjs';
function fixture({failCopy=0,failStore=false,verify=true}={}){
 const copies=[],rpcs=[],io=[];let state='SUBMITTED',processed=false,attempt=0;
 const cfg={supabaseUrl:'https://fixture.invalid',serviceRoleKey:'fixture'};
 const handler=createFalWebhookHandler({config:()=>cfg,storageConfig:()=>({accountId:'fixture',accessKeyId:'fixture',secretAccessKey:'fixture',bucket:'fixture'}),expectedTenant:()=> 'fixture',verify:async()=>verify,
 fetchCall:async(url,init={})=>{io.push(init.method||'GET');if(url.pathname.endsWith('/jobs'))return Response.json(!url.searchParams.get('state')||url.searchParams.get('state').includes(state)?[{id:'job',user_id:'owner',credits:6,state,model_id:'demucs-stems'}]:[]);
 if(init.method==='PATCH'){processed=true;return new Response(null,{status:204});}if(init.method==='POST')return Response.json(attempt++?[]:[{id:'event'}],{status:201});return Response.json([{processed_at:processed?'done':null}]);},
 rpcCall:async(name,args)=>{rpcs.push({name,args});if(name==='job_succeeded'){if(state!=='SUBMITTED')return {ok:false};state='SUCCEEDED';return {ok:true};}if(name==='job_stored_audio_stems'){if(failStore)return {ok:false};state='STORED';return {ok:true};}if(name==='job_failed'){state='FAILED';return {ok:true,user_id:'owner',credits:6,job_id:'job'};}if(name==='ledger_refund')return {ok:true};throw Error(name);},
 copyAsset:async(url,key)=>{copies.push({url,key});return copies.length===failCopy?{ok:false,error:'temporary'}:{ok:true,r2Key:key,mimeType:'audio/mpeg',size:100,sha256:'a'.repeat(64)};}});
 const payload=Object.fromEntries(AUDIO_STEMS.map(label=>[label,{url:`https://provider.invalid/${label}.mp3`}]));
 const request=event=>new Request('https://fixture.invalid/webhook',{method:'POST',headers:{'x-fal-webhook-request-id':'request-fixture','x-fal-webhook-user-id':'fixture'},body:JSON.stringify({request_id:'request-fixture',status:'OK',payload,...event})});
 return {handler,request,payload,copies,rpcs,io,get state(){return state;},get processed(){return processed;}};
}
test('verified delivery commits all six inspected named outputs together, and duplicate does no more work',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request())).status,200);assert.equal(f.state,'STORED');assert.equal(f.copies.length,6);
 const writes=f.rpcs.filter(x=>x.name==='job_stored_audio_stems');assert.equal(writes.length,1);assert.deepEqual(writes[0].args.p_stems.map(x=>x.label),AUDIO_STEMS);
 assert.equal(new Set(f.copies.map(x=>x.key)).size,6);assert.equal((await f.handler(f.request())).status,200);assert.equal(f.copies.length,6);
 assert.equal(f.rpcs.some(x=>/debit|refund|job_stored$/.test(x.name)),false);
});
test('partial copy failure stays unprocessed and retries deterministic keys before one atomic store',async()=>{
 const f=fixture({failCopy:3});assert.equal((await f.handler(f.request())).status,500);assert.equal(f.state,'SUCCEEDED');assert.equal(f.processed,false);
 assert.equal(f.rpcs.some(x=>x.name==='job_stored_audio_stems'),false);const keys=f.copies.map(x=>x.key);
 assert.equal((await f.handler(f.request())).status,200);assert.deepEqual(f.copies.slice(3,6).map(x=>x.key),keys);assert.equal(f.state,'STORED');
});
test('missing stem and failed database completion never mark partial work complete',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request({payload:{...f.payload,piano:null}}))).status,500);assert.equal(f.copies.length,0);assert.equal(f.processed,false);
 const db=fixture({failStore:true});assert.equal((await db.handler(db.request())).status,500);assert.equal(db.state,'SUCCEEDED');assert.equal(db.processed,false);
});
test('wrong signature prevents database and provider I/O',async()=>{const f=fixture({verify:false});assert.equal((await f.handler(f.request())).status,401);assert.equal(f.io.length,0);assert.equal(f.copies.length,0);});
test('provider failure follows the existing single job refund policy',async()=>{const f=fixture();assert.equal((await f.handler(f.request({status:'ERROR',error:{code:'separation_failed'}}))).status,200);assert.equal(f.copies.length,0);assert.deepEqual(f.rpcs.map(x=>x.name),['job_failed','ledger_refund']);assert.equal(f.rpcs[1].args.p_credits,6);});
