// The video agent's sweep in the Worker heartbeat (0229). Runs on a fully replayed local database, inside one
// transaction that is rolled back, and replays the migration inside it (twice: it must be idempotent).
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('local replay database required');
const c = new pg.Client({ connectionString: url }); await c.connect();
try {
    await c.query('BEGIN');
    const migration = await readFile(new URL('../packages/db/schema/supabase/0229_video_agent_sweep_health.sql', import.meta.url), 'utf8');
    await c.query(migration); await c.query(migration);
    const unhealthy = async () => {
        await c.query('SELECT public.refresh_recovery_health()');
        return (await c.query('SELECT public.recovery_status() AS h')).rows[0].h.unhealthy_tasks;
    };
    const check = (await c.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = 'public.worker_task_health'::regclass AND conname = 'worker_task_health_task_check'`)).rows[0].d;
    // additive: every earlier name is still allowed
    for (const task of ['top_up_backfill', 'upload_sweep', 'auto_short', 'asset_reap', 'grsai', 'byteplus', 'publish_sweep', 'video_agent']) {
        assert.ok(check.includes(`'${task}'`), `task name kept: ${task}`);
    }
    await assert.rejects(c.query("SAVEPOINT s; SELECT public.record_worker_task_health('not_a_task', true)"), /check constraint|violates/);
    await c.query('ROLLBACK TO SAVEPOINT s');

    // row inactive (how production is today): the sweep is not expected, so it can never read as unhealthy
    await c.query("UPDATE public.model_catalog SET active = false WHERE id = 'video-agent'");
    assert.ok(!(await unhealthy()).includes('video_agent'), 'inactive row: not expected');

    // row active, no heartbeat yet: unhealthy
    await c.query("UPDATE public.model_catalog SET active = true WHERE id = 'video-agent'");
    assert.ok((await unhealthy()).includes('video_agent'), 'active row with no heartbeat is unhealthy');

    // a good heartbeat clears it; a failed one or a stale one brings it back
    await c.query("SELECT public.record_worker_task_health('video_agent', true)");
    assert.ok(!(await unhealthy()).includes('video_agent'), 'healthy after a good heartbeat');
    await c.query("SELECT public.record_worker_task_health('video_agent', false)");
    assert.ok((await unhealthy()).includes('video_agent'), 'unhealthy after a failed heartbeat');
    await c.query("SELECT public.record_worker_task_health('video_agent', true)");
    await c.query("UPDATE public.worker_task_health SET last_success = now() - interval '21 minutes' WHERE task = 'video_agent'");
    assert.ok((await unhealthy()).includes('video_agent'), 'unhealthy when the last success is older than 20 minutes');

    // the 0157 line is carried forward: an overdue scheduled post still expects the publish sweep
    const body = (await c.query("SELECT pg_get_functiondef('public.refresh_recovery_health()'::regprocedure) AS d")).rows[0].d;
    for (const piece of ["'publish_sweep'", "'auto_short'", "'byteplus'", "'grsai'", 'stale_jobs', 'cinema_cleanup_required', 'unreviewed_order_collisions']) {
        assert.ok(body.includes(piece), `0157 body carried forward: ${piece}`);
    }
    for (const role of ['anon', 'authenticated']) {
        assert.equal((await c.query("SELECT has_function_privilege($1, 'public.refresh_recovery_health()', 'EXECUTE') AS a", [role])).rows[0].a, false);
    }
    console.log('video agent sweep health: additive task names, expected only while the row is active, missing/failed/stale heartbeats, 0157 body kept, privileges');
} finally { await c.query('ROLLBACK'); await c.end(); }
