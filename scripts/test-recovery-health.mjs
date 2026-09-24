import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const url=process.env.DATABASE_URL;
if(!url || !['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('local replay database required');
const c=new pg.Client({connectionString:url});await c.connect();
try {
 await c.query('BEGIN');
 const migration=await readFile(new URL('../packages/db/schema/supabase/0131_recovery_health.sql',import.meta.url),'utf8');
 await c.query(migration);await c.query(migration);
 const read=async()=> (await c.query('SELECT public.recovery_status() AS health')).rows[0].health;
 assert.ok((await read()).unhealthy_tasks.includes('asset_reap'));
 for(const task of ['top_up_backfill','upload_sweep','auto_short','asset_reap','grsai']) await c.query('SELECT public.record_worker_task_health($1,true)',[task]);
 await c.query('SELECT public.refresh_recovery_health()');
 assert.deepEqual((await read()).unhealthy_tasks,[]);
 await c.query("SELECT public.record_worker_task_health('asset_reap',false)");
 await c.query('SELECT public.refresh_recovery_health()');
 assert.deepEqual((await read()).unhealthy_tasks,['asset_reap']);
 const last=(await c.query("SELECT last_success FROM public.worker_task_health WHERE task='asset_reap'")).rows[0].last_success;
 assert.ok(last);
 await c.query("UPDATE public.worker_task_health SET last_success=now()-interval '21 minutes', last_ok=true WHERE task='grsai'");
 await c.query('SELECT public.refresh_recovery_health()');
 assert.ok((await read()).unhealthy_tasks.includes('grsai'));
 for(const role of ['anon','authenticated']) {
  for(const fn of ['record_worker_task_health(text,boolean)','refresh_recovery_health()','review_recovery_alert(text,text,text)']) {
   assert.equal((await c.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,'public.'+fn])).rows[0].allowed,false);
  }
 }
 assert.equal((await c.query("SELECT public.review_recovery_alert('flagged_order','missing','test-reference') AS reviewed")).rows[0].reviewed,false);
 await c.query('SET LOCAL ROLE anon');
 assert.ok(Array.isArray((await read()).unhealthy_tasks));
 await c.query('RESET ROLE');
 await c.query("UPDATE public.recovery_health_snapshot SET observed_at=now()-interval '46 minutes'");
 await c.query('SAVEPOINT stale');
 await assert.rejects(read(),/unavailable or stale/);
 await c.query('ROLLBACK TO SAVEPOINT stale');
 console.log('recovery health replay, missing/failing/stale tasks, privileges and stale snapshot tests passed');
} finally {await c.query('ROLLBACK');await c.end();}
