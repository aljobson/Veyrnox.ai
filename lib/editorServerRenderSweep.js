import { finalizeUploadedRender, TIMEOUT_MS } from './editorServerRender.js';

export async function sweepEditorServerRender({ deps, enabled = false, now = Date.now() }) {
    if (!enabled) return { checked: 0, refunded: 0 };
    const jobs = (await deps.jobs()).filter(j => j.provider === 'concat-render');
    let refunded = 0;
    let states;
    try { states = await deps.runner.states(jobs.filter(j => j.state === 'SUBMITTED').map(j => j.id)); } catch { /* Timeout is the backstop. */ }
    for (const job of jobs) {
        try {
            if (job.state === 'REFUNDED') { await deps.rpc('cleanup_server_render', { p_job_id: job.id }); continue; }
            // Re-inspect first: the callback may have died after upload/inspection.
            if (job.state === 'SUBMITTED' && job.inputs.upload_size) {
                const result = await finalizeUploadedRender(job, deps);
                if (result.ok) { await deps.rpc('cleanup_server_render', { p_job_id: job.id }); continue; }
                if (!result.missing) continue; // Storage outage is not proof of a lost object.
            }
            const age = now - Date.parse(job.created_at);
            // Persist observations across Workers. Callbacks reset the unknown
            // sequence; the RPC arbitrates loss/refund with those callbacks.
            const observation = job.state === 'SUBMITTED' ? await deps.rpc('observe_server_render', {
                p_job_id: job.id, p_state: states?.ok ? states.data?.runs?.[job.id] || null : null,
                p_observed_at: new Date(now).toISOString(),
            }) : null;
            const lost = observation?.lost === true;
            if (job.state !== 'FAILED' && !lost && age <= TIMEOUT_MS) continue;
            const result = await deps.rpc('fail_server_render', { p_job_id: job.id, p_error: lost ? 'run_lost' : 'render_timeout' });
            if (result?.ok && result.state === 'REFUNDED') refunded++;
            await deps.runner.cancel(job.id).catch(() => {});
            await deps.rpc('cleanup_server_render', { p_job_id: job.id });
        } catch { /* Keep the durable job for the next sweep. */ }
    }
    return { checked: jobs.length, refunded };
}
