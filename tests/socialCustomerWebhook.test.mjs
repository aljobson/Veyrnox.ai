import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken } from '../lib/social/tokenCrypto.js';
import { generateSocialWebhookSecret, normalizeSocialWebhookEvents, runSocialCustomerWebhookSweep, signSocialWebhook, validateSocialWebhookUrl } from '../lib/social/customerWebhook.js';

const cryptoCfg={raw:new Uint8Array(32).fill(7)};
const cfg={supabaseUrl:'https://db.test',serviceRoleKey:'service'};

test('webhook destinations allow public HTTPS URLs and reject local or credentialed targets',()=>{
  assert.equal(validateSocialWebhookUrl('https://hooks.example.com/veyrnox?tenant=1'),'https://hooks.example.com/veyrnox?tenant=1');
  for(const value of ['http://hooks.example.com','https://localhost/hook','https://127.0.0.1/hook','https://10.0.0.4/hook','https://[::1]/hook','https://metadata.google.internal/hook','https://user:pass@example.com/hook','https://example.com:8443/hook','https://internal/hook']) assert.equal(validateSocialWebhookUrl(value),null,value);
});

test('event normalization deduplicates known events and rejects unknown events',()=>{
  assert.deepEqual(normalizeSocialWebhookEvents(['post.published','post.published','post.failed']),['post.published','post.failed']);
  assert.equal(normalizeSocialWebhookEvents([]),null);
  assert.equal(normalizeSocialWebhookEvents(['post.deleted']),null);
});

test('webhook secrets and signatures have stable public formats',async()=>{
  assert.match(generateSocialWebhookSecret(),/^vxwhsec_[A-Za-z0-9_-]{43}$/);
  assert.equal(await signSocialWebhook('secret','1700000000','{"ok":true}'),'c1afc7c2df3db0690d7d75954610ed1a1d959ce96355ccb8c0a8bc09fd0cfc27');
});

test('sweep signs a claimed event and records a successful delivery',async()=>{
  const secret='vxwhsec_test-only-secret',payload={id:'event-id',type:'post.published'};
  const secretEnc=await encryptToken(secret,cryptoCfg),calls=[];
  const rpcCall=async(name,args)=>{calls.push({name,args});if(name==='claim_social_webhook_deliveries')return{ok:true,events:[{id:'11111111-1111-4111-8111-111111111111',claim_key:'22222222-2222-4222-8222-222222222222',event_type:'post.published',url:'https://hooks.example.com/events',secret_enc:secretEnc,payload}]};return{ok:true,outcome:'delivered'};};
  let sent;
  const result=await runSocialCustomerWebhookSweep({cfg,cryptoCfg,env:{PUBLISH_CUSTOMER_WEBHOOKS_ENABLED:'true'},rpcCall,now:()=>1700000000000,fetcher:async(url,init)=>{sent={url,init};return new Response(null,{status:204});}});
  assert.deepEqual(result,{ok:true,claimed:1,delivered:1,failed:0});
  assert.equal(sent.url,'https://hooks.example.com/events');
  assert.equal(sent.init.redirect,'manual');
  assert.equal(sent.init.headers['X-Veyrnox-Timestamp'],'1700000000');
  assert.equal(sent.init.headers['X-Veyrnox-Delivery'],'11111111-1111-4111-8111-111111111111');
  assert.equal(sent.init.headers['X-Veyrnox-Signature'],`v1=${await signSocialWebhook(secret,'1700000000',JSON.stringify(payload))}`);
  assert.deepEqual(calls.at(-1),{name:'complete_social_webhook_delivery',args:{p_event_id:'11111111-1111-4111-8111-111111111111',p_claim_key:'22222222-2222-4222-8222-222222222222',p_success:true,p_status:204,p_error:null}});
});

test('sweep fails closed and records bounded transport errors without secret material',async()=>{
  const rpcCalls=[];let fetches=0;
  const rpcCall=async(name,args)=>{rpcCalls.push({name,args});if(name==='claim_social_webhook_deliveries')return{ok:true,events:[{id:'e',claim_key:'c',event_type:'post.failed',url:'https://127.0.0.1/hook',secret_enc:'00',payload:{}}]};return{ok:true,outcome:'retrying'};};
  const result=await runSocialCustomerWebhookSweep({cfg,cryptoCfg,env:{PUBLISH_CUSTOMER_WEBHOOKS_ENABLED:'true'},rpcCall,fetcher:async()=>{fetches++;return new Response();}});
  assert.deepEqual(result,{ok:true,claimed:1,delivered:0,failed:1});assert.equal(fetches,0);assert.equal(rpcCalls.at(-1).args.p_error,'unsafe_destination');
  assert.deepEqual(await runSocialCustomerWebhookSweep({cfg,cryptoCfg,env:{PUBLISH_CUSTOMER_WEBHOOKS_ENABLED:'false'},rpcCall}),{ok:true,skipped:'disabled'});
});
