import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateSocialCustomerApiRequest, generateSocialCustomerApiKey, hashSocialCustomerApiKey, socialCustomerApiResponse } from '../lib/social/customerApiAuth.js';

Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',PUBLISH_CUSTOMER_API_ENABLED:'true'});
const request=(token)=>new Request('https://veyrnox.test/api/publish/v1/accounts',{headers:token?{authorization:`Bearer ${token}`}:{}});
let calls=[];
function stub(result){calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,args:JSON.parse(init.body)});return Response.json(result);};}

test('customer API keys are random, correctly formatted and hash reproducibly',async()=>{
  const first=await generateSocialCustomerApiKey(),second=await generateSocialCustomerApiKey();
  assert.match(first.token,/^vxpub_[A-Za-z0-9_-]{43}$/);assert.equal(first.prefix,first.token.slice(0,15));assert.notEqual(first.token,second.token);
  assert.equal(first.hash,await hashSocialCustomerApiKey(first.token));assert.match(first.hash,/^[0-9a-f]{64}$/);
});

test('invalid credentials fail before database access',async()=>{
  stub({ok:true});
  for(const token of [null,'wrong','vxpub_short']) assert.equal((await authenticateSocialCustomerApiRequest(request(token),'accounts:read','test')).error.status,401);
  assert.equal(calls.length,0);
});

test('valid credentials authenticate by hash and return key context',async()=>{
  const key=await generateSocialCustomerApiKey();stub({ok:true,key_id:'key',brand_id:'brand',auth_id:'auth'});
  const result=await authenticateSocialCustomerApiRequest(request(key.token),'posts:read','test','/api/publish/v1/accounts');
  assert.deepEqual({keyId:result.keyId,brandId:result.brandId,authId:result.authId},{keyId:'key',brandId:'brand',authId:'auth'});
  assert.deepEqual(calls[0].args,{p_key_hash:key.hash,p_scope:'posts:read',p_method:'GET',p_route:'/api/publish/v1/accounts'});assert.ok(!JSON.stringify(calls).includes(key.token));
});

test('authenticated responses record only bounded outcome metadata',async()=>{
  stub({ok:true});const response=await socialCustomerApiResponse({requestId:17,keyId:'key',cfg:{supabaseUrl:'https://db.test',serviceRoleKey:'test-only'}},{error:'invalid_body'},400,'invalid_body');
  assert.equal(response.status,400);assert.deepEqual(calls[0].args,{p_request_id:17,p_api_key_id:'key',p_status:400,p_error_code:'invalid_body'});
});

test('authentication maps scope, plan and rate-limit failures',async()=>{
  const key=await generateSocialCustomerApiKey();
  for(const [result,status,error] of [[{ok:false,code:'INSUFFICIENT_SCOPE'},403,'insufficient_scope'],[{ok:false,code:'PLAN_REQUIRED'},402,'publish_plan_required'],[{ok:false,code:'RATE_LIMITED',retry_after_seconds:9},429,'rate_limited'],[{ok:false,code:'INVALID_API_KEY'},401,'invalid_api_key']]){
    stub(result);const response=(await authenticateSocialCustomerApiRequest(request(key.token),'accounts:read','test')).error;
    assert.equal(response.status,status);assert.equal((await response.json()).error,error);if(status===429)assert.equal(response.headers.get('retry-after'),'9');
  }
});

test('the rollout switch fails closed',async()=>{
  const previous=process.env.PUBLISH_CUSTOMER_API_ENABLED;process.env.PUBLISH_CUSTOMER_API_ENABLED='false';stub({ok:true});
  const key=await generateSocialCustomerApiKey();assert.equal((await authenticateSocialCustomerApiRequest(request(key.token),'accounts:read','test')).error.status,404);assert.equal(calls.length,0);
  process.env.PUBLISH_CUSTOMER_API_ENABLED=previous;
});
