import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){return n(s==='next/server'?'next/server.js':s,c);}`));
const {GET}=await import('../app/api/v1/social/calendar/route.js');
const {PATCH:reschedule}=await import('../app/api/v1/social/posts/[id]/schedule/route.js');
const {PATCH:updatePost}=await import('../app/api/v1/social/posts/[id]/route.js');
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',ACCOUNT_READ_RATE_LIMIT_ENABLED:'true',PUBLISH_CALENDAR_ENABLED:'true'});
const auth='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const valid='?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';
const body={expectedAt:'2026-10-04T10:00:00Z',scheduledAt:'2026-10-05T10:00:00Z'};
const updatedAt='2026-10-03T10:00:00Z';
const restoreAt=new Date(Date.now()+86400000).toISOString();
const req=(query='',data,identity=auth)=>new Request('https://veyrnox.test/api/v1/social/calendar'+query,{headers:{'x-veyrnox-auth-id':identity},...(data?{method:'PATCH',body:JSON.stringify(data)}:{})});
const ctx={params:Promise.resolve({id})};
let calls=[];
function stub(results={}){calls=[];globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').pop();calls.push({name,args:JSON.parse(init.body)});const r=results[name]??({consume_account_read_request:{ok:true},consume_social_post_write_request:{ok:true},get_or_create_default_social_brand:{ok:true,brand_id:id},social_brand_contains_post:{ok:true},list_social_calendar:{ok:true,posts:[],next:null},reschedule_social_post:{ok:true,scheduled_at:body.scheduledAt,idempotent:false},cancel_social_post:{ok:true,updated_at:updatedAt,idempotent:false},restore_social_post:{ok:true,scheduled_at:body.scheduledAt,updated_at:updatedAt,idempotent:false},read_social_publish_entitlement:{ok:true,tier:'publish',account_limit:5,analytics_days:366,best_time_enabled:true,subscription:{id:'paid'}}})[name];if(r instanceof Error)throw r;return Response.json(r);};}
test('identity and calendar gates precede database calls',async()=>{
    stub();assert.equal((await GET(req(valid,undefined,''))).status,401);
    process.env.PUBLISH_CALENDAR_ENABLED='false';assert.equal((await GET(req(valid))).status,503);assert.equal((await reschedule(req('',body),ctx)).status,503);assert.equal((await updatePost(req('',{action:'cancel',expectedUpdatedAt:updatedAt}),ctx)).status,503);
    process.env.PUBLISH_CALENDAR_ENABLED='true';assert.equal(calls.length,0);
});
test('bounded calendar query validates filters and paired cursor then returns uncached owner data',async()=>{
    for(const q of ['','?from=infinity&to=infinity',valid+'&status=draft',valid+'&network=unknown',valid+'&after_id='+id,'?from=2026-01-01T00:00:00Z&to=2026-11-01T00:00:00Z']){stub();assert.equal((await GET(req(q))).status,400);assert.equal(calls.length,0);}
    stub();const res=await GET(req(valid+'&status=scheduled&network=tiktok'));assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
    assert.deepEqual(calls.at(-1).args,{p_auth_id:auth,p_brand_id:id,p_from:'2026-10-01T00:00:00Z',p_to:'2026-11-01T00:00:00Z',p_status:'scheduled',p_network:'tiktok',p_after_at:null,p_after_id:null});
});
test('reschedule validates identity and body then passes compare-and-set timestamps',async()=>{
    stub();assert.equal((await reschedule(req('',body,''),ctx)).status,401);
    assert.equal((await reschedule(req('',{...body,expectedAt:'invalid'}),ctx)).status,400);assert.equal(calls.length,0);
    const res=await reschedule(req('',body),ctx);assert.equal(res.status,200);
    assert.deepEqual(calls.at(-1),{name:'reschedule_social_post',args:{p_auth_id:auth,p_post_id:id,p_expected_at:body.expectedAt,p_scheduled_at:body.scheduledAt}});
});
test('Free cannot open the calendar or reschedule when Publish plans are enabled',async()=>{
    const previous=process.env.PUBLISH_PLANS_ENABLED;process.env.PUBLISH_PLANS_ENABLED='true';
    try{
        const free={ok:true,tier:'free',account_limit:1,analytics_days:0,best_time_enabled:false,subscription:null};
        stub({read_social_publish_entitlement:free});
        assert.equal((await GET(req(valid))).status,402);
        stub({read_social_publish_entitlement:free});
        assert.equal((await reschedule(req('',body),ctx)).status,402);
        stub({read_social_publish_entitlement:free});
        assert.equal((await updatePost(req('',{action:'cancel',expectedUpdatedAt:updatedAt}),ctx)).status,402);
    }finally{if(previous===undefined)delete process.env.PUBLISH_PLANS_ENABLED;else process.env.PUBLISH_PLANS_ENABLED=previous;}
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
        stub({reschedule_social_post:{ok:false,code,secret:'private'}});const res=await reschedule(req('',body),ctx);assert.equal(res.status,status);assert.ok(!(await res.text()).includes('private'));
    }
    stub({consume_social_post_write_request:{ok:false,code:'RATE_LIMITED'}});assert.equal((await reschedule(req('',body),ctx)).status,429);assert.equal(calls.at(-1).name,'consume_social_post_write_request');
    stub({reschedule_social_post:new Error('private')});assert.deepEqual(await (await reschedule(req('',body),ctx)).json(),{error:'internal'});
});

test('cancel and restore validate versions, preserve ownership checks and return uncached results',async()=>{
    for(const invalid of [{action:'remove',expectedUpdatedAt:updatedAt},{action:'cancel',expectedUpdatedAt:'yesterday'},{action:'restore',expectedUpdatedAt:updatedAt,scheduledAt:'invalid'}]){
        stub();assert.equal((await updatePost(req('',invalid),ctx)).status,400);assert.equal(calls.length,0);
    }
    stub();let response=await updatePost(req('',{action:'cancel',expectedUpdatedAt:updatedAt}),ctx);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(calls.at(-1),{name:'cancel_social_post',args:{p_auth_id:auth,p_post_id:id,p_expected_updated_at:updatedAt}});
    stub();response=await updatePost(req('',{action:'restore',expectedUpdatedAt:updatedAt,scheduledAt:restoreAt}),ctx);assert.equal(response.status,200);
    assert.deepEqual(calls.at(-1),{name:'restore_social_post',args:{p_auth_id:auth,p_post_id:id,p_expected_updated_at:updatedAt,p_scheduled_at:restoreAt}});
    assert.ok(calls.some(call=>call.name==='social_brand_contains_post'));
});

test('cancel and restore map safe conflicts without leaking database details',async()=>{
    for(const [code,status] of [['POST_STARTED',409],['POST_CHANGED',409],['POST_BUSY',409],['RESTORE_UNAVAILABLE',409],['POST_NOT_FOUND',404],['FORBIDDEN',403],['USER_NOT_FOUND',401],['INVALID_POST_VERSION',400],['INVALID_SCHEDULE',400]]){
        stub({cancel_social_post:{ok:false,code,secret:'private'}});const response=await updatePost(req('',{action:'cancel',expectedUpdatedAt:updatedAt}),ctx);assert.equal(response.status,status);assert.ok(!(await response.text()).includes('private'));
    }
    stub({cancel_social_post:new Error('private')});assert.deepEqual(await (await updatePost(req('',{action:'cancel',expectedUpdatedAt:updatedAt}),ctx)).json(),{error:'internal'});
});
