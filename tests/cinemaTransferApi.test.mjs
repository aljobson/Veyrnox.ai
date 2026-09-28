import test from 'node:test';
import assert from 'node:assert/strict';
import {transferChunk,transferHandler} from '../lib/cinema/transferApi.js';
import {uploadProjection} from '../lib/cinema/uploadApi.js';
const id='11111111-1111-4111-8111-111111111111',url='https://upload.cloudflarestream.com/private-grant';
const input=(method='PATCH')=>({req:{method},uploadId:id,auth:id,contentId:id,bytes:new Uint8Array(5),offset:0,db:{}});
function setup({claim={ok:true,upload_url:url,file_size:5},patch,headOffset='0',headLength='5'}={}) {
 const rpcCalls=[],requests=[];
 return {rpcCalls,requests,deps:{rpcCall:async(name,args)=>{rpcCalls.push({name,args});return name==='claim_cinema_transfer'?claim:{ok:true};},fetcher:async(target,init)=>{
  requests.push({target,init});
  if(init.method==='HEAD') return new Response(null,{headers:{'upload-offset':headOffset,'upload-length':headLength}});
  return patch?patch():new Response(null,{status:204,headers:{'upload-offset':'5'}});
 }}};
}
test('only the database grant is used and JWT/cookies never reach the provider',async()=>{
 const s=setup(),r=await transferChunk(input(),s.deps);assert.equal(r.status,200);assert.deepEqual(await r.json(),{offset:5,length:5});
 assert.deepEqual(s.requests.map(x=>x.init.method),['HEAD','PATCH']);
 for(const {target,init} of s.requests){assert.equal(target,url);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.Cookie,undefined);assert.ok(init.signal);}
 assert.equal(s.rpcCalls.at(-1).name,'finish_cinema_transfer');assert.equal(s.rpcCalls[0].args.p_key,s.rpcCalls.at(-1).args.p_key);
});
test('ownership, removal, legacy and concurrency refusals cause no provider request',async()=>{
 for(const [error,status] of [['upload_not_allowed',403],['upload_removed',410],['upload_busy',409],['upload_needs_reconciliation',409]]){
  const s=setup({claim:{error}});assert.equal((await transferChunk(input(),s.deps)).status,status);assert.equal(s.requests.length,0);assert.equal(s.rpcCalls.length,1);
 }
});
test('ambiguous PATCH or invalid acknowledgement retains the durable claim',async()=>{
 for(const patch of [()=>{throw Error('secret-provider-details');},()=>new Response(null,{status:500}),()=>new Response(null,{status:307}),()=>new Response(null,{status:204,headers:{'upload-offset':'4'}})]){
  const s=setup({patch}),r=await transferChunk(input(),s.deps);assert.equal(r.status,503);assert.equal((await r.json()).error,'upload_needs_reconciliation');assert.equal(s.rpcCalls.length,1);
 }
});
test('offset conflicts and invalid chunks never PATCH; safe pre-write failures release claims',async()=>{
 for(const args of [{...input(),offset:1},{...input(),bytes:new Uint8Array(6)},{...input(),bytes:new Uint8Array()}]){
  const s=setup(),r=await transferChunk(args,s.deps);assert.ok([400,409].includes(r.status));assert.equal(s.requests.length,1);assert.equal(s.rpcCalls.at(-1).name,'finish_cinema_transfer');
 }
 const bad=setup({claim:{ok:true,upload_url:'https://evil.invalid/',file_size:5}});assert.equal((await transferChunk(input(),bad.deps)).status,503);assert.equal(bad.requests.length,0);
});
test('resume status is owner-scoped, bounded and never exposes the grant',async()=>{
 const s=setup({headOffset:'3'}),r=await transferChunk(input('GET'),s.deps);assert.deepEqual(await r.json(),{offset:3,length:5});assert.equal(s.requests.length,1);assert.equal(s.rpcCalls.at(-1).name,'finish_cinema_transfer');
 const projected=uploadProjection({id,content_id:id,state:'uploading',server_mediated:true,expires_at:new Date(Date.now()+60000).toISOString(),upload_url:url});assert.equal(projected.upload_url,null);assert.equal(projected.transfer_path,`/cinema/uploads/${id}/transfer?content_id=${id}`);
});
test('public route fails closed during the safety hold even if feature flags are enabled',async()=>{
 Object.assign(process.env,{CINEMA_ENABLED:'true',SOCIAL_CINEMA_PROFILES_ENABLED:'true',CREATOR_CONTENT_ENABLED:'true',CREATOR_UPLOADS_ENABLED:'true'});
 const handle=transferHandler({rpcCall:()=>assert.fail('no RPC'),fetcher:()=>assert.fail('no fetch')});
 const req=new Request(`https://test.invalid/api/v1/cinema/uploads/${id}/transfer?content_id=${id}`,{headers:{'x-veyrnox-auth-id':id}});
 const held=await handle(req,id);assert.equal(held.status,503);assert.match(held.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
 assert.equal((await handle(new Request(req.url),id)).status,401);
});
