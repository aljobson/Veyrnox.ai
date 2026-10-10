import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const route=await import('../app/api/v1/account/route.js');
const auth='aaaaaaaa-1111-4111-8111-111111111111';
const req=()=>new Request('https://veyrnox.test/api/v1/account',{headers:{'x-veyrnox-auth-id':auth}});
const realFetch=globalThis.fetch;
const previous={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,FILM_LIBRARY_MASTERS_ENABLED:process.env.FILM_LIBRARY_MASTERS_ENABLED};
test.afterEach(()=>{globalThis.fetch=realFetch;for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
function setup(enabled,masterReply={ok:true,masters:[{id:'master'}]}){
 Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',FILM_LIBRARY_MASTERS_ENABLED:enabled});
 const calls=[];
 globalThis.fetch=async(url,init)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path.endsWith('/read_user_credits'))return Response.json({balance:0});
  if(path.endsWith('/users'))return Response.json([{id:auth}]);
  if(path.endsWith('/assets'))return new Response(null,{status:200,headers:{'Content-Range':'0-23/24'}});
  if(path.endsWith('/list_film_library_masters')){assert.deepEqual(JSON.parse(init.body),{p_auth_id:auth});return Response.json(masterReply);}
  assert.fail(path);
 };
 return calls;
}
test('the account count includes private saved masters without changing its zero credit balance',async()=>{
 const calls=setup('true');const r=await route.GET(req());assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.assets,25);assert.equal(body.credits,0);assert.equal(calls.filter(p=>p.endsWith('/list_film_library_masters')).length,1);
});
test('disabled rollout keeps the original count and makes no master read',async()=>{
 const calls=setup('false');const body=await(await route.GET(req())).json();assert.equal(body.assets,24);assert.equal(body.credits,0);
 assert.equal(calls.some(p=>p.endsWith('/list_film_library_masters')),false);
});
test('an unavailable master count renders an unknown asset count while preserving credits',async()=>{
 setup('true',{ok:false,code:'RATE_LIMITED'});const body=await(await route.GET(req())).json();assert.equal(body.assets,null);assert.equal(body.credits,0);
});
