// Temporary staging-only consumer. Transport uses a private fault service.
import { runFalDispatchQueue } from '../lib/falDispatchConsumer.js';
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { FAL_JOB_ID, validFalWakeup } from '../lib/falDispatchMessage.js';

export function transportPlan(env, now = Date.now()) {
    if (env.SUPABASE_URL !== 'https://yrqzwqywxfesmbvhzjgj.supabase.co'
        || env.PUBLIC_HOST !== 'https://veyrnox-ai-staging.al-jobson.workers.dev'
        || env.FAL_DISPATCH_QUEUE_NAME !== 'veyrnox-fal-dispatch-staging'
        || env.FAL_TRANSPORT_EXERCISE_ENABLED !== 'true') return null;
    const remaining = Date.parse(env.FAL_TRANSPORT_EXPIRES_AT) - now;
    if (!(remaining > 0 && remaining <= 900_000)) return null;
    try {
        const plan = JSON.parse(env.FAL_TRANSPORT_JOB_SCENARIOS);
        if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 2
            || !Object.entries(plan).every(([id, scenario]) => FAL_JOB_ID.test(id) && ['lost_reply', 'lost_body'].includes(scenario))
            || new Set(Object.values(plan)).size !== 2) return null;
        return plan;
    } catch { return null; }
}

export async function exerciseTransport(batch, env, { rpc = realRpc, now = Date.now } = {}) {
    const plan = transportPlan(env, now());
    for (const message of batch.messages) {
        if (!plan || !validFalWakeup(message.body) || !Object.hasOwn(plan, message.body.job_id)
            || !env.FAL_TRANSPORT_FIXTURE?.fetch) { message.retry({ delaySeconds: 30 }); continue; }
        const jobId = message.body.job_id, scenario = plan[jobId];
        let posts = 0, writes = 0;
        const injectedRpc = async (name, args, cfg) => {
            const result = await rpc(name, args, cfg);
            if (name === 'claim_fal_dispatch' && result?.disposition === 'CLAIMED'
                && (result.job_id !== jobId || result.endpoint !== 'staging-transport/controlled')) {
                throw Error('controlled fixture identity mismatch');
            }
            if (name === 'record_fal_dispatch') {
                if (args.p_outcome !== 'UNKNOWN' || args.p_provider_job_id !== null) throw Error('unexpected transport outcome');
                if (writes++ === 0 && scenario === 'lost_reply') throw Error('controlled lost evidence acknowledgement');
            }
            return result;
        };
        const submit = (job, cfg) => {
            if (job.job_id !== jobId || job.provider_endpoint !== 'staging-transport/controlled') throw Error('fixture submission refused');
            return submitJob(job, { ...cfg, falKey: 'controlled-no-provider-key' }, async (url, init) => {
                const parsed = new URL(url);
                if (parsed.origin !== 'https://queue.fal.run' || parsed.pathname !== '/staging-transport/controlled'
                    || init.method !== 'POST' || new URL(parsed.searchParams.get('fal_webhook')).searchParams.get('job_id') !== jobId) {
                    throw Error('unexpected outbound transport refused');
                }
                posts++;
                return env.FAL_TRANSPORT_FIXTURE.fetch(url, init);
            });
        };
        const result = await runFalDispatchQueue({ ...batch, messages: [message] },
            { ...env, FAL_KEY: 'controlled-no-provider-key' }, { rpc: injectedRpc, submit, now });
        console.log(JSON.stringify({ event: 'staging.fal_transport_result', job_id: jobId, scenario,
            transport_posts: posts, evidence_writes: writes, ...result }));
    }
}

const worker = { fetch() { return new Response('Not found', { status: 404 }); }, queue: exerciseTransport };
export default worker;
