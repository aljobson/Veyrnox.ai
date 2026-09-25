import test from 'node:test';
import assert from 'node:assert/strict';
import {streamWebhook} from '../lib/cinema/streamWebhook.js';
Object.assign(process.env,{CINEMA_STREAM_ACCOUNT_ID:'a'.repeat(32),CINEMA_STREAM_API_TOKEN:'synthetic',CINEMA_STREAM_WEBHOOK_SECRET:'synthetic-webhook'});
const uid='b'.repeat(32);
async function request(body,valid=true){const time=Math.floor(Date.now()/1000),raw=JSON.stringify(body)+'\n';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-webhook'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${time}.${raw}`)))].map(n=>n.toString(16).padStart(2,'0')).join('');return new Request('https://test.invalid/api/webhook/cinema-stream',{method:'POST',body:raw,headers:{'webhook-signature':`time=${time},sig1=${valid?signature:'0'.repeat(64)}`}});}
test('unverified callbacks cannot trigger provider or DB requests',async()=>{let calls=0;const handler=streamWebhook({rpcCall:async()=>{calls++;},readVideo:async()=>{calls++;}});assert.equal((await handler(await request({uid},false))).status,401);assert.equal(calls,0);});
test('signed callback cannot select content ownership or declare publication; authoritative video wins',async()=>{
 const calls=[];const handler=streamWebhook({readVideo:async requested=>{assert.equal(requested,uid);return {uid,status:{state:'inprogress'}};},rpcCall:async(name,args)=>{calls.push({name,args});return {ok:true};}});
 const response=await handler(await request({uid,content_id:'attacker-choice',state:'PUBLISHED',readyToStream:true}));assert.equal(response.status,200);assert.equal(calls[0].args.p_state,'processing');assert.equal(calls[0].args.p_content_id,undefined);assert.equal(calls[0].name,'observe_cinema_upload');
});
test('provider and database failures ask for retry without exposing errors',async()=>{
 const handler=streamWebhook({readVideo:async()=>{throw Error('private token or provider message');}});const res=await handler(await request({uid}));assert.equal(res.status,503);assert.ok(!(await res.text()).includes('private token'));
 const dbFailure=streamWebhook({readVideo:async()=>({uid,status:{state:'error'}}),rpcCall:async()=>({error:'offline'})});assert.equal((await dbFailure(await request({uid}))).status,503);
});
