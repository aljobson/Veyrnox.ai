import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteStreamVideo} from '../lib/cinema/stream.js';
import {removeCinemaUploads} from '../lib/cinema/uploadRemoval.js';
import {uploadHandler,uploadProjection} from '../lib/cinema/uploadApi.js';
const id='11111111-1111-4111-8111-111111111111',uid='a'.repeat(32),cfg={account:'b'.repeat(32),token:'private'};
const env={CINEMA_UPLOAD_REMOVAL_ENABLED:'true',CINEMA_STREAM_ACCOUNT_ID:cfg.account,CINEMA_STREAM_API_TOKEN:cfg.token,CINEMA_STREAM_WEBHOOK_SECRET:'private',SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'private'};
Object.assign(process.env,env);
const req=(body={content_id:id,upload_id:id},headers={})=>new Request('https://test.invalid/api/v1/cinema/uploads/remove',{method:'POST',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json','idempotency-key':id,...headers},body:JSON.stringify(body)});
test('DELETE is fixed-origin, bounded, redirect-denying and requires affirmative success',async()=>{
 let request;
 assert.deepEqual(await deleteStreamVideo(uid,cfg,async(url,init)=>{request={url,init};return new Response(null,{status:204});}),{ok:true});
 assert.equal(request.url,`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/stream/${uid}`);assert.equal(request.init.method,'DELETE');assert.equal(request.init.redirect,'error');assert.ok(request.init.signal);
 assert.deepEqual(await deleteStreamVideo(uid,cfg,async()=>Response.json({success:true,errors:[]})),{ok:true});
 for(const response of [new Response(null,{status:404}),new Response(null,{status:401}),Response.json({success:false,errors:[]}),Response.json({success:true,errors:[{code:1}]}),new Response('x'.repeat(66000)),new Response(null,{status:202})])await assert.rejects(deleteStreamVideo(uid,cfg,async()=>response));
 await assert.rejects(deleteStreamVideo('https://evil.invalid',cfg,()=>assert.fail('unexpected network')));
});
function setup({removeVideo=async()=>({ok:true}),items=[{id,stream_uid:uid}],finish={ok:true}}={}){
 const calls=[];return {calls,deps:{removeVideo,rpcCall:async(name,args)=>{calls.push({name,args});return name==='claim_cinema_upload_removals'?{items}:finish;}}};
}
test('only confirmed provider removal finishes the matching durable claim',async()=>{
 const s=setup();assert.deepEqual(await removeCinemaUploads(env,s.deps),{ok:true,checked:1,removed:1,failed:0});
 assert.equal(s.calls[1].name,'finish_cinema_upload_removal');assert.equal(s.calls[1].args.p_key,s.calls[0].args.p_key);assert.equal(s.calls[1].args.p_id,id);
 for(const removeVideo of [async()=>{throw Error('private-provider-body');},async()=>({ok:false})]){
  const failed=setup({removeVideo});assert.equal((await removeCinemaUploads(env,failed.deps)).failed,1);assert.equal(failed.calls.length,1);
 }
 assert.equal((await removeCinemaUploads(env,setup({finish:{error:'unavailable'}}).deps)).ok,false);
});
test('disabled removal and malformed claims cannot delete media',async()=>{
 assert.equal((await removeCinemaUploads({}, {rpcCall:()=>assert.fail('unexpected RPC')})).skipped,'disabled');
 for(const items of [null,[{id,stream_uid:'bad'}],Array(11).fill({id,stream_uid:uid}),[{id,stream_uid:uid},{id,stream_uid:uid}]])assert.equal((await removeCinemaUploads(env,setup({items,removeVideo:()=>assert.fail('unexpected delete')}).deps)).ok,false);
});
test('at most two deletes run concurrently and one failure does not stop other entries',async()=>{
 let active=0,max=0;const releases=[];
 const items=Array.from({length:10},(_,n)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,stream_uid:String(n).padStart(32,'a')}));
 const s=setup({items,removeVideo:async value=>{active++;max=Math.max(max,active);await new Promise(resolve=>releases.push(resolve));active--;if(value===items[0].stream_uid)throw Error('secret');return {ok:true};}});
 const done=removeCinemaUploads(env,s.deps);
 for(let n=0;n<5;n++){while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));releases.splice(0).forEach(resolve=>resolve());}
 assert.deepEqual(await done,{ok:false,checked:10,removed:9,failed:1});assert.equal(max,2);
});
test('removal requires identity, exact upload ID, quota and current database ownership',async()=>{
 const calls=[];let denied=false;
 const handler=uploadHandler({action:'remove',rpcCall:async(name,args)=>{calls.push({name,args});if(name==='consume_account_read_request')return {ok:true};if(name==='request_cinema_upload_removal')return denied?{error:'upload_not_allowed'}:{ok:true};return {upload:{id,content_id:id,state:'deleting'}};}});
 assert.equal((await handler(req(undefined,{'x-veyrnox-auth-id':''}))).status,401);
 for(const body of [{content_id:id},{content_id:id,upload_id:'bad'},{content_id:id,upload_id:id,stream_uid:uid}])assert.equal((await handler(req(body))).status,400);
 assert.equal(calls.length,0);
 assert.equal((await handler(req())).status,202);assert.deepEqual(calls[1].args,{p_auth_id:id,p_content_id:id,p_upload_id:id,p_key:id});
 assert.equal(uploadProjection({state:'deleting',upload_url:'https://upload.cloudflarestream.com/grant'}).upload_url,null);
 denied=true;assert.equal((await handler(req())).status,403);
});
test('removal stays available with new uploads paused but its own switch fails closed',async()=>{
 const handler=uploadHandler({action:'remove',rpcCall:async name=>name==='read_cinema_upload'?{upload:null}:{ok:true}});
 process.env.CREATOR_UPLOADS_ENABLED='false';process.env.CINEMA_ENABLED='false';
 assert.equal((await handler(req())).status,202);
 process.env.CINEMA_UPLOAD_REMOVAL_ENABLED='false';assert.equal((await handler(req())).status,503);process.env.CINEMA_UPLOAD_REMOVAL_ENABLED='true';
});
