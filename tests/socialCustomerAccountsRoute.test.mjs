import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSocialCustomerApiKey } from '../lib/social/customerApiAuth.js';
const {GET}=await import('../app/api/publish/v1/accounts/route.js');
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',PUBLISH_CUSTOMER_API_ENABLED:'true',PUBLISH_RELEASED_NETWORKS:'instagram'});
const key=await generateSocialCustomerApiKey();
let calls=[];function stub(){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop();calls.push({name,args:JSON.parse(init.body)});return Response.json(name==='authenticate_social_api_key'?{ok:true,key_id:'k',brand_id:'22222222-2222-4222-8222-222222222222',auth_id:'11111111-1111-4111-8111-111111111111'}:{ok:true,accounts:[{id:'a1',network:'instagram',external_account_id:'ig',display_name:'Veyrnox',status:'active',access_token_enc:'secret'}]});};}

test('customer accounts endpoint returns only safe account fields and records its outcome',async()=>{stub();const response=await GET(new Request('https://veyrnox.test/api/publish/v1/accounts',{headers:{authorization:`Bearer ${key.token}`}}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.data[0].publishing_enabled,true);assert.deepEqual(body.data[0].supported_media,['image']);assert.ok(!JSON.stringify(body).includes('secret'));assert.deepEqual(calls.map(c=>c.name),['authenticate_social_api_key','list_social_accounts','complete_social_api_key_request']);assert.equal(calls[2].args.p_status,200);});
