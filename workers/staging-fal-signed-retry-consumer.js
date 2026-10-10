// One owner-approved staging generation; ordinary application/consumer imports none of this.
import { runFalDispatchQueue } from '../lib/falDispatchConsumer.js';
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';
import { FAL_JOB_ID, validFalWakeup } from '../lib/falDispatchMessage.js';

export const FIXTURE_PROMPT = 'A small blue ceramic teapot on a plain white background.';
const relay = 'https://veyrnox-fal-signed-retry-staging.al-jobson.workers.dev/api/webhook/fal';
function allowed(env) {
    const remaining = Date.parse(env.FAL_SIGNED_RETRY_EXPIRES_AT) - Date.now();
    return env.FAL_SIGNED_RETRY_PROVIDER_TEST_APPROVED === 'true'
        && env.SUPABASE_URL === 'https://yrqzwqywxfesmbvhzjgj.supabase.co'
        && env.PUBLIC_HOST === 'https://veyrnox-ai-staging.al-jobson.workers.dev'
        && env.FAL_DISPATCH_QUEUE_NAME === 'veyrnox-fal-dispatch-staging'
        && FAL_JOB_ID.test(env.FAL_SIGNED_RETRY_JOB_ID || '') && FAL_JOB_ID.test(env.FAL_SIGNED_RETRY_USER_ID || '')
        && /^signed-retry-fixture-[a-f0-9]{8}$/.test(env.FAL_SIGNED_RETRY_MODEL_ID || '')
        && remaining > 0 && remaining <= 900_000 && env.CALLBACK_GATE && env.SUPABASE_SERVICE_ROLE_KEY;
}
function fixedPayload(payload) {
    return payload?.prompt === FIXTURE_PROMPT && payload?.num_images === 1
        && Object.keys(payload).sort().join(',') === 'image_size,num_images,prompt'
        && payload.image_size?.width === 1024 && payload.image_size?.height === 768
        && Object.keys(payload.image_size).sort().join(',') === 'height,width';
}
export async function signedRetryQueue(batch, env, { rpc = realRpc, submit = submitJob, fetchCall = fetchWithTimeout } = {}) {
    for (const message of batch.messages) {
        const jobId = message.body?.job_id;
        if (!allowed(env) || batch.queue !== env.FAL_DISPATCH_QUEUE_NAME
            || !validFalWakeup(message.body) || jobId !== env.FAL_SIGNED_RETRY_JOB_ID) { message.retry({ delaySeconds: 30 }); continue; }
        // Verify dedicated ownership before any recovery, claim or provider call.
        const url = new URL('/rest/v1/jobs', env.SUPABASE_URL);
        url.searchParams.set('id', `eq.${jobId}`); url.searchParams.set('select', 'id,user_id,model_id,credits,free_allowance,provider_job_id');
        let fact;
        try {
            const response = await fetchCall(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
            if (response.ok) fact = (await response.json())[0];
        } catch { /* No claim on ambiguous ownership. */ }
        if (fact?.id !== jobId || fact.user_id !== env.FAL_SIGNED_RETRY_USER_ID || fact.model_id !== env.FAL_SIGNED_RETRY_MODEL_ID
            || fact.credits !== 2 || fact.free_allowance !== false) { message.retry({ delaySeconds: 30 }); continue; }
        const gate = env.CALLBACK_GATE.getByName(jobId);
        // A duplicate can repair only the private relay mapping from the existing DB handle.
        if (fact.provider_job_id) {
            try { await gate.register(jobId, fact.provider_job_id); } catch { /* Keep normal fencing and retained DB evidence. */ }
        }
        const fencedSubmit = async (job, cfg) => {
            if (!allowed(env) || job.job_id !== jobId || job.provider_endpoint !== 'fal-ai/flux-2-pro' || !fixedPayload(job.inputs)) throw Error('bounded submission refused');
            const answer = await submit(job, { ...cfg, webhookBaseUrl: relay });
            if (answer?.outcome === 'accepted') {
                let registered = false;
                try { registered = await gate.register(jobId, answer.providerJobId); } catch { /* Preserve accepted evidence even if relay registration fails. */ }
                if (!registered) console.error(JSON.stringify({ event: 'staging.fal_signed_mapping_pending', job_id: jobId }));
            }
            return answer;
        };
        await runFalDispatchQueue({ ...batch, messages: [message] }, env, { rpc, submit: fencedSubmit });
    }
}
export default { queue: signedRetryQueue, fetch: async () => new Response(null, { status: 404 }) };
