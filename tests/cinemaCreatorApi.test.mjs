import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorHandler } from '../lib/cinema/creatorApi.js';
const id='11111111-1111-4111-8111-111111111111';
Object.assign(process.env,{ CINEMA_ENABLED:'true', SOCIAL_CINEMA_PROFILES_ENABLED:'true',CREATOR_APPLICATIONS_ENABLED:'true',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test' });
const req=(body,headers={})=>new Request('https://veyrnox.test/api/v1/creators/apply',{method:body?'POST':'GET',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json','idempotency-key':id,...headers},...(body?{body:JSON.stringify(body)}:{})});
const admin=()=>({'x-veyrnox-auth-aal':'aal2','x-veyrnox-auth-mfa-at':String(Math.floor(Date.now()/1000)),'cf-access-jwt-assertion':'test-assertion'});
const statement='I create original short science fiction films.';
function setup(options={},result={id,status:'pending'}) {
  const calls=[];
  return {calls,handle:creatorHandler({...options,accessVerifier:async()=>{},rpcCall:async(name,args)=>{calls.push({name,args});return name==='consume_account_read_request'?{ok:true}:result;}})};
}
test('identity and all feature gates precede database work',async()=>{
  const {handle,calls}=setup();
  assert.equal((await handle(req(null,{'x-veyrnox-auth-id':''}))).status,401);
  process.env.CREATOR_APPLICATIONS_ENABLED='false';
  assert.equal((await handle(req())).status,503);
  process.env.CREATOR_APPLICATIONS_ENABLED='true'; assert.equal(calls.length,0);
});
test('applications forward only validated statement and verified caller',async()=>{
  const {handle,calls}=setup({create:true});
  const res=await handle(req({statement}));assert.equal(res.status,201);assert.equal(res.headers.get('cache-control'),'no-store');
  assert.deepEqual(calls[1].args,{p_auth_id:id,p_idempotency_key:id,p_statement:statement});
  assert.match((await res.json()).request_id,/^[a-f0-9-]{36}$/);
  for(const body of [{statement,role:'administrator'},{statement:'short'},[],{statement:null}]) assert.equal((await handle(req(body))).status,400);
});
test('review requires fresh MFA and Access even without an edge header',async()=>{
  const {handle,calls}=setup({review:true});
  for(const headers of [{}, {...admin(),'x-veyrnox-auth-mfa-at':'1'}, {...admin(),'x-veyrnox-auth-aal':'aal1'}, {...admin(),'cf-access-jwt-assertion':''}]) assert.equal((await handle(req(null,headers))).status,403);
  const denied=creatorHandler({review:true,accessVerifier:async()=>{throw Error('forged')},rpcCall:async()=>{throw Error('must not call')}});
  assert.equal((await denied(req(null,admin()))).status,403);assert.equal(calls.length,0);
});
test('review binds verified identity, freshness, generated request ID and replay key',async()=>{
  const {handle,calls}=setup({review:true,create:true},{id,status:'approved',idempotent:true});
  const res=await handle(req({application_id:id,decision:'approved',reason:'Original work'},admin()));assert.equal(res.status,200);
  const body=await res.json();assert.equal(calls[1].args.p_request_id,body.request_id);assert.equal(calls[1].args.p_auth_id,id);assert.equal(calls[1].args.p_aal,'aal2');assert.equal(calls[1].args.p_idempotency_key,id);
  assert.equal((await handle(req({application_id:id,decision:'approved',reason:'ok',role:'creator'},admin()))).status,400);
});
test('policy failures are stable and unknown provider data is not exposed',async()=>{
  for(const [error,status] of [['account_not_active',403],['not_authorized',403],['idempotency_conflict',409],['already_reviewed',409]]) {
    const {handle}=setup({create:true},{error});assert.equal((await handle(req({statement}))).status,status);
  }
  const {handle}=setup({create:true},{error:'postgres secret detail'});
  const res=await handle(req({statement}));assert.equal(res.status,503);assert.ok(!(await res.text()).includes('postgres'));
});
test('quota failure prevents application operations',async()=>{
  let calls=0;
  const handle=creatorHandler({create:true,rpcCall:async()=>{calls++;return {code:'RATE_LIMITED'}}});
  const res=await handle(req({statement}));assert.equal(res.status,429);assert.equal(calls,1);
});
