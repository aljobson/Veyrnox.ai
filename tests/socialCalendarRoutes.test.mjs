import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){return n(s==='next/server'?'next/server.js':s,c);}`));
const {GET}=await import('../app/api/v1/social/calendar/route.js');
const {PATCH}=await import('../app/api/v1/social/posts/[id]/schedule/route.js');
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true',PUBLISH_CALENDAR_ENABLED:'true'});
const auth='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const valid='?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';
const body={expectedAt:'2026-10-04T10:00:00Z',scheduledAt:'2026-10-05T10:00:00Z'};
const req=(query='',data,identity=auth)=>new Request('https://veyrnox.test/api/v1/social/calendar'+query,{headers:{'x-veyrnox-auth-id':identity},...(data?{method:'PATCH',body:JSON.stringify(data)}:{})});
const ctx={params:Promise.resolve({id})};
let calls=[];
function stub(results={}){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop();calls.push({name,args:JSON.parse(init.body)});const r=results[name]??({consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:id},list_social_calendar:{ok:true,posts:[],next:null},reschedule_social_post:{ok:true,scheduled_at:body.scheduledAt,idempotent:false}})[name];if(r instanceof Error)throw r;return Response.json(r);};}
test('identity and calendar gates precede database calls',async()=>{
    stub();assert.equal((await GET(req(valid,undefined,''))).status,401);
    process.env.PUBLISH_CALENDAR_ENABLED='false';assert.equal((await GET(req(valid))).status,503);assert.equal((await PATCH(req('',body),ctx)).status,503);
    process.env.PUBLISH_CALENDAR_ENABLED='true';assert.equal(calls.length,0);
});
test('bounded calendar query validates filters and paired cursor then returns uncached owner data',async()=>{
    for(const q of ['','?from=infinity&to=infinity',valid+'&status=draft',valid+'&network=unknown',valid+'&after_id='+id,'?from=2026-01-01T00:00:00Z&to=2026-11-01T00:00:00Z']){stub();assert.equal((await GET(req(q))).status,400);assert.equal(calls.length,0);}
    stub();const res=await GET(req(valid+'&status=scheduled&network=tiktok'));assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
    assert.deepEqual(calls.at(-1).args,{p_auth_id:auth,p_brand_id:id,p_from:'2026-10-01T00:00:00Z',p_to:'2026-11-01T00:00:00Z',p_status:'scheduled',p_network:'tiktok',p_after_at:null,p_after_id:null});
});
test('reschedule validates identity and body then passes compare-and-set timestamps',async()=>{
    stub();assert.equal((await PATCH(req('',body,''),ctx)).status,401);
    assert.equal((await PATCH(req('',{...body,expectedAt:'invalid'}),ctx)).status,400);assert.equal(calls.length,0);
    const res=await PATCH(req('',body),ctx);assert.equal(res.status,200);
    assert.deepEqual(calls.at(-1),{name:'reschedule_social_post',args:{p_auth_id:auth,p_post_id:id,p_expected_at:body.expectedAt,p_scheduled_at:body.scheduledAt}});
});
test('calendar UTC database cursors round-trip without plus signs or lost microseconds',async()=>{
    for(const at of ['2026-10-31T12:00:00+00:00','2026-10-31T12:00:00.123456+00:00','2026-10-31T12:00:00Z']){
        stub({list_social_calendar:{ok:true,posts:[{id}],next:{at,id}}});
        const first=await (await GET(req(valid))).json();
        assert.deepEqual(first.next,{at:at.replace('+00:00','Z'),id});
        assert.deepEqual(first.posts,[{id}]);
        const query=new URLSearchParams({after_at:first.next.at,after_id:first.next.id});
        assert.ok(!query.toString().includes('%2B'));
        stub();assert.equal((await GET(req(valid+'&'+query))).status,200);
        assert.equal(calls.at(-1).args.p_after_at,first.next.at);
        assert.equal(calls.at(-1).args.p_after_id,id);
    }
    stub();assert.equal((await GET(req(valid+'&'+new URLSearchParams({after_at:'2026-10-31T13:00:00+01:00',after_id:id})))).status,200);
    assert.equal(calls.at(-1).args.p_after_at,'2026-10-31T13:00:00+01:00');
});
test('reschedule handles stale/started posts, owner refusals and rate limits without leaking database data',async()=>{
    for(const [code,status] of [['POST_BUSY',409],['POST_STARTED',409],['SCHEDULE_CHANGED',409],['POST_NOT_FOUND',404],['USER_NOT_FOUND',401],['INVALID_SCHEDULE',400]]){
        stub({reschedule_social_post:{ok:false,code,secret:'private'}});const res=await PATCH(req('',body),ctx);assert.equal(res.status,status);assert.ok(!(await res.text()).includes('private'));
    }
    stub({consume_social_post_write_request:{ok:false,code:'RATE_LIMITED'}});assert.equal((await PATCH(req('',body),ctx)).status,429);assert.equal(calls.length,1);
    stub({reschedule_social_post:new Error('private')});assert.deepEqual(await (await PATCH(req('',body),ctx)).json(),{error:'internal'});
});
