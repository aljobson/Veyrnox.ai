import test from 'node:test';
import assert from 'node:assert/strict';
import { metaReviewAllowed, metaAvailable } from '../lib/social/metaReview.js';
import { networkReadiness } from '../lib/social/networkReadiness.js';
import { postCapabilityError } from '../lib/social/postCapabilities.js';
const auth = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const env = { PUBLIC_HOST: 'https://veyrnox.ai', PUBLISH_ENABLED: 'true',
 PUBLISH_RELEASED_NETWORKS: 'youtube,linkedin,twitter,tiktok', PUBLISH_EXTENDED_NETWORKS_ENABLED: 'false',
 META_REVIEW_ENABLED: 'true', META_REVIEW_AUTH_IDS: auth,
 META_APP_ID: '2428989684301953', META_APP_SECRET: 'test-only-secret-value',
 SOCIAL_OAUTH_STATE_SECRET: 'test-only-oauth-state-secret-0123456789abcdef', SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') };
test('both Meta platforms require exact server opt-in and verified allowlisted subject', () => {
 for (const network of ['facebook','instagram']) {
  assert.equal(metaReviewAllowed(network, auth, env), true);
  for (const identity of [undefined, '', 'not-uuid', '*', 'review@example.com', other])
   assert.equal(metaReviewAllowed(network, identity, env), false);
  for (const value of [undefined,'','false','TRUE','1'])
   assert.equal(metaReviewAllowed(network, auth, {...env,META_REVIEW_ENABLED:value}),false);
  for (const ids of [undefined,'','*',other,'review@example.com'])
   assert.equal(metaReviewAllowed(network, auth, {...env,META_REVIEW_AUTH_IDS:ids}),false);
  assert.equal(metaReviewAllowed(network, auth.toUpperCase(), {...env,META_REVIEW_AUTH_IDS:`bad, ${auth.toUpperCase()} `}),true);
  assert.equal(metaReviewAllowed(network, auth, {...env,PUBLISH_ENABLED:'false'}),false);
 }
 for (const network of ['threads','tiktok','unknown']) assert.equal(metaReviewAllowed(network,auth,env),false);
});
test('review exception is confined to the production website host', () => {
 for(const PUBLIC_HOST of [undefined,'http://veyrnox.ai','https://veyrnox.ai.evil.test','https://www.veyrnox.ai','https://staging.test','https://veyrnox.ai/path','https://veyrnox.ai?review=1','https://user@veyrnox.ai','https://veyrnox.ai/#review'])
  assert.equal(metaReviewAllowed('facebook',auth,{...env,PUBLIC_HOST}),false);
});
test('readiness opens both Meta controls for reviewer only without opening extended networks', () => {
 for(const network of ['facebook','instagram']) {
  assert.equal(networkReadiness(env,auth).find(n=>n.key===network).available,true);
  for(const subject of [other,undefined]) {
   const n=networkReadiness(env,subject).find(n=>n.key===network);
   assert.equal(n.available,false);assert.equal(n.status,'not_released');
  }
 }
 assert.equal(networkReadiness(env,auth).find(n=>n.key==='threads').available,false);
 assert.equal(networkReadiness({...env,META_APP_SECRET:''},auth).find(n=>n.key==='instagram').status,'setup_required');
});
test('posting and scheduling admission stays closed to other identities, and normal content rules remain', () => {
 for(const network of ['facebook','instagram']) {
  const accounts=[{network}];const image=[{media_type:'image'}];
  assert.equal(postCapabilityError(accounts,image,'review',env,auth),null);
  assert.equal(postCapabilityError(accounts,image,'review',env,other),'network_unavailable');
  assert.equal(postCapabilityError(accounts,image,'review',{...env,META_REVIEW_ENABLED:'false'},auth),'network_unavailable');
  assert.equal(postCapabilityError(accounts,[{media_type:'video'}],'review',env,auth),'unsupported_media_type');
  assert.equal(postCapabilityError(accounts,image,'x'.repeat(5000),env,auth),'caption_too_long');
 }
 assert.equal(postCapabilityError([{network:'threads'}],[{media_type:'image'}],'review',env,auth),'network_unavailable');
});
test('public release remains independently controlled; no implicit change to its list', () => {
 assert.equal(metaAvailable('instagram',other,env),false);
 assert.equal(metaAvailable('instagram',other,{...env,PUBLISH_RELEASED_NETWORKS:'instagram'}),true);
 assert.equal(metaReviewAllowed('instagram',auth,{...env,PUBLISH_RELEASED_NETWORKS:'instagram'}),false);
 assert.equal(env.PUBLISH_RELEASED_NETWORKS,'youtube,linkedin,twitter,tiktok');
});

// Exercise the real route admission before provider/database I/O. Only Next's
// JSON-response wrapper is substituted so these checks need no Next dev server.
import { register } from 'node:module';
const responseModule = 'data:text/javascript,' + encodeURIComponent('export class NextResponse extends Response {}');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { if(s==='next/server') return {url:${JSON.stringify(responseModule)},shortCircuit:true}; return next(s,c); }`));
const { POST: igConnect } = await import('../app/api/v1/social/accounts/instagram/connect/route.js');
const { POST: igCallback } = await import('../app/api/v1/social/accounts/instagram/callback/route.js');
const { startExtendedConnect, finishExtendedConnect } = await import('../lib/social/extendedConnect.js');

test('real connect and callback routes reject ordinary users before provider I/O on both platforms', async () => {
 const keys=[...Object.keys(env),'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const fetcher=globalThis.fetch;let calls=0;
 Object.assign(process.env,env);delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 globalThis.fetch=async()=>{calls++;throw new Error('unexpected external I/O');};
 const request=id=>new Request('https://veyrnox.ai/api/v1/social/accounts/instagram/connect',{
  method:'POST',headers:{'x-veyrnox-auth-id':id,'content-type':'application/json'},body:'{}'});
 const routes=[igConnect,igCallback,r=>startExtendedConnect(r,'facebook'),r=>finishExtendedConnect(r,'facebook')];
 try {
  for(const route of routes) {
   const denied=await route(request(other));assert.equal(denied.status,404);assert.equal((await denied.json()).error,'network_unavailable');
   const review=await route(request(auth));assert.equal(review.status,503); // admitted, but deliberately unconfigured test DB
   process.env.META_REVIEW_ENABLED='false';
   assert.equal((await route(request(auth))).status,404);
   process.env.META_REVIEW_ENABLED='true';
   assert.equal((await route(request('invalid'))).status,401);
  }
  assert.equal((await startExtendedConnect(request(auth),'threads')).status,404);
  assert.equal(calls,0);
 } finally {
  globalThis.fetch=fetcher;
  for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});

test('real post writer admits reviewer Post now and scheduling for each Meta platform only', async () => {
 const { POST } = await import('../app/api/v1/social/posts/route.js');
 const config={...env,SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'local-test-only',PUBLISH_PLANS_ENABLED:'true'};
 const before=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;
 const accountId='33333333-3333-4333-8333-333333333333',brandId='44444444-4444-4444-8444-444444444444';
 Object.assign(process.env,config);
 try {
  for(const network of ['facebook','instagram']) for(const publishNow of [true,false]) {
   for(const scenario of ['reviewer','ordinary','disabled','free','missing_account']) {
    const calls=[];process.env.META_REVIEW_ENABLED=scenario==='disabled'?'false':'true';
    globalThis.fetch=async(url,init)=>{
     assert.equal(new URL(url).origin,'https://db.test');
     const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(init.body);calls.push({name,args});
     return Response.json({
      consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},
      get_or_create_default_social_brand:{ok:true,brand_id:brandId},
      read_social_publish_entitlement:{ok:true,tier:scenario==='free'?'free':'publish',account_limit:scenario==='free'?1:5},
      list_social_accounts:{ok:true,accounts:scenario==='missing_account'?[]:[{id:accountId,network,status:'active'}]},
      create_social_post:{ok:true,post_id:brandId,target_count:1,idempotent:false},
     }[name]);
    };
    const scheduledAt=new Date(Date.now()+3600_000).toISOString();
    const body={...(publishNow?{publishNow:true}:{scheduledAt}),globalText:'Local review test',idempotencyKey:'a'.repeat(20),accountIds:[accountId],media:[{mediaType:'image',jobId:brandId}]};
    const response=await POST(new Request('https://veyrnox.ai/api/v1/social/posts',{method:'POST',headers:{'content-type':'application/json','x-veyrnox-auth-id':scenario==='ordinary'?other:auth},body:JSON.stringify(body)}));
    const result=await response.json();
    const allowed=scenario==='reviewer'||scenario==='free'&&publishNow;
    assert.equal(response.status,allowed?201:scenario==='free'?402:scenario==='missing_account'?404:400,`${network} ${publishNow?'now':'scheduled'} ${scenario}: ${JSON.stringify(result)}`);
    const write=calls.find(c=>c.name==='create_social_post');assert.equal(Boolean(write),allowed);
    if(write){assert.equal(write.args.p_auth_id,auth);assert.deepEqual(write.args.p_account_ids,[accountId]);if(!publishNow)assert.equal(write.args.p_scheduled_at,scheduledAt);}
   }
  }
 } finally {
  globalThis.fetch=originalFetch;
  for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
