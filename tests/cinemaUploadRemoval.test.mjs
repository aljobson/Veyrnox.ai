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
 assert.equal(request.url,`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/stream/${uid}`);assert.equal(request.init.method,'DELETE');assert.equal(request.init.redirect,'manual');assert.ok(request.init.signal);
 assert.deepEqual(await deleteStreamVideo(uid,cfg,async()=>Response.json({success:true,errors:[]})),{ok:true});
 assert.deepEqual(await deleteStreamVideo(uid,cfg,async()=>new Response(null,{status:200})),{ok:true});
 for(const response of [new Response(null,{status:404}),new Response(null,{status:401}),Response.json({success:false,errors:[]}),Response.json({success:true,errors:[{code:1}]}),new Response('x'.repeat(66000)),new Response(null,{status:202})])await assert.rejects(deleteStreamVideo(uid,cfg,async()=>response));
 await assert.rejects(deleteStreamVideo('https://evil.invalid',cfg,()=>assert.fail('unexpected network')));
});
test('safety hold never deletes, finalizes or releases removal capacity',async()=>{
 const deps={rpcCall:()=>assert.fail('must not claim or finish removal'),removeVideo:()=>assert.fail('must not delete provider media')};
 assert.equal((await removeCinemaUploads({},deps)).skipped,'disabled');
 assert.deepEqual(await removeCinemaUploads(env,deps),{ok:false,checked:0,removed:0,failed:0,blocked:'upload_revocation_unverified'});
});
test('staging proxy switch deletes only a claimed server-mediated upload and then finalizes it',async()=>{
 const calls=[],enabled={...env,CINEMA_PROXY_UPLOADS_ENABLED:'true'};
 const result=await removeCinemaUploads(enabled,{rpcCall:async(name,args)=>{calls.push({name,args});return name==='claim_cinema_upload_removals'?{items:[{id,stream_uid:uid}]}:{ok:true};},removeVideo:async(value,config)=>{assert.equal(value,uid);assert.equal(config.account,cfg.account);return {ok:true};}});
 assert.deepEqual(result,{ok:true,checked:1,removed:1,failed:0});assert.deepEqual(calls.map(call=>call.name),['claim_cinema_upload_removals','finish_cinema_upload_removal']);
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
