import test from 'node:test';
import assert from 'node:assert/strict';
import { observeRecovery } from '../lib/recoveryHealth.js';
import { assessRecovery } from '../scripts/check-recovery-health.mjs';
const env={RECOVERY_HEALTH_ENABLED:'true'};
test('empty successful recovery runs still record freshness',async()=>{
 const reports=[];await observeRecovery('asset_reap',async()=>({ok:true,processed:0}),env,async(_name,args)=>reports.push(args));
 assert.deepEqual(reports,[{p_task:'asset_reap',p_ok:true}]);
});
test('returned failures, skipped tasks, errors and throws never renew success',async()=>{
 for(const value of [{ok:false},{errors:1},{failed:1},{skipped:'not_configured'},undefined]){
  await observeRecovery('upload_sweep',async()=>value,env,async(_name,args)=>assert.equal(args.p_ok,false));
 }
 let reported=false;
 await assert.rejects(observeRecovery('asset_reap',async()=>{throw Error('failed');},env,async(_name,args)=>{reported=true;assert.equal(args.p_ok,false);}),/failed/);
 assert.equal(reported,true);
});
test('heartbeat outages do not suppress recovery or expose backend details',async()=>{
 const value={ok:true};const original=console.error;const logs=[];console.error=(...args)=>logs.push(args.join(' '));
 try{assert.equal(await observeRecovery('asset_reap',async()=>value,env,async()=>{throw Error('private');}),value);assert.equal(logs.some(s=>s.includes('private')),false);}finally{console.error=original;}
});
test('a disabled rollout makes no health write',async()=>{
 await observeRecovery('asset_reap',async()=>({ok:true}),{},()=>assert.fail('unexpected RPC'));
});
test('watcher refuses incomplete or malformed snapshots and reports every actionable counter',()=>{
 const clean={unhealthy_tasks:[],reap_exhausted:0,reap_overdue:0,stale_jobs:0,stale_top_up_returns:0,unreviewed_flagged_orders:0,unreviewed_order_collisions:0};
 assert.deepEqual(assessRecovery(clean),[]);
 assert.deepEqual(assessRecovery({...clean,unhealthy_tasks:['fal_dispatch']}),['unhealthy task: fal_dispatch']);
 assert.deepEqual(assessRecovery({...clean,fal_dispatch_unknown:1,fal_dispatch_overdue:0}),['fal_dispatch_unknown: 1']);
 assert.throws(()=>assessRecovery({...clean,fal_dispatch_unknown:0}),/invalid fal_dispatch_overdue/);
 assert.throws(()=>assessRecovery({}),/invalid/);
 assert.throws(()=>assessRecovery({...clean,stale_jobs:null}),/invalid/);
 assert.deepEqual(assessRecovery({...clean,unhealthy_tasks:['grsai'],reap_exhausted:2}),['unhealthy task: grsai','reap_exhausted: 2']);
});

test('scanner overdue, backlog and exhaustion render independently with old snapshots still valid', () => {
 const clean={unhealthy_tasks:[],reap_exhausted:0,reap_overdue:0,stale_jobs:0,stale_top_up_returns:0,unreviewed_flagged_orders:0,unreviewed_order_collisions:0};
 const scan={content_scan_overdue:0,content_scan_backlogged:0,content_scan_exhausted:0};
 assert.deepEqual(assessRecovery({...clean,...scan}),[]);
 for(const key of Object.keys(scan)) assert.deepEqual(assessRecovery({...clean,...scan,[key]:21}),[`${key}: 21`]);
 assert.throws(()=>assessRecovery({...clean,content_scan_overdue:0}),/invalid content_scan_backlogged/);
});

test('a failing scanner heartbeat records failure and renders overdue plus unhealthy', async () => {
 const reports=[];
 await observeRecovery('content_scan',async()=>({ok:true,errors:1}),env,async(_name,args)=>reports.push(args));
 assert.deepEqual(reports,[{p_task:'content_scan',p_ok:false}]);
 // The database smoke proves that fresh attempts with stale success produce this snapshot.
 const snapshot={unhealthy_tasks:['content_scan'],content_scan_overdue:1,content_scan_backlogged:0,content_scan_exhausted:0,
  reap_exhausted:0,reap_overdue:0,stale_jobs:0,stale_top_up_returns:0,unreviewed_flagged_orders:0,unreviewed_order_collisions:0};
 assert.deepEqual(assessRecovery(snapshot),['unhealthy task: content_scan','content_scan_overdue: 1']);
});
