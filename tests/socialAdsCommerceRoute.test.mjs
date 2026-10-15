import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const ads=await import('../app/api/v1/social/ads/route.js');
const commerce=await import('../app/api/v1/social/commerce/products/route.js');

const auth='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true',PUBLISH_RUNTIME_FLAGS:'{"plans":"true","ads":"true","commerce":"true"}'});
let calls;
function stub(){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop();calls.push({name,args:JSON.parse(init.body)});return Response.json(({consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:brand,role:'owner'},list_social_ad_campaigns:{ok:true,campaigns:[{id,name:'Launch'}]},save_social_ad_campaign:{ok:true,campaign_id:id,created:true},delete_social_ad_campaign:{ok:true},list_social_commerce_products:{ok:true,products:[{id,title:'Hat'}]},save_social_commerce_product:{ok:true,product_id:id,created:true},archive_social_commerce_product:{ok:true}})[name]);};}
const request=(path,options={})=>new Request(`https://veyrnox.test${path}`,{headers:{'x-veyrnox-auth-id':auth},...options});

test('lists and stores an ad campaign draft without launching a provider campaign',async()=>{stub();const listed=await ads.GET(request('/api/v1/social/ads'));assert.equal(listed.status,200);const saved=await ads.PUT(request('/api/v1/social/ads',{method:'PUT',body:JSON.stringify({name:'Launch',network:'meta',mode:'standalone',objective:'traffic',dailyBudgetCents:1500,currency:'GBP',audience:{locations:['UK'],interests:['AI'],ageMin:18,ageMax:65},destinationUrl:'https://veyrnox.ai',leadFormUrl:'',startsAt:null,endsAt:null})}));assert.equal(saved.status,201);assert.equal(calls.at(-1).name,'save_social_ad_campaign');assert.equal(calls.some(call=>/launch|provider/.test(call.name)),false);});

test('rejects malformed campaign input before storage',async()=>{stub();const response=await ads.PUT(request('/api/v1/social/ads',{method:'PUT',body:JSON.stringify({name:'Bad',network:'meta',mode:'boost',objective:'traffic',dailyBudgetCents:10,currency:'GBP',audience:{}})}));assert.equal(response.status,400);assert.equal(calls.length,0);});

test('lists, stores and archives manual commerce products',async()=>{stub();const listed=await commerce.GET(request('/api/v1/social/commerce/products'));assert.equal(listed.status,200);const saved=await commerce.PUT(request('/api/v1/social/commerce/products',{method:'PUT',body:JSON.stringify({title:'Hat',description:'Warm',currency:'GBP',priceCents:2500,compareAtPriceCents:null,inventoryQuantity:4,productUrl:'https://veyrnox.ai/hat',imageUrl:'',collections:['Winter'],variants:[{title:'Blue',sku:'HAT-BLUE',priceCents:2500,inventoryQuantity:4}],discount:{type:'percent',value:1000}})}));assert.equal(saved.status,201);assert.equal(calls.at(-1).name,'save_social_commerce_product');const archived=await commerce.DELETE(request(`/api/v1/social/commerce/products?id=${id}`,{method:'DELETE'}));assert.equal(archived.status,200);assert.equal(calls.at(-1).name,'archive_social_commerce_product');});

test('rejects malformed products before storage',async()=>{stub();const response=await commerce.PUT(request('/api/v1/social/commerce/products',{method:'PUT',body:JSON.stringify({title:'Hat',currency:'GBP',priceCents:100,inventoryQuantity:0,collections:[],variants:[{title:'',priceCents:100,inventoryQuantity:0}]})}));assert.equal(response.status,400);assert.equal(calls.length,0);});
