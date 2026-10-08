/**
 * Video-agent sweep (ADR-0074 §3). Runs with the five-minute cron. A montage
 * step still SUBMITTED after TIMEOUT_MINUTES is a lost run: tell the runner to
 * stop (best effort, it may already be gone), fail the step and refund the
 * parent. There is no re-read of the runner and no retry: a run is paid work.
 * Goes through the same webhook_events dedup as a callback, so a late
 * `failed` or `completed` for the same run is a no-op.
 *
 * Liveness (MONTAGE_LIVENESS_ENABLED): waiting out the timeout holds the credits for 45 to 50 minutes when the runner
 * died two minutes in (staging, 2026-10-08). With the flag on, the sweep asks the runner which of the young runs it
 * still has. One it does not know (the machine restarted) or whose thread has ended without a result reaching us is
 * lost now: cancel, fail, refund. Only those two answers act; "running", no answer, or an answer we cannot read all
 * leave the run to the timeout. The runner keeps its runs in memory PER MACHINE (docs/montage/CAPACITY.md), so this
 * is only sound with one machine: a second machine would answer "unknown" for the first one's live runs. Turn the
 * flag off before adding one.
 */

import { select } from '../packages/db/supabase-client.js';
import { handleRunnerEvent, isTimedOut } from './montageWebhook.js';
import { failParent } from './montage.js';

// A FAILED step under a SUBMITTED parent is an inconsistency, not a state: the handler fails the step and the parent in one
// pass. It can only be left behind by a crash between the two (or by another sweep, as happened on 2026-10-08), so after a
// short grace this sweep finishes the job: fail the parent and refund once (failParent is idempotent).
export const ORPHAN_GRACE_MINUTES = 5;

// The step is SUBMITTED only after the runner answered /run, so the runner knows the run from that moment. The grace
// is margin for clocks and for a callback that is in flight while we ask.
export const LIVENESS_GRACE_MINUTES = 3;
const LOST = new Set(['unknown', 'ended']);

const BATCH = 20;
const ageMinutes = (step, now) => (now.getTime() - new Date(step.updated_at).getTime()) / 60_000;

/** Run ids the runner says are gone. Empty on any doubt: no answer, a bad answer, or a state we do not know. */
async function lostRuns(steps, deps, now) {
    const ids = steps.filter((s) => s.state === 'SUBMITTED' && !isTimedOut(s, now) && ageMinutes(s, now) >= LIVENESS_GRACE_MINUTES)
        .map((s) => s.provider_job_id);
    if (!ids.length) return new Set();
    let res;
    try {
        res = await deps.runner.states(ids);
    } catch (err) {
        console.error('[video-agent-sweep] liveness failed:', err && err.message);
        return new Set();
    }
    const runs = res && res.ok && res.data && typeof res.data.runs === 'object' && res.data.runs !== null ? res.data.runs : null;
    if (!runs) return new Set();
    return new Set(ids.filter((id) => Object.prototype.hasOwnProperty.call(runs, id) && LOST.has(runs[id])));
}

/** @param {{cfg:object, deps:object, now?:Date, liveness?:boolean}} args */
export async function sweepMontage({ cfg, deps, now = new Date(), liveness = false }) {
    const rows = await select('job_steps', {
        // Only steps whose parent is still running, like the Auto Short sweep.
        columns: 'job_id,step,ordinal,provider,provider_endpoint,provider_job_id,state,attempts,updated_at,jobs!inner(state)',
        filter: `provider=eq.montage&state=in.(SUBMITTED,FAILED)&provider_job_id=not.is.null&jobs.state=eq.SUBMITTED&order=updated_at.asc&limit=${BATCH}`,
    }, cfg);
    const steps = Array.isArray(rows) ? rows : [];
    const lost = liveness ? await lostRuns(steps, deps, now) : new Set();
    const out = { checked: 0, timedOut: 0, lost: 0, healed: 0, errors: 0 };
    for (const step of steps) {
        out.checked += 1;
        if (step.state === 'FAILED') {
            if (ageMinutes(step, now) < ORPHAN_GRACE_MINUTES) continue;
            try {
                const r = await failParent(step.job_id, 'montage_failed', deps);
                if (r && r.ok) out.healed += 1; else out.errors += 1;
            } catch (err) {
                out.errors += 1;
                console.error('[video-agent-sweep] heal failed:', err && err.message);
            }
            continue;
        }
        const gone = lost.has(step.provider_job_id);
        if (!gone && !isTimedOut(step, now)) continue;
        try {
            await deps.runner.cancel(step.provider_job_id).catch(() => {});
            const r = await handleRunnerEvent({ event: { type: 'failed', errorCode: gone ? 'run_lost' : 'step_timeout' }, step, deps, cfg });
            if (r.status !== 200) out.errors += 1;
            else if (gone) out.lost += 1;
            else out.timedOut += 1;
        } catch (err) {
            out.errors += 1;
            console.error('[video-agent-sweep] step failed:', err && err.message);
        }
    }
    return out;
}
