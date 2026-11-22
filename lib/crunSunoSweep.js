import { rpc as realRpc, select as realSelect } from '../packages/db/supabase-client.js';
import { fetchTask } from '../packages/adapters/crun.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';
import { isConfigured } from '../packages/adapters/r2.js';
import { paceCrunTaskInfo } from './crunPollPacer.js';
import { sweepRows } from './sweepRows.js';

export const SUNO_BATCH = 25;
export const SUNO_MIN_POLL_MS = 15_000;
export const SUNO_PENDING_ALERT_MINUTES = 45;
export const SUNO_COPY_EXHAUST_MINUTES = 45;
export const SUNO_COPY_RETENTION_MINUTES = 14 * 24 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMANENT_COPY_FAILURE = /^(source too large|source (404|410))$/;

async function assetKey(taskId, outputUrl) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(outputUrl));
    const tag = Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `crun/${taskId}/${tag}.audio`;
}

const ageMinutes = (value, now) => (now.getTime() - new Date(value).getTime()) / 60_000;

async function defaultListJobs({ cfg, onlyJobId, now }) {
    const only = onlyJobId ? `&id=eq.${encodeURIComponent(onlyJobId)}` : '';
    return sweepRows({
        columns: 'id,user_id,credits,state,provider_job_id,created_at,updated_at,model_id,provider',
        filter: `provider=eq.crun&provider_job_id=not.is.null&state=in.(SUBMITTED,SUCCEEDED)&model_id=in.(ace-step,ace-step-1.5)${only}`,
        only, now, cfg, batch: SUNO_BATCH,
    });
}

async function listAcceptedJobs({ cfg, onlyJobId, now, select, listJobs }) {
    const jobs = await listJobs({ cfg, onlyJobId, now });
    const validJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => UUID_RE.test(String(job.id || ''))
        && typeof job.provider_job_id === 'string');
    if (!validJobs.length) return [];
    const ids = validJobs.map((job) => job.id).join(',');
    const dispatches = await select('crun_dispatch', {
        columns: 'job_id,state,provider_job_id,created_at,last_authoritative_status',
        filter: `job_id=in.(${ids})&state=eq.ACCEPTED`,
        limit: SUNO_BATCH,
    }, cfg);
    const byJob = new Map((Array.isArray(dispatches) ? dispatches : []).map((row) => [row.job_id, row]));
    return validJobs.filter((job) => byJob.get(job.id)?.provider_job_id === job.provider_job_id)
        .map((job) => ({ ...job, dispatch: byJob.get(job.id) }));
}

async function recordFailure(job, cfg, rpc) {
    return rpc('record_crun_task_failure', {
        p_job_id: job.id,
        p_provider_job_id: job.provider_job_id,
        p_error_code: 'provider_task_failed',
    }, cfg);
}

