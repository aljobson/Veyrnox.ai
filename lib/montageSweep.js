/**
 * Video-agent sweep (ADR-0074 §3). Runs with the five-minute cron. A montage
 * step still SUBMITTED after TIMEOUT_MINUTES is a lost run: tell the runner to
 * stop (best effort, it may already be gone), fail the step and refund the
 * parent. There is no re-read of the runner and no retry: a run is paid work.
 * Goes through the same webhook_events dedup as a callback, so a late
 * `failed` or `completed` for the same run is a no-op.
 */

import { select } from '../packages/db/supabase-client.js';
import { handleRunnerEvent, isTimedOut } from './montageWebhook.js';

const BATCH = 20;

/** @param {{cfg:object, deps:object, now?:Date}} args */
export async function sweepMontage({ cfg, deps, now = new Date() }) {
    const rows = await select('job_steps', {
        // Only steps whose parent is still running, like the Auto Short sweep.
        columns: 'job_id,step,ordinal,provider,provider_endpoint,provider_job_id,state,attempts,updated_at,jobs!inner(state)',
        filter: `provider=eq.montage&state=eq.SUBMITTED&provider_job_id=not.is.null&jobs.state=eq.SUBMITTED&order=updated_at.asc&limit=${BATCH}`,
    }, cfg);
    const out = { checked: 0, timedOut: 0, errors: 0 };
    for (const step of Array.isArray(rows) ? rows : []) {
        out.checked += 1;
        if (!isTimedOut(step, now)) continue;
        try {
            await deps.runner.cancel(step.provider_job_id).catch(() => {});
            const r = await handleRunnerEvent({ event: { type: 'failed', errorCode: 'step_timeout' }, step, deps, cfg });
            if (r.status === 200) out.timedOut += 1; else out.errors += 1;
        } catch (err) {
            out.errors += 1;
            console.error('[video-agent-sweep] step failed:', err && err.message);
        }
    }
    return out;
}
