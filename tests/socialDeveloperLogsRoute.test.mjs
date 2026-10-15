import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));

Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',PUBLISH_CUSTOMER_API_ENABLED:'true'});
const {GET}=await import('../app/api/v1/social/developer/logs/route.js');
const auth='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222';
let calls=[];
function stub(){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(init.body);calls.push({name,args});if(name==='get_or_create_default_social_brand')return Response.json({ok:true,brand_id:brand,label:'Veyrnox'});if(name==='list_social_api_request_logs')return Response.json({ok:true,logs:[{id:1,method:'GET',route:'/api/publish/v1/accounts',response_status:200}]});return Response.json({ok:true});};}
const request=(query='')=>new Request(`https://veyrnox.test/api/v1/social/developer/logs${query}`,{headers:{'x-veyrnox-auth-id':auth}});

test('developer logs validate filters and return the safe request history',async()=>{stub();const response=await GET(request('?status=success&route=%2Fapi%2Fpublish%2Fv1%2Faccounts&q=production&limit=25'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{logs:[{id:1,method:'GET',route:'/api/publish/v1/accounts',response_status:200}]});const listed=calls.find((call)=>call.name==='list_social_api_request_logs');assert.deepEqual(listed.args,{p_auth_id:auth,p_brand_id:brand,p_status:'success',p_route:'/api/publish/v1/accounts',p_query:'production',p_limit:25});});

test('developer logs reject unsupported filters before brand or database work',async()=>{stub();const response=await GET(request('?status=warning'));assert.equal(response.status,400);assert.equal(calls.length,0);});

test('developer logs fail closed when the rollout switch is disabled',async()=>{const previous=process.env.PUBLISH_CUSTOMER_API_ENABLED;process.env.PUBLISH_CUSTOMER_API_ENABLED='false';stub();const response=await GET(request());assert.equal(response.status,404);assert.equal(calls.length,0);process.env.PUBLISH_CUSTOMER_API_ENABLED=previous;});
