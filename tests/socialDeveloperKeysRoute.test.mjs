import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const {GET,POST,DELETE}=await import('../app/api/v1/social/developer/keys/route.js');
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',PUBLISH_CUSTOMER_API_ENABLED:'true',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true',PUBLISH_TEAMS_ENABLED:'false'});
const auth='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222',keyId='33333333-3333-4333-8333-333333333333';
const request=(url='https://veyrnox.test/api/v1/social/developer/keys',options={})=>new Request(url,{...options,headers:{'x-veyrnox-auth-id':auth,'content-type':'application/json',...(options.headers||{})}});
let calls=[];function stub(overrides={}){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(init.body);calls.push({name,args});const result=overrides[name]??({consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:brand,label:'Veyrnox'},list_social_api_keys:{ok:true,keys:[]},create_social_api_key:{ok:true,key_id:keyId},revoke_social_api_key:{ok:true}})[name];return Response.json(result);};}

test('API keys can be listed without secret material',async()=>{stub({list_social_api_keys:{ok:true,keys:[{id:keyId,label:'Automation',key_prefix:'vxpub_abc12345',scopes:['accounts:read']}]}});const response=await GET(request());assert.equal(response.status,200);const body=await response.json();assert.equal(body.keys[0].key_prefix,'vxpub_abc12345');assert.ok(!JSON.stringify(body).includes('key_hash'));});

test('creating a key returns it once and stores only its hash',async()=>{stub();const response=await POST(request(undefined,{method:'POST',body:JSON.stringify({label:'Production',expiresInDays:90,scopes:['accounts:read','posts:write']})}));assert.equal(response.status,201);const body=await response.json();assert.match(body.api_key,/^vxpub_[A-Za-z0-9_-]{43}$/);const create=calls.find(c=>c.name==='create_social_api_key');assert.match(create.args.p_key_hash,/^[0-9a-f]{64}$/);assert.ok(!JSON.stringify(create).includes(body.api_key));assert.deepEqual(create.args.p_scopes,['accounts:read','posts:write']);});

test('invalid key requests stop before write rate limiting',async()=>{stub();const response=await POST(request(undefined,{method:'POST',body:JSON.stringify({label:'',expiresInDays:90,scopes:[]})}));assert.equal(response.status,400);assert.equal(calls.length,0);});

test('a key can be revoked',async()=>{stub();const response=await DELETE(request(`https://veyrnox.test/api/v1/social/developer/keys?id=${keyId}`,{method:'DELETE'}));assert.equal(response.status,200);assert.deepEqual(calls.find(c=>c.name==='revoke_social_api_key').args,{p_auth_id:auth,p_brand_id:brand,p_key_id:keyId});});
