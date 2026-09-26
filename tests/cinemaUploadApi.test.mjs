import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadHandler,uploadProjection} from '../lib/cinema/uploadApi.js';
const id='11111111-1111-4111-8111-111111111111',uid='a'.repeat(32);
Object.assign(process.env,{CINEMA_ENABLED:'true',SOCIAL_CINEMA_PROFILES_ENABLED:'true',CREATOR_CONTENT_ENABLED:'true',CREATOR_UPLOADS_ENABLED:'true',CINEMA_STREAM_ACCOUNT_ID:'b'.repeat(32),CINEMA_STREAM_API_TOKEN:'synthetic',CINEMA_STREAM_WEBHOOK_SECRET:'synthetic'});
const body={content_id:id,file_size:123,fingerprint:'c'.repeat(64)};
const req=(value=body,headers={})=>new Request('https://test.invalid/api/v1/cinema/uploads',{method:'POST',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json','idempotency-key':id,...headers},body:JSON.stringify(value)});
const row={id,content_id:id,creator_id:'private-owner',create_key:'private-key',state:'uploading',file_size:123,fingerprint:body.fingerprint,stream_uid:uid,upload_url:`https://upload.cloudflarestream.com/${uid}`,expires_at:new Date(Date.now()+3600000).toISOString()};
function setup({claimed=true,deny=false,failCreate=false}={}){let providers=0;const calls=[];return {calls,providers:()=>providers,handle:uploadHandler({action:'start',createVideo:async()=>{providers++;if(failCreate)throw Error('private provider error');return {uid,url:row.upload_url};},rpcCall:async(name,args)=>{calls.push({name,args});if(name==='consume_account_read_request')return {ok:true};if(deny)return {error:'upload_not_allowed'};if(name==='reserve_cinema_upload')return {...row,state:'provisioning',claimed};if(name==='attach_cinema_upload')return {ok:true};return {upload:row};}})};}
test('strict input, identity and upload gates prevent provider spend',async()=>{
 const s=setup();assert.equal((await s.handle(req(body,{'x-veyrnox-auth-id':''}))).status,401);
 for(const flag of ['CINEMA_ENABLED','CREATOR_CONTENT_ENABLED','CREATOR_UPLOADS_ENABLED']){process.env[flag]='false';assert.equal((await s.handle(req())).status,503);process.env[flag]='true';}
 for(const patch of [{file_size:2147483649},{fingerprint:'bad'},{owner:id},{stream_uid:uid},{maxDurationSeconds:3600}])assert.equal((await s.handle(req({...body,...patch}))).status,400);
 assert.equal(s.providers(),0);
});
test('only the durable claim creates provider media; matching retries do not',async()=>{
 const s=setup();const res=await s.handle(req());assert.equal(res.status,200);assert.equal(s.providers(),1);assert.equal(s.calls[1].name,'reserve_cinema_upload');assert.equal(s.calls[2].name,'attach_cinema_upload');
 const data=await res.json();assert.equal(data.upload.stream_uid,undefined);assert.equal(data.upload.creator_id,undefined);assert.equal(data.upload.create_key,undefined);assert.equal(res.headers.get('cache-control'),'no-store');
 const replay=setup({claimed:false});assert.equal((await replay.handle(req())).status,200);assert.equal(replay.providers(),0);
 const denied=setup({deny:true});assert.equal((await denied.handle(req())).status,403);assert.equal(denied.providers(),0);
});
test('ambiguous provision failure leaves reservation intact and redacts upstream detail',async()=>{
 const s=setup({failCreate:true});const res=await s.handle(req());assert.equal(res.status,503);assert.ok(!(await res.text()).includes('private'));assert.equal(s.calls.length,2);
});
test('grants expire and are never returned for terminal media',()=>{
 assert.equal(uploadProjection({...row,expires_at:'2000-01-01T00:00:00Z'}).upload_url,null);
 for(const state of ['ready','error','processing','provisioning'])assert.equal(uploadProjection({...row,state}).upload_url,null);
});
