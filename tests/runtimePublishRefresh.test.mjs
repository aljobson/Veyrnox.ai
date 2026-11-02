import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntimeSwitchCache } from '../lib/runtimeSwitchCache.js';
import { observeRecovery } from '../lib/recoveryHealth.js';

// Execute the real Worker cron expression without loading OpenNext or starting workerd.
const worker=await readFile(new URL('../worker.js',import.meta.url),'utf8');
const expression=worker.slice(worker.indexOf("observeRecovery('publish_sweep'"),worker.indexOf('// Off until 0188')).trim().replace(/,$/,'');
const cron=new Function('observeRecovery','refreshRuntimeSwitches','runPublishSweep','env','tokenCryptoConfig','r2EnvFrom','return '+expression);
async function tick(refresh) {
 const reports=[],env={RECOVERY_HEALTH_ENABLED:'true',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
 let sweeps=0;
 const result=await cron((task,run,e)=>observeRecovery(task,run,e,async(_name,args)=>reports.push(args)),refresh,
  async()=>{sweeps++;return {ok:true,claimed:0};},env,()=>({}),()=>({}));
 assert.equal(sweeps,1);assert.deepEqual(result,{ok:true,claimed:0});
 assert.deepEqual(reports,[{p_task:'publish_sweep',p_ok:true}]);
}
test('scheduled publish sweep runs inside switch failure back-off and reports healthy recovery',async()=>{
 let time=0,reads=0;
 const cache=createRuntimeSwitchCache({now:()=>time,read:async()=>{reads++;throw Error('DB unavailable');},log:()=>{}});
 await cache.refresh();time=1000;
 await tick(cache.refresh);assert.equal(reads,1,'back-off does not read again or skip the sweep');
});
test('scheduled publish chain tolerates an undefined or rejected refresh result',async()=>{
 await tick(()=>undefined);await tick(()=>Promise.reject(Error('refresh failed')));
});
test('a hung switch read delays the sweep only until the 400 ms bound',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const cache=createRuntimeSwitchCache({read:()=>new Promise(()=>{}),log:()=>{}});
 const running=tick(cache.refresh);await Promise.resolve();t.mock.timers.tick(400);await running;
});
