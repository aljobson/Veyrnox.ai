import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { GET, PUT } = await import('../app/api/v1/social/smartlink/route.js');
const auth='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222';
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',PUBLISH_SMARTLINKS_ENABLED:'true',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true'});
const request=(method='GET',body)=>new Request('https://veyrnox.test/api/v1/social/smartlink',{method,headers:{'x-veyrnox-auth-id':auth,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
let calls=[];
function stub(overrides={}){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop();const args=JSON.parse(init.body);calls.push({name,args});return Response.json(overrides[name]??({consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:brand},get_social_smartlink_editor:{ok:true,smartlink:null,items:[],totals:{views:0,clicks:0}},save_social_smartlink:{ok:true,smartlink_id:'33333333-3333-4333-8333-333333333333'}})[name]);};}

test('reads the paid SmartLink editor through the caller brand',async()=>{stub();const res=await GET(request());assert.equal(res.status,200);assert.deepEqual(await res.json(),{brand_id:brand,smartlink:null,items:[],totals:{views:0,clicks:0}});assert.equal(calls.at(-1).name,'get_social_smartlink_editor');});

test('validates the full SmartLink payload before consuming the write bucket',async()=>{stub();const res=await PUT(request('PUT',{slug:'Bad Slug',title:'Veyrnox',bio:'',avatarUrl:'',theme:'midnight',published:true,items:[]}));assert.equal(res.status,400);assert.equal(calls.length,0);});

test('saves only bounded HTTPS destinations and maps slug conflicts',async()=>{stub({save_social_smartlink:{ok:false,code:'SLUG_TAKEN'}});const res=await PUT(request('PUT',{slug:'veyrnox-ai',title:'Veyrnox',bio:'Create and publish',avatarUrl:'',theme:'sunset',published:true,items:[{label:'Start creating',url:'https://veyrnox.ai/app/create',enabled:true}]}));assert.equal(res.status,409);assert.equal(calls.at(-1).name,'save_social_smartlink');assert.deepEqual(calls.at(-1).args.p_items,[{label:'Start creating',url:'https://veyrnox.ai/app/create',enabled:true}]);});

test('feature flag fails closed',async()=>{const previous=process.env.PUBLISH_SMARTLINKS_ENABLED;process.env.PUBLISH_SMARTLINKS_ENABLED='false';try{stub();const res=await GET(request());assert.equal(res.status,404);assert.equal(calls.length,0);}finally{process.env.PUBLISH_SMARTLINKS_ENABLED=previous;}});

test('retains destination IDs on save and rejects malformed IDs',async()=>{
 const id='44444444-4444-4444-8444-444444444444';
 const body={slug:'veyrnox-ai',title:'Veyrnox',theme:'midnight',published:false,items:[{id,label:'Home',url:'https://veyrnox.ai',enabled:true}]};
 stub();assert.equal((await PUT(request('PUT',body))).status,200);assert.equal(calls.at(-1).args.p_items[0].id,id);
 stub();body.items[0].id='invalid';assert.equal((await PUT(request('PUT',body))).status,400);assert.equal(calls.length,0);
});
