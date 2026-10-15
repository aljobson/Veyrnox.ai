import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET, PUT, DELETE } = await import('../app/api/v1/social/presets/route.js');
const auth='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222',preset='33333333-3333-4333-8333-333333333333',account='44444444-4444-4444-8444-444444444444';
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',PUBLISH_CONTENT_PRESETS_ENABLED:'true',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true'});
const request=(method='GET',body,url='https://veyrnox.test/api/v1/social/presets')=>new Request(url,{method,headers:{'x-veyrnox-auth-id':auth,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
let calls=[];
function stub(overrides={}){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop();const args=JSON.parse(init.body);calls.push({name,args});return Response.json(overrides[name]??({consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:brand},list_social_content_presets:{ok:true,presets:[{id:preset,name:'Launch',caption:'Hello',account_ids:[account]}]},save_social_content_preset:{ok:true,preset_id:preset},delete_social_content_preset:{ok:true}})[name]);};}

test('lists paid presets through the caller brand without caching',async()=>{stub();const res=await GET(request());assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual((await res.json()).presets[0].account_ids,[account]);assert.equal(calls.at(-1).name,'list_social_content_presets');});

test('validates a preset before consuming the write bucket',async()=>{stub();const res=await PUT(request('PUT',{name:'',caption:'Hello',accountIds:[account]}));assert.equal(res.status,400);assert.equal(calls.length,0);});

test('saves bounded caption and destination values and maps name conflicts',async()=>{stub({save_social_content_preset:{ok:false,code:'PRESET_NAME_TAKEN'}});const res=await PUT(request('PUT',{name:' Launch ',caption:'Hello',accountIds:[account]}));assert.equal(res.status,409);assert.equal(calls.at(-1).name,'save_social_content_preset');assert.deepEqual(calls.at(-1).args.p_account_ids,[account]);assert.equal(calls.at(-1).args.p_name,'Launch');});

test('deletes only a valid preset id',async()=>{stub();const bad=await DELETE(request('DELETE',null,'https://veyrnox.test/api/v1/social/presets?id=bad'));assert.equal(bad.status,400);assert.equal(calls.length,0);const res=await DELETE(request('DELETE',null,`https://veyrnox.test/api/v1/social/presets?id=${preset}`));assert.equal(res.status,200);assert.equal(calls.at(-1).name,'delete_social_content_preset');});

test('feature flag fails closed after authenticating the request shape',async()=>{const previous=process.env.PUBLISH_CONTENT_PRESETS_ENABLED;process.env.PUBLISH_CONTENT_PRESETS_ENABLED='false';try{stub();const res=await GET(request());assert.equal(res.status,404);assert.equal(calls.length,0);}finally{process.env.PUBLISH_CONTENT_PRESETS_ENABLED=previous;}});