async function settleSuccess(job, outputUrl, { cfg, r2cfg, rpc, copy, now }) {
    if (job.state === 'SUBMITTED') {
        const succeeded = await rpc('job_succeeded', {
            p_provider_job_id: job.provider_job_id,
            p_provider: 'crun',
        }, cfg);
        if (succeeded?.ok !== true) return { ok: false, error: 'job_succeeded_failed' };
    }
    const copied = await copy(outputUrl, await assetKey(job.provider_job_id, outputUrl), r2cfg, {
        provider: 'crunAudio',
        expectAudio: true,
        maxBytes: 40 * 1024 * 1024,
    });
    if (!copied?.ok) {
        console.error(JSON.stringify({ event: 'crun.suno_asset_copy_alert', job_id: job.id,
            code: copied?.error === 'source host not allowed' ? 'audio_host_unverified' : 'asset_copy_failed' }));
        const copyAge = ageMinutes(job.updated_at, now);
        const copyError = String(copied?.error || '');
        // An unverified host or an unrecognized audio container needs operator
        // evidence. Neither proves that the paid provider output is unusable.
        const operatorHold = copyError === 'source host not allowed' || copyError === 'source not audio';
        const exhausted = PERMANENT_COPY_FAILURE.test(copyError) && copyAge >= SUNO_COPY_EXHAUST_MINUTES
            || !operatorHold && copyAge >= SUNO_COPY_RETENTION_MINUTES;
        if (exhausted && job.state === 'SUCCEEDED') {
            const terminal = await rpc('record_crun_asset_failure', {
                p_job_id: job.id,
                p_provider_job_id: job.provider_job_id,
            }, cfg);
            if (terminal?.ok === true) {
                console.error(JSON.stringify({ event: 'crun.suno_asset_terminal', job_id: job.id,
                    code: 'asset_store_failed' }));
                return { ok: true, terminal: true };
            }
            return { ok: false, error: 'asset_terminal_failed' };
        }
        return { ok: false, error: 'asset_copy_failed' };
    }
    if (!/^audio\//.test(String(copied.mimeType || ''))) return { ok: false, error: 'asset_not_audio' };
    const stored = await rpc('job_stored', {
        p_provider_job_id: job.provider_job_id,
        p_provider: 'crun',
        p_r2_key: copied.r2Key,
        p_mime_type: copied.mimeType,
        p_size_bytes: copied.size,
        p_sha256: copied.sha256,
    }, cfg);
    return stored?.ok === true ? { ok: true } : { ok: false, error: 'job_stored_failed' };
}

/** Music-only Crun settlement. Unreadable and old-pending tasks are held. */
export async function sweepCrunSunoMusic({
    cfg, r2cfg, apiKey, now = new Date(), onlyJobId = null,
    select = realSelect, rpc = realRpc, read = fetchTask, copy = copyUrlToR2, pace = paceCrunTaskInfo,
    listJobs = defaultListJobs,
} = {}) {
    if (!apiKey || !cfg?.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) return { skipped: 'not_configured' };
    if (onlyJobId && !UUID_RE.test(onlyJobId)) return { skipped: 'invalid_job' };
    const jobs = await listAcceptedJobs({ cfg, onlyJobId, now, select, listJobs });
    const out = { checked: 0, applied: 0, pending: 0, errors: 0 };
    for (const job of jobs.slice(0, SUNO_BATCH)) {
        if (Number.isFinite(Date.parse(job.updated_at)) && now.getTime() - Date.parse(job.updated_at) < SUNO_MIN_POLL_MS) {
            out.pending += 1;
            continue;
        }
        out.checked += 1;
        try {
            const paced = await pace({ cfg, purpose: 'music.taskinfo' });
            if (paced === false) {
                out.errors += 1;
                console.error(JSON.stringify({ event: 'crun.suno_taskinfo_pacing_alert', job_id: job.id,
                    code: 'taskinfo_slot_unavailable' }));
                continue;
            }
            const outcome = await read(job.provider_job_id, { apiKey, kind: 'audio' });
            if (!outcome?.ok) {
                out.errors += 1;
                console.error(JSON.stringify({ event: 'crun.suno_taskinfo_alert', job_id: job.id,
                    code: outcome?.errorCode || 'provider_status_unavailable' }));
                continue;
            }
            const authoritativeStatus = outcome.state === 'fail' ? 'failed' : outcome.state;
            const recordedStatus = await rpc('record_crun_task_status', {
                p_job_id: job.id,
                p_status: authoritativeStatus,
                p_observed_at: now.toISOString(),
            }, cfg);
            if (recordedStatus?.ok !== true) {
                out.errors += 1;
                console.error(JSON.stringify({ event: 'crun.suno_status_record_alert', job_id: job.id,
                    code: 'status_record_failed' }));
                continue;
            }
            if (outcome.state === 'pending') {
                out.pending += 1;
                if (ageMinutes(job.dispatch.created_at || job.created_at, now) >= SUNO_PENDING_ALERT_MINUTES) {
                    console.error(JSON.stringify({ event: 'crun.suno_pending_age_alert', job_id: job.id,
                        code: 'operator_resolution_required' }));
                }
                continue;
            }
            if (outcome.state === 'fail') {
                const failed = await recordFailure(job, cfg, rpc);
                if (failed?.ok === true) out.applied += 1; else out.errors += 1;
                continue;
            }
            if (outcome.state !== 'success' || typeof outcome.outputUrl !== 'string') {
                out.errors += 1;
                continue;
            }
            const settled = await settleSuccess(job, outcome.outputUrl, { cfg, r2cfg, rpc, copy, now });
            if (settled.ok) out.applied += 1; else out.errors += 1;
        } catch {
            out.errors += 1;
            console.error(JSON.stringify({ event: 'crun.suno_settlement_alert', job_id: job.id,
                code: 'settlement_failed' }));
        }
    }
    return out;
}
