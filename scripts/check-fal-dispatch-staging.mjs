import { pathToFileURL } from 'node:url';

const STAGING_URL = 'https://yrqzwqywxfesmbvhzjgj.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function checkFalDispatchStaging(env = process.env, fetcher = fetch) {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'FAL_KEY']) {
        if (!env[name]?.trim()) throw new Error(`Missing protected staging secret: ${name}`);
    }
    // A production key cannot authorize this staging-only endpoint. The UUID
    // is deliberately nonexistent; this checks RPC access without spending.
    const response = await fetcher(`${STAGING_URL}/rest/v1/rpc/claim_fal_dispatch`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json' },
        body: JSON.stringify({ p_job_id: '00000000-0000-4000-8000-000000000000' }),
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Staging claim prerequisite failed: HTTP ${response.status}`);
    const answer = await response.json();
    if (answer?.disposition !== 'MISSING') throw new Error('Unexpected staging prerequisite result');
    return true;
}

/**
 * Read only the operational state needed to decide whether an orphaned Queue
 * message may be acknowledged. Deliberately excludes user, prompt, asset and
 * provider fields so a protected diagnostic run cannot disclose job content.
 */
export async function readFalDispatchStatus(jobId, env = process.env, fetcher = fetch) {
    if (typeof jobId !== 'string' || !UUID.test(jobId)) throw new Error('Invalid dispatch job identifier');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key?.trim()) throw new Error('Missing protected staging secret');
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const query = `id=eq.${encodeURIComponent(jobId)}&select=id,state,error_code,updated_at`;
    const dispatchQuery = `job_id=eq.${encodeURIComponent(jobId)}&select=state,projected_at,recovery_checked_at`;
    try {
        const [jobResponse, dispatchResponse] = await Promise.all([
            fetcher(`${STAGING_URL}/rest/v1/jobs?${query}`, { headers, signal: AbortSignal.timeout(8_000) }),
            fetcher(`${STAGING_URL}/rest/v1/fal_dispatch?${dispatchQuery}`, { headers, signal: AbortSignal.timeout(8_000) }),
        ]);
        if (!jobResponse.ok || !dispatchResponse.ok) throw Error('unreadable');
        const [jobs, dispatches] = await Promise.all([jobResponse.json(), dispatchResponse.json()]);
        const job = Array.isArray(jobs) && jobs.length === 1 ? jobs[0] : null;
        const dispatch = Array.isArray(dispatches) && dispatches.length <= 1 ? dispatches[0] || null : null;
        if (!job || typeof job.state !== 'string' || (job.error_code !== null && typeof job.error_code !== 'string') ||
            (dispatch && (typeof dispatch.state !== 'string' || (dispatch.projected_at !== null && typeof dispatch.projected_at !== 'string') ||
                (dispatch.recovery_checked_at !== null && typeof dispatch.recovery_checked_at !== 'string')))) throw Error('invalid');
        return { found: true, job: { state: job.state, error_code: job.error_code },
            dispatch: dispatch && { state: dispatch.state, projected_at: dispatch.projected_at, recovery_checked_at: dispatch.recovery_checked_at } };
    } catch {
        throw Error('Staging dispatch status unreadable');
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await checkFalDispatchStaging(); console.log('Staging consumer prerequisites passed; no provider call.'); }
    catch { console.error('Staging prerequisites failed; verify protected secrets and migration 0231.'); process.exitCode = 1; }
}
