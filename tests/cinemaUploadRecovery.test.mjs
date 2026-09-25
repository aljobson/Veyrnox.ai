import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverCinemaUploads } from '../lib/cinema/uploadRecovery.js';
import { assessRecovery } from '../scripts/check-recovery-health.mjs';
const env = { CINEMA_UPLOAD_RECOVERY_ENABLED:'true', CINEMA_STREAM_ACCOUNT_ID:'a'.repeat(32), CINEMA_STREAM_API_TOKEN:'private-token', CINEMA_STREAM_WEBHOOK_SECRET:'private-secret', SUPABASE_URL:'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY:'private-db-key' };
const item = n => ({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,stream_uid:String(n).padStart(32,'a')});
const video = (uid,state='ready') => ({uid,status:{state,pctComplete:'100'},readyToStream:true,requireSignedURLs:true,duration:40,input:{width:1080,height:1920}});
function setup(items=[item(1)],readVideo=async uid=>video(uid),override) {
 const calls=[];
 return {calls, deps:{readVideo,rpcCall:async(name,args,cfg)=>{
  calls.push({name,args,cfg});
  if(override){const out=await override(name,args);if(out!==undefined)return out;}
  return name==='claim_cinema_upload_checks'?{items}:{ok:true};
 }}};
}
test('recovery uses worker bindings with creator flags off and bounded minimal observations',async()=>{
 const {calls,deps}=setup();const out=await recoverCinemaUploads(env,deps);
 assert.deepEqual(out,{ok:true,checked:1,observed:1,failed:0});
 assert.deepEqual(calls.map(c=>c.name),['claim_cinema_upload_checks','observe_cinema_upload','finish_cinema_upload_check']);
 assert.equal(calls[1].args.p_state,'ready');assert.equal(calls[1].args.p_uid,item(1).stream_uid);
 assert.equal(calls[2].args.p_key,calls[0].args.p_key);assert.equal(calls[2].args.p_ok,true);
 assert.deepEqual(calls[0].cfg,{supabaseUrl:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});
});
test('disabled or missing configuration never claims work',async()=>{
 const rpcCall=()=>assert.fail('unexpected claim');
 assert.equal((await recoverCinemaUploads({}, {rpcCall})).skipped,'disabled');
 for(const missing of ['CINEMA_STREAM_API_TOKEN','CINEMA_STREAM_WEBHOOK_SECRET','CINEMA_STREAM_ACCOUNT_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
  assert.equal((await recoverCinemaUploads({...env,[missing]:''},{rpcCall})).ok,false);
 }
});
test('provider failure is isolated, health fails and raw errors never escape logs',async()=>{
 const {deps,calls}=setup([item(1),item(2)],async uid=>{if(uid===item(1).stream_uid)throw Error('private-token-private-payload');return video(uid);});
 const logs=[],old=console.info;console.info=s=>logs.push(s);
 try {assert.deepEqual(await recoverCinemaUploads(env,deps),{ok:false,checked:2,observed:1,failed:1});}finally{console.info=old;}
 assert.equal(calls.filter(c=>c.name==='finish_cinema_upload_check').length,2);
 assert.equal(calls.find(c=>c.args.p_id===item(1).id).args.p_ok,false);
 assert.equal(logs.some(s=>s.includes('private')),false);
 assert.equal(logs.some(s=>s.includes(item(1).stream_uid)),false);
});
test('pending uploads finish checks without invented processing or capacity release',async()=>{
 const {deps,calls}=setup([item(1)],async uid=>video(uid,'pendingupload'));
 assert.deepEqual(await recoverCinemaUploads(env,deps),{ok:true,checked:1,observed:0,failed:0});
 assert.deepEqual(calls.map(c=>c.name),['claim_cinema_upload_checks','finish_cinema_upload_check']);
});
test('mismatched UID, invalid provider state and rejected observations fail closed',async()=>{
 for(const response of [video(item(2).stream_uid),video(item(1).stream_uid,'unknown')]) {
  const {deps,calls}=setup([item(1)],async()=>response);assert.equal((await recoverCinemaUploads(env,deps)).failed,1);
  assert.equal(calls.some(c=>c.name==='observe_cinema_upload'),false);
 }
 const {deps,calls}=setup([item(1)],undefined,name=>name==='observe_cinema_upload'?{ignored:true}:undefined);
 assert.equal((await recoverCinemaUploads(env,deps)).ok,false);assert.equal(calls.at(-1).args.p_ok,false);
});
test('malformed, duplicate and oversized claims never contact Stream',async()=>{
 for(const items of [null,{},[item(1),item(1)],[{...item(1),stream_uid:'https://evil.invalid'}],Array.from({length:21},(_,n)=>item(n))]){
  const {deps}=setup(items,()=>assert.fail('unexpected provider call'));
  assert.equal((await recoverCinemaUploads(env,deps)).ok,false);
 }
});
test('at most four provider calls run concurrently; all twenty claimed entries are attempted',async()=>{
 let active=0,max=0;const releases=[];
 const {deps}=setup(Array.from({length:20},(_,n)=>item(n)),async uid=>{
  active++;max=Math.max(max,active);await new Promise(resolve=>releases.push(resolve));active--;return video(uid);
 });
 const done=recoverCinemaUploads(env,deps);
 for(let batch=0;batch<5;batch++){
  while(releases.length<4)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(active,4);releases.splice(0).forEach(resolve=>resolve());
 }
 assert.equal((await done).checked,20);assert.equal(max,4);
});
test('failed claim or finish is not reported as success',async()=>{
 for(const failing of ['claim_cinema_upload_checks','finish_cinema_upload_check']){
  const {deps}=setup([item(1)],undefined,name=>{if(name===failing)throw Error('secret');});
  assert.equal((await recoverCinemaUploads(env,deps)).ok,false);
 }
});
test('health watcher accepts old snapshots, requires a complete Cinema group and reports failures',()=>{
 const base={unhealthy_tasks:[],reap_exhausted:0,reap_overdue:0,stale_jobs:0,stale_top_up_returns:0,unreviewed_flagged_orders:0,unreviewed_order_collisions:0};
 assert.deepEqual(assessRecovery(base),[]);
 const cinema={cinema_poll_overdue:0,cinema_poll_failed:0,cinema_provisioning_stuck:0,cinema_processing_stuck:0,cinema_cleanup_required:0};
 assert.deepEqual(assessRecovery({...base,...cinema}),[]);
 assert.throws(()=>assessRecovery({...base,cinema_poll_failed:1}),/invalid cinema/);
 assert.deepEqual(assessRecovery({...base,...cinema,cinema_poll_failed:2}),['cinema_poll_failed: 2']);
});
