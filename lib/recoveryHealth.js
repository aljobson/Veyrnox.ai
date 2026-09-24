import { rpc } from '../packages/db/supabase-client.js';

/** Never let heartbeat failure prevent recovery; missing heartbeats fail the watcher. */
export async function observeRecovery(task, run, env, report = rpc) {
    let result, thrown;
    try { result = await run(); } catch (error) { thrown = error; }
    if (env.RECOVERY_HEALTH_ENABLED === 'true') {
        const ok = !thrown && !!result && result.ok !== false && !result.skipped && !result.errors && !result.failed;
        try {
            await report('record_worker_task_health', { p_task: task, p_ok: ok }, {
                supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
            });
        } catch { console.error('[recovery-health] heartbeat write failed:', task); }
    }
    if (thrown) throw thrown;
    return result;
}
