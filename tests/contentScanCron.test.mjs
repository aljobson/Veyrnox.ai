import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) {
 if (s.endsWith('/.open-next/worker.js')) return {url:'data:text/javascript,export default {fetch:()=>{throw Error("five-minute work on minute tick")}}',shortCircuit:true};
 if (s.endsWith('/lib/contentScan.js')) return {url:'data:text/javascript,export const drainContentScans=(...a)=>globalThis.__drain(...a)',shortCircuit:true};
 return next(s,c);
}`));
const worker = (await import('../worker.js')).default;
test('minute tick drains under content_scan heartbeat only while flag is enabled', async () => {
 const calls=[];
 globalThis.__drain=async(cfg,r2,env)=>{assert.equal(cfg.supabaseUrl,'https://db.test');assert.equal(env.CONTENT_SCAN_ENABLED,'true');calls.push('drain');return {ok:true};};
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith('/record_worker_task_health'));assert.deepEqual(JSON.parse(init.body),{p_task:'content_scan',p_ok:true});calls.push('heartbeat');return Response.json({ok:true});};
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',RECOVERY_HEALTH_ENABLED:'true',CONTENT_SCAN_ENABLED:'true'};
 await worker.scheduled({cron:'* * * * *'},env,{});
 assert.deepEqual(calls,['drain','heartbeat']); calls.length=0;
 await worker.scheduled({cron:'* * * * *'},{...env,CONTENT_SCAN_ENABLED:'false'},{});
 assert.deepEqual(calls,[]);
});
