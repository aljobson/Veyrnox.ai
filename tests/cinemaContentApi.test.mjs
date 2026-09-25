import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHandler, validDraft } from '../lib/cinema/contentApi.js';
const id='11111111-1111-4111-8111-111111111111';
Object.assign(process.env,{CINEMA_ENABLED:'true',SOCIAL_CINEMA_PROFILES_ENABLED:'true',CREATOR_CONTENT_ENABLED:'true'});
const draft={content_type:'SERIES',parent_id:null,position:null,title:'A story',synopsis:'Original story',language:'en',ai_disclosures:[]};
const request=(body,query='',headers={})=>new Request(`https://test.invalid/api/v1/cinema/content${query}`,{method:body?'POST':'GET',headers:{'x-veyrnox-auth-id':id,'idempotency-key':id,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
function setup(action='create',result={id,revision:1,idempotent:false},rate={ok:true}) {
  const calls=[];return {calls,handle:contentHandler({action,rpcCall:async(name,args)=>{calls.push({name,args});return name==='consume_account_read_request'?rate:result;}})};
}
test('drafts require identity and independent master/profile/content gates',async()=>{
  const {handle,calls}=setup();assert.equal((await handle(request(draft,'',{'x-veyrnox-auth-id':''}))).status,401);
  for(const flag of ['CINEMA_ENABLED','SOCIAL_CINEMA_PROFILES_ENABLED','CREATOR_CONTENT_ENABLED']) {
    process.env[flag]='false';assert.equal((await handle(request(draft))).status,503);process.env[flag]='true';
  }
  assert.equal(calls.length,0);
});
test('metadata validation denies authority/media fields and malformed hierarchy or disclosures',()=>{
  assert.ok(validDraft(draft));
  for(const patch of [{title:' '},{language:'EN'},{language:['en']},{ai_disclosures:['cloned_voice','cloned_voice']},{ai_disclosures:['unknown']},{ai_disclosures:[{}]},{content_type:'EPISODE'},{parent_id:id},{position:1},{title:'x'.repeat(161)}, {lifecycle_status:'PUBLISHED'},{creator_id:id},{stream_video_uid:id},{monetisation_type:'FREE'}]) assert.equal(validDraft({...draft,...patch}),false,JSON.stringify(patch));
  assert.ok(validDraft({...draft,content_type:'EPISODE',parent_id:id,position:1,ai_disclosures:['generated_video']}));
});
test('create and edit bind verified actor, strict metadata and revision; replies are private and correlated',async()=>{
  const {handle,calls}=setup();const res=await handle(request(draft));assert.equal(res.status,201);assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal((await res.json()).request_id,res.headers.get('x-request-id'));
  assert.deepEqual(calls[1].args,{p_auth_id:id,p_idempotency_key:id,p_content_id:null,p_revision:0,p_draft:draft});
  assert.equal((await handle(request({...draft,id}))).status,400);
  const edit=setup('edit');assert.equal((await edit.handle(request({...draft,id,revision:1}))).status,200);
  assert.equal(edit.calls[1].args.p_revision,1);assert.equal(edit.calls[1].args.p_content_id,id);
  for(const revision of [0,-1,1.5,'1',null,2147483647]) assert.equal((await edit.handle(request({...draft,id,revision}))).status,400);
});
test('query, media type and body size are bounded; quotas fail closed before mutations',async()=>{
  const {handle,calls}=setup('list',{content:[]});
  for(const query of ['?owner_id='+id,'?parent_id=bad','?parent_id='+id+'&parent_id='+id]) assert.equal((await handle(request(null,query))).status,400);
  assert.equal(calls.length,0);assert.equal((await handle(request(null,'?parent_id='+id))).status,200);assert.equal(calls[1].args.p_parent_id,id);
  const write=setup();assert.equal((await write.handle(request(draft,'',{'content-type':'text/plain'}))).status,415);
  assert.equal((await write.handle(request({...draft,synopsis:'x'.repeat(70000)}))).status,413);
  for(const [rate,status] of [[{code:'RATE_LIMITED'},429],[{},503]]) { const s=setup('create',{},rate);assert.equal((await s.handle(request(draft))).status,status);assert.equal(s.calls.length,1); }
});
test('policy and concurrency errors are typed; backend details stay private',async()=>{
  for(const [error,status] of [['creator_required',403],['account_not_active',403],['content_not_found',404],['revision_conflict',409],['position_taken',409],['idempotency_conflict',409],['draft_limit_reached',409],['secret backend detail',503]]) {
    const {handle}=setup('create',{error});const res=await handle(request(draft));assert.equal(res.status,status);assert.ok(!(await res.text()).includes('secret'));
  }
  const {handle}=setup('create',{id,revision:1,idempotent:true});assert.equal((await handle(request(draft))).status,200);
});
