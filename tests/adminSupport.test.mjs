import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {readFile} from 'node:fs/promises';
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}"));
const {GET,POST}=await import('../app/api/v1/admin/support/route.js');
const {POST:intake}=await import('../app/api/v1/support/tickets/route.js');
const {supportQuery}=await import('../lib/supportApi.js');
const {refreshRuntimeSwitches}=await import('../lib/runtimeSwitchCache.js');
const uuid='11111111-1111-4111-8111-111111111111';
test('support query rejects arbitrary filters and unsafe cursors',()=>{
 for(const s of ['ticket=bad','ticket=','status=','status=other','before={}','status=open&status=solved','before='+encodeURIComponent(JSON.stringify({id:uuid,created_at:'infinity'})),'q=private'])assert.equal(supportQuery(new URLSearchParams(s)),null);
 assert.deepEqual(supportQuery(new URLSearchParams('status=pending')),{ticket:null,status:'pending',before:null});
});
test('intake defaults off without any I/O; admin gate still refuses anonymous callers',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected network'));
 assert.equal((await intake(new Request('https://test',{method:'POST',headers:{'x-veyrnox-auth-id':uuid}}))).status,404);
 assert.equal((await intake(new Request('https://test',{method:'POST'}))).status,401);
 for(const fn of [GET,POST])assert.equal((await fn(new Request('https://test'))).status,401);
});
test('support boundaries forward verified identity, plain text, fixed audit reason and idempotency',async t=>{
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',ADMIN_REQUIRE_AAL2:'true',ACCESS_TEAM_DOMAIN:'',ACCESS_AUD:''};const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const calls=[];let permissions=['support','support.write'];
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(String(url).includes('/runtime_switches?'))return Response.json([{key:'support_intake',state:'on'}]);calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json(String(url).endsWith('/admin_permissions')?{ok:true,permissions}:String(url).endsWith('/admin_support_agent_log')?{ok:true,runs:[]}:{ok:true,tickets:[],messages:[]});});
 await refreshRuntimeSwitches();
 const headers={'x-veyrnox-auth-id':uuid,'x-veyrnox-auth-aal':'aal2','idempotency-key':'support-test-001','content-type':'application/json'};
 const req=b=>new Request('https://test',{method:'POST',headers,body:JSON.stringify(b)});
 assert.equal((await intake(req({subject:'Help',category:'account',body:'<b>literal text</b>'}))).status,200);assert.equal(calls.at(-1).body.p_auth_id,uuid);assert.equal(calls.at(-1).body.p_body,'<b>literal text</b>');
 for(const b of [{subject:'Help',category:'account',body:'text',user_id:uuid},{subject:'x'.repeat(201),category:'account',body:'text'}])assert.equal((await intake(req(b))).status,400);
 const body={action:'reply',ticket:uuid,body:'Plain reply',reason:'support-reply'};
 for(const b of [{...body,action:['reply']},{...body,ticket:[uuid]},{...body,reason:'secret'},{...body,body:'x'.repeat(5001)},{...body,author_kind:'agent'}])assert.equal((await POST(req(b))).status,400);
 permissions=['plans.read'];assert.equal((await POST(req(body))).status,403);
 permissions=['support','support.write'];const reply=await POST(req(body));assert.equal(reply.status,200);assert.equal(reply.headers.get('cache-control'),'no-store');assert.equal(calls.at(-1).body.p_reason,'support-reply');
 assert.equal((await GET(new Request('https://test?ticket='+uuid,{headers}))).status,200);
 assert.ok(calls.some(c=>c.url.endsWith('/admin_support_agent_log')));
});
test('support source keeps content out of immutable audit and renders text without HTML',async()=>{
 const sql=await readFile(new URL('../packages/db/schema/supabase/0432_admin_support.sql',import.meta.url),'utf8');
 assert.match(sql,/AFTER UPDATE OF deleted_at ON public.users/);assert.match(sql,/BEFORE DELETE ON public.users/);assert.doesNotMatch(sql,/pg_advisory_xact_lock\(427,0\)/);assert.equal((sql.match(/pg_advisory_xact_lock\(431,0\)/g)||[]).length,3);assert.match(sql,/FUNCTION private.erase_support_for_user/);assert.match(sql,/sha256\(convert_to/);
 const page=await readFile(new URL('../app/veyrnox/app/admin/support/page.js',import.meta.url),'utf8');assert.doesNotMatch(page,/dangerouslySetInnerHTML|innerHTML|Resend|resend/);assert.match(page,/\{m.body\}/);
});
