import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}"));
const {GET,POST}=await import('../app/api/v1/admin/plans/route.js');
test('plans route validates input, permissions and verified freshness; returns guard counts',async t=>{
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',ADMIN_REQUIRE_AAL2:'true',ACCESS_TEAM_DOMAIN:'',ACCESS_AUD:''};
 const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const headers={'x-veyrnox-auth-id':'11111111-1111-4111-8111-111111111111','x-veyrnox-auth-aal':'aal2','x-veyrnox-auth-mfa-at':String(Math.floor(Date.now()/1000)),'idempotency-key':'catalog-test-001','content-type':'application/json'};
 let permissions=['plans.read'],calls=[],result={ok:true,plans:[],packs:[],history:[]};
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json(String(url).endsWith('admin_permissions')?{ok:true,permissions}:result);});
 const request=(body,h=headers)=>new Request('https://test/api/v1/admin/plans',{method:'POST',headers:h,body:JSON.stringify(body)});
 const body={kind:'pack',id:'web-209',active:false,reason:'Pause sale'};
 assert.equal((await GET(new Request('https://test',{headers}))).status,200);
 assert.equal((await POST(request(body))).status,403);
 permissions=['plans.read','plans.write'];calls=[];
 for(const b of [{...body,price_usd_cents:1},{...body,active:'false'},{...body,p_aal:'aal2'},{...body,reason:''}])assert.equal((await POST(request(b))).status,400);
 assert.equal(calls.length,0);
 assert.equal((await POST(request(body,{...headers,'x-veyrnox-auth-mfa-at':'invalid'}))).status,403);
 result={ok:false,code:'plan_in_use',counts:{unsettled_top_ups:2}};
 const r=await POST(request(body));assert.equal(r.status,409);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual((await r.json()).counts,{unsettled_top_ups:2});
 assert.equal(calls.at(-1).p_aal,'aal2');assert.equal(calls.at(-1).p_mfa_at,new Date(Number(headers['x-veyrnox-auth-mfa-at'])*1000).toISOString());
});
test('catalog availability leaves settlement and public cache contracts intact',async()=>{
 const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
 const sql=await read('packages/db/schema/supabase/0430_admin_plans.sql');
 assert.match(sql,/status='pending'\s+AND created_at>=clock_timestamp\(\)-interval '3 hours'/);assert.match(sql,/p_kind='subscription'[\s\S]*?plan_read_only/);
 assert.doesNotMatch(sql,/UPDATE public.credit_subscription_plans|SET (?:price_usd_cents|credits)|pack_parity_group/);
 assert.match(sql,/AS matching_store_packs/);
 const settlement=await read('packages/db/schema/supabase/0413_pre_credit_dispute_persistence.sql');
 assert.doesNotMatch(settlement.slice(settlement.indexOf('FUNCTION public.credit_top_up(')),/credit_packs|p\.active/);
 assert.match(await read('app/api/credit-packs/route.js'),/CACHE_TTL_SECONDS = 300/);
 assert.match(await read('lib/subscriptions/api.js'),/no-store/);
});

test('one admin pack allowlist matches the checkout launch catalog',async()=>{
 const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
 const sql=await read('packages/db/schema/supabase/0430_admin_plans.sql');
 const ids=sql.match(/SELECT ARRAY\[([^\]]+)\]::text\[\]/)[1].split(',').map(s=>s.replaceAll("'",''));
 const launch=await read('packages/db/schema/supabase/0420_packs_match_subscription_rate.sql');
 const catalog=[...launch.matchAll(/\('(web-[0-9]+)', 'web', [0-9]+, [0-9]+, true\)/g)].map(m=>m[1]);
 assert.deepEqual(ids,catalog);
 for(const id of ids)assert.equal(sql.split("'"+id+"'").length-1,1,'IDs are defined once');
 assert.match(sql,/p\.id=ANY\(public\.admin_editable_pack_ids\(\)\)/);
 assert.match(sql,/NOT p_id=ANY\(public\.admin_editable_pack_ids\(\)\)/);
 // Checkout has a shape validator and an active-web DB catalog, not a code ID list.
 assert.match(await read('app/api/v1/top-ups/route.js'),/PACK_ID_RE\.test\(body\.pack_id\)/);
 assert.match(await read('packages/db/schema/supabase/0344_store_purchases.sql'),/p\.active AND p\.sales_channel = 'web'/);
});
