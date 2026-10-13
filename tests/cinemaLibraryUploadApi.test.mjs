import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryUploadHandler} from '../lib/cinema/libraryUploadApi.js';
import {uploadProjection} from '../lib/cinema/uploadApi.js';
const id='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
Object.assign(process.env,{CINEMA_ENABLED:'true',SOCIAL_CINEMA_PROFILES_ENABLED:'true',CREATOR_CONTENT_ENABLED:'true',CREATOR_UPLOADS_ENABLED:'true'});
const body={content_id:id,job_id:job};
const req=(value=body,headers={})=>new Request('https://test.invalid/api/v1/cinema/uploads/from-library',{method:'POST',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json','idempotency-key':id,...headers},body:JSON.stringify(value)});
const row={id,content_id:id,creator_id:'private-owner',create_key:'private-key',state:'provisioning',server_mediated:true,source_job_id:job,file_size:123,fingerprint:'c'.repeat(64),stream_uid:null,upload_url:null,expires_at:new Date(Date.now()+3600000).toISOString()};
function setup({claimed=true,reserve}={}) {
  const calls=[];
  const handle=libraryUploadHandler({rpcCall:async(name,args)=>{calls.push({name,args});
    if(name==='consume_account_read_request')return {ok:true};
    if(name==='reserve_cinema_library_upload')return reserve||{...row,claimed,scan_status:'queued'};
    return {upload:row};}});
  return {calls,handle};
}
test('identity, flags and strict input are checked before any database call',async()=>{
  process.env.CINEMA_QUARANTINE_SCANNER_ENABLED='true';
  try {
    const s=setup();
    assert.equal((await s.handle(req(body,{'x-veyrnox-auth-id':''}))).status,401);
    for(const flag of ['CINEMA_ENABLED','CREATOR_CONTENT_ENABLED','CREATOR_UPLOADS_ENABLED']){process.env[flag]='false';assert.equal((await s.handle(req())).status,503);process.env[flag]='true';}
    for(const patch of [{job_id:'not-a-uuid'},{job_id:undefined},{r2_key:'assets/x'},{source_url:'https://evil.invalid/'},{file_size:1}])assert.equal((await s.handle(req({...body,...patch}))).status,400);
    assert.equal((await s.handle(req(body,{'idempotency-key':'bad'}))).status,400);
    assert.equal((await s.handle(req(body,{'content-type':'text/plain'}))).status,415);
    assert.equal(s.calls.length,0);
  } finally { delete process.env.CINEMA_QUARANTINE_SCANNER_ENABLED; }
});
test('the scanner hold stops reservations while browser upload configuration is irrelevant',async()=>{
  process.env.CINEMA_PROXY_UPLOADS_ENABLED='true';
  try {
    const s=setup(),res=await s.handle(req());
    assert.equal(res.status,503);assert.equal((await res.json()).error,'upload_safety_hold');assert.equal(s.calls.length,0);
  } finally { delete process.env.CINEMA_PROXY_UPLOADS_ENABLED; }
});
test('a claimed Library video is queued privately without a Stream or R2 URL',async()=>{
  process.env.CINEMA_QUARANTINE_SCANNER_ENABLED='true';
  try {
    const s=setup(),res=await s.handle(req());
    assert.equal(res.status,202);
    assert.deepEqual(s.calls.map(c=>c.name),['consume_account_read_request','reserve_cinema_library_upload','read_cinema_upload']);
    assert.deepEqual(s.calls[1].args,{p_auth_id:id,p_content_id:id,p_job_id:job,p_key:id});
    const text=await res.text(),data=JSON.parse(text);
    assert.equal(data.upload.state,'provisioning');assert.equal(data.upload.source_job_id,job);
    assert.equal(data.library_uploads_enabled,true);assert.equal(data.proxy_uploads_enabled,false);
    assert.equal(data.upload.upload_url,null);assert.doesNotMatch(text,/r2_key|cloudflarestorage|scan_status/);
  } finally { delete process.env.CINEMA_QUARANTINE_SCANNER_ENABLED; }
});
test('a replay stays queued without creating another scan',async()=>{
  process.env.CINEMA_QUARANTINE_SCANNER_ENABLED='true';
  try {
    const s=setup({claimed:false}),res=await s.handle(req());
    assert.equal(res.status,200);assert.deepEqual(s.calls.map(c=>c.name),['consume_account_read_request','reserve_cinema_library_upload','read_cinema_upload']);
  } finally { delete process.env.CINEMA_QUARANTINE_SCANNER_ENABLED; }
});
test('database refusals map to typed errors',async()=>{
  process.env.CINEMA_QUARANTINE_SCANNER_ENABLED='true';
  try {
    for(const [error,status] of [['upload_not_allowed',403],['source_not_found',404],['source_not_video',400],['upload_exists',409],['idempotency_conflict',409],['upload_capacity_reached',429],['something_private',503]]) {
      const s=setup({reserve:{error}}),res=await s.handle(req());
      assert.equal(res.status,status,error);assert.equal((await res.json()).error,status===503?'temporarily_unavailable':error);
    }
  } finally { delete process.env.CINEMA_QUARANTINE_SCANNER_ENABLED; }
});
test('the projection carries provenance and no quarantine data',()=>{
  const projected=uploadProjection({...row,r2_key:'assets/private-object.mp4',scan_status:'queued'});
  assert.equal(projected.source_job_id,job);assert.equal(projected.r2_key,undefined);assert.equal(projected.scan_status,undefined);assert.equal(projected.upload_url,null);
});
