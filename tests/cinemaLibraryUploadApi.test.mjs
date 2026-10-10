import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryUploadHandler,SOURCE_URL_TTL_SECONDS} from '../lib/cinema/libraryUploadApi.js';
import {uploadProjection} from '../lib/cinema/uploadApi.js';
const id='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',uid='a'.repeat(32);
Object.assign(process.env,{CINEMA_ENABLED:'true',SOCIAL_CINEMA_PROFILES_ENABLED:'true',CREATOR_CONTENT_ENABLED:'true',CREATOR_UPLOADS_ENABLED:'true',CINEMA_STREAM_ACCOUNT_ID:'b'.repeat(32),CINEMA_STREAM_API_TOKEN:'synthetic',CINEMA_STREAM_WEBHOOK_SECRET:'synthetic'});
const body={content_id:id,job_id:job};
const req=(value=body,headers={})=>new Request('https://test.invalid/api/v1/cinema/uploads/from-library',{method:'POST',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json','idempotency-key':id,...headers},body:JSON.stringify(value)});
const r2cfg={accountId:'c'.repeat(32),accessKeyId:'k',secretAccessKey:'s',bucket:'media',jurisdiction:'eu'};
const row={id,content_id:id,creator_id:'private-owner',create_key:'private-key',state:'processing',server_mediated:true,source_job_id:job,file_size:123,fingerprint:'c'.repeat(64),stream_uid:uid,upload_url:null,expires_at:new Date(Date.now()+3600000).toISOString()};
function setup({claimed=true,reserve,failCopy=false,attach={ok:true}}={}) {
  const calls=[],copies=[],signed=[];
  const handle=libraryUploadHandler({
    r2Config:()=>r2cfg,
    presign:async(key,ttl,cfg)=>{signed.push({key,ttl,cfg});return {url:`https://${r2cfg.accountId}.eu.r2.cloudflarestorage.com/media/${key}?X-Amz-Signature=private`,expires:ttl};},
    copyVideo:async(reserved,url)=>{copies.push({reserved,url});if(failCopy)throw Error('private provider error');return {uid};},
    rpcCall:async(name,args)=>{calls.push({name,args});
      if(name==='consume_account_read_request')return {ok:true};
      if(name==='reserve_cinema_library_upload')return reserve||{...row,state:'provisioning',stream_uid:null,claimed,r2_key:'assets/private-object.mp4',mime_type:'video/mp4'};
      if(name==='attach_cinema_library_upload')return attach;
      return {upload:row};}});
  return {calls,copies,signed,handle};
}
test('identity, flags and strict input are checked before any database or provider call',async()=>{
  process.env.CINEMA_PROXY_UPLOADS_ENABLED='true';
  try {
    const s=setup();
    assert.equal((await s.handle(req(body,{'x-veyrnox-auth-id':''}))).status,401);
    for(const flag of ['CINEMA_ENABLED','CREATOR_CONTENT_ENABLED','CREATOR_UPLOADS_ENABLED']){process.env[flag]='false';assert.equal((await s.handle(req())).status,503);process.env[flag]='true';}
    for(const patch of [{job_id:'not-a-uuid'},{job_id:undefined},{r2_key:'assets/x'},{source_url:'https://evil.invalid/'},{file_size:1}])assert.equal((await s.handle(req({...body,...patch}))).status,400);
    assert.equal((await s.handle(req(body,{'idempotency-key':'bad'}))).status,400);
    assert.equal((await s.handle(req(body,{'content-type':'text/plain'}))).status,415);
    assert.equal((await s.handle(new Request('https://test.invalid/api/v1/cinema/uploads/from-library?content_id=x',{method:'POST',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json','idempotency-key':id},body:'{}'}))).status,400);
    assert.equal(s.calls.length,0);assert.equal(s.copies.length,0);assert.equal(s.signed.length,0);
  } finally { delete process.env.CINEMA_PROXY_UPLOADS_ENABLED; }
});
test('the upload safety hold stops the copy before any reservation',async()=>{
  const s=setup(),res=await s.handle(req());
  assert.equal(res.status,503);assert.equal((await res.json()).error,'upload_safety_hold');
  assert.equal(s.calls.length,0);assert.equal(s.copies.length,0);
});
test('a claimed reservation presigns the object for 15 minutes and hands the link to Stream only',async()=>{
  process.env.CINEMA_PROXY_UPLOADS_ENABLED='true';
  try {
    const s=setup(),res=await s.handle(req());
    assert.equal(res.status,202);
    assert.deepEqual(s.calls.map(c=>c.name),['consume_account_read_request','reserve_cinema_library_upload','attach_cinema_library_upload','read_cinema_upload']);
    assert.deepEqual(s.calls[1].args,{p_auth_id:id,p_content_id:id,p_job_id:job,p_key:id});
    assert.equal(s.signed.length,1);assert.equal(s.signed[0].key,'assets/private-object.mp4');assert.equal(s.signed[0].ttl,SOURCE_URL_TTL_SECONDS);assert.ok(SOURCE_URL_TTL_SECONDS<=900);
    assert.equal(s.copies.length,1);assert.match(s.copies[0].url,/X-Amz-Signature=private/);
    assert.deepEqual(s.calls[2].args,{p_id:id,p_uid:uid});
    const text=await res.text(),data=JSON.parse(text);
    assert.equal(data.upload.source_job_id,job);assert.equal(data.upload.state,'processing');assert.equal(data.upload.upload_url,null);assert.equal(data.upload.transfer_path,null);
    assert.doesNotMatch(text,/X-Amz-Signature|private-object|r2_key|cloudflarestorage/);
    assert.equal(res.headers.get('cache-control'),'no-store');
  } finally { delete process.env.CINEMA_PROXY_UPLOADS_ENABLED; }
});
test('a replay for the same draft and job is a no-op: no signing, no second Stream video',async()=>{
  process.env.CINEMA_PROXY_UPLOADS_ENABLED='true';
  try {
    const s=setup({claimed:false}),res=await s.handle(req());
    assert.equal(res.status,200);
    assert.equal(s.signed.length,0);assert.equal(s.copies.length,0);
    assert.deepEqual(s.calls.map(c=>c.name),['consume_account_read_request','reserve_cinema_library_upload','read_cinema_upload']);
    assert.equal((await res.json()).upload.source_job_id,job);
  } finally { delete process.env.CINEMA_PROXY_UPLOADS_ENABLED; }
});
test('database refusals map to typed errors and never reach the provider',async()=>{
  process.env.CINEMA_PROXY_UPLOADS_ENABLED='true';
  try {
    for(const [error,status] of [['upload_not_allowed',403],['source_not_found',404],['source_not_video',400],['upload_exists',409],['idempotency_conflict',409],['upload_capacity_reached',429],['something_private',503]]) {
      const s=setup({reserve:{error}}),res=await s.handle(req());
      assert.equal(res.status,status,error);assert.equal((await res.json()).error,status===503?'temporarily_unavailable':error);
      assert.equal(s.copies.length,0);assert.equal(s.signed.length,0);
    }
  } finally { delete process.env.CINEMA_PROXY_UPLOADS_ENABLED; }
});
test('a failed or unrecorded copy leaves the reservation for reconciliation and says nothing about the provider',async()=>{
  process.env.CINEMA_PROXY_UPLOADS_ENABLED='true';
  try {
    const failed=setup({failCopy:true}),res=await failed.handle(req());
    assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/private provider error/);
    assert.ok(!failed.calls.some(c=>c.name==='attach_cinema_library_upload'));
    const unrecorded=setup({attach:{error:'upload_removed'}}),second=await unrecorded.handle(req());
    assert.equal(second.status,503);assert.equal((await second.json()).error,'upload_needs_reconciliation');
    const noKey=setup({reserve:{...row,state:'provisioning',claimed:true,r2_key:'bad key with spaces'}}),third=await noKey.handle(req());
    assert.equal(third.status,503);assert.equal(noKey.signed.length,0);assert.equal(noKey.copies.length,0);
  } finally { delete process.env.CINEMA_PROXY_UPLOADS_ENABLED; }
});
test('the projection carries provenance and nothing from the object store',()=>{
  const projected=uploadProjection({...row,r2_key:'assets/private-object.mp4'});
  assert.equal(projected.source_job_id,job);assert.equal(projected.r2_key,undefined);assert.equal(projected.upload_url,null);
  assert.equal(uploadProjection({...row,source_job_id:undefined}).source_job_id,null);
});
