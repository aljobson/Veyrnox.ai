import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { retryTopUpReturn } from '../app/veyrnox/_lib/topUpReturnRetry.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-role',TOP_UP_RETURN_RATE_LIMIT_ENABLED:'true'});
const { POST } = await import('../app/api/v1/top-ups/[id]/return/route.js');
const auth='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const session='cs_test_'+'A'.repeat(64);
const invoke=(identity=auth,top=id,body={session_id:session})=>POST(new Request('https://veyrnox.test/return',{method:'POST',headers:identity?{'x-veyrnox-auth-id':identity}:{},body:JSON.stringify(body)}),{params:Promise.resolve({id:top})});
let calls;
function stub(rate={ok:true}, result={ok:true}, fail) {
 calls=[];
 globalThis.fetch=async(url,init)=>{
  const name=new URL(url).pathname.split('/').pop();calls.push(name);
  if(name===fail)throw new Error('private backend detail');
  if(name==='consume_top_up_return_request'){assert.deepEqual(JSON.parse(init.body),{p_auth_id:auth});return Response.json(rate);}
  assert.equal(name,'record_top_up_return_session');
  assert.deepEqual(JSON.parse(init.body),{p_auth_id:auth,p_top_up_id:id,p_session_id:session});return Response.json(result);
 };
}
test('validate identity, id and session before quota',async()=>{
 stub();for(const a of [null,'bad'])assert.equal((await invoke(a)).status,401);
 assert.equal((await invoke(auth,'bad')).status,400);
 assert.equal((await invoke(auth,id,{session_id:'pi_1'})).status,400);
 assert.deepEqual(calls,[]);
});
test('quota denials stop recording with bounded retry/no-store',async()=>{
 for(const [value,expected] of [[12,12],[0,1],[999,60],[null,60],['2',60]]){
  stub({ok:false,code:'RATE_LIMITED',retry_after_seconds:value});const r=await invoke();
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),String(expected));assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(await r.json(),{error:'rate_limited',retry_after_seconds:expected});assert.deepEqual(calls,['consume_top_up_return_request']);
 }
});
test('missing accounts and unavailable quota never reach recording',async()=>{
 for(const rate of [null,{}, {ok:'true'}, {ok:false,code:'OTHER'}, {ok:false,code:'NOT_FOUND'}]){
  stub(rate);const r=await invoke();assert.equal(r.status,rate?.code==='NOT_FOUND'?404:503);assert.deepEqual(calls,['consume_top_up_return_request']);
 }
 stub(null,null,'consume_top_up_return_request');const r=await invoke();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'rate_limit_unavailable'});
});
test('admitted replays each consume quota and preserve owner/session arguments',async()=>{
 stub();for(let i=0;i<2;i++)assert.equal((await invoke(auth,id.toUpperCase())).status,200);
 assert.deepEqual(calls,['consume_top_up_return_request','record_top_up_return_session','consume_top_up_return_request','record_top_up_return_session']);
 for(const [result,status] of [[{ok:false,code:'TOP_UP_NOT_FOUND'},404],[{ok:false,code:'INVALID_SESSION_ID'},400]]){stub({ok:true},result);assert.equal((await invoke()).status,status);}
});
test('disabled enforcement retains original recording path',async()=>{
 process.env.TOP_UP_RETURN_RATE_LIMIT_ENABLED='false';
 try{stub(null,{ok:true},'consume_top_up_return_request');assert.equal((await invoke()).status,200);assert.deepEqual(calls,['record_top_up_return_session']);}
 finally{process.env.TOP_UP_RETURN_RATE_LIMIT_ENABLED='true';}
});
test('browser retries temporary denials with identical callback and bounded backoff',async()=>{
 const waits=[];let attempts=0;
 const result=await retryTopUpReturn(async()=>{attempts++;if(attempts<3)throw {status:attempts===1?429:503,retryAfter:attempts===1?999:undefined};return {ok:true};},{wait:async ms=>waits.push(ms)});
 assert.deepEqual(result,{ok:true});assert.equal(attempts,3);assert.deepEqual(waits,[60000,30000]);
 for(const status of [400,401,404,500,undefined]){attempts=0;await retryTopUpReturn(async()=>{attempts++;throw {status};},{wait:()=>assert.fail('permanent error retried')});assert.equal(attempts,1);}
 attempts=0;await retryTopUpReturn(async()=>{attempts++;throw {status:429};},{wait:async()=>{}});assert.equal(attempts,3);
});
test('cancellation stops waiting and sends no further return attempts',async()=>{
 const controller=new AbortController();let attempts=0;
 await retryTopUpReturn(async()=>{attempts++;throw {status:429};},{signal:controller.signal,wait:async()=>controller.abort()});assert.equal(attempts,1);
 await retryTopUpReturn(()=>assert.fail('aborted send'),{signal:controller.signal});
 const pendingController=new AbortController();
 const pending=retryTopUpReturn(async()=>{throw {status:429};},{signal:pendingController.signal});
 await Promise.resolve();pendingController.abort();await pending;
});
