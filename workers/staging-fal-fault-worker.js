// Temporary staging consumer exercise. Never calls a provider adapter.
import { runFalDispatchQueue } from '../lib/falDispatchConsumer.js';
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { FAL_JOB_ID, validFalWakeup } from '../lib/falDispatchMessage.js';

const scenarios = new Set(['lost_claim_ack', 'lost_evidence_ack']);
export function faultPlan(env, now = Date.now()) {
    if (env.SUPABASE_URL !== 'https://yrqzwqywxfesmbvhzjgj.supabase.co'
        || env.PUBLIC_HOST !== 'https://veyrnox-ai-staging.al-jobson.workers.dev'
        || env.FAL_FAULT_EXERCISE_ENABLED !== 'true'
        || env.FAL_DISPATCH_QUEUE_NAME !== 'veyrnox-fal-dispatch-staging') return null;
    const remaining = Date.parse(env.FAL_FAULT_EXPIRES_AT) - now;
    if (!(remaining > 0 && remaining <= 15 * 60_000)) return null;
    try {
        const plan = JSON.parse(env.FAL_FAULT_JOB_SCENARIOS);
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)
            || Object.keys(plan).length !== 2
            || !Object.entries(plan).every(([id, scenario]) => FAL_JOB_ID.test(id) && scenarios.has(scenario))
            || new Set(Object.values(plan)).size !== 2) return null;
        return plan;
    } catch { return null; }
}

export async function exerciseQueue(batch, env, { rpc = realRpc, now = Date.now } = {}) {
    const plan = faultPlan(env, now());
    for (const message of batch.messages) {
        if (!plan || !validFalWakeup(message.body) || !Object.hasOwn(plan, message.body.job_id)) {
            message.retry({ delaySeconds: 30 });
            continue;
        }
        const jobId = message.body.job_id;
        const scenario = plan[jobId];
        let evidenceWrites = 0;
        let submits = 0;
        const injectedRpc = async (name, args, cfg) => {
            const result = await rpc(name, args, cfg);
            if (name === 'claim_fal_dispatch' && result?.disposition === 'CLAIMED') {
                if (result.job_id !== jobId || result.endpoint !== 'staging-fault/controlled') {
                    throw new Error('fixture identity or endpoint mismatch');
                }
                if (scenario === 'lost_claim_ack') throw new Error('controlled lost claim acknowledgement');
            }
            if (name === 'record_fal_dispatch' && scenario === 'lost_evidence_ack' && evidenceWrites++ === 0) {
                throw new Error('controlled lost evidence acknowledgement');
            }
            return result;
        };
        const submit = async job => {
            if (job.job_id !== jobId || job.provider_endpoint !== 'staging-fault/controlled') {
                throw new Error('fixture submission refused');
            }
            submits++;
            return { outcome: 'accepted', providerJobId: `staging-fault-${jobId}` };
        };
        const result = await runFalDispatchQueue({ ...batch, messages: [message] },
            { ...env, FAL_KEY: 'controlled-adapter-no-provider-credential' }, { rpc: injectedRpc, submit, now });
        console.log(JSON.stringify({ event: 'staging.fal_fault_result', job_id: jobId, scenario,
            adapter_calls: submits, evidence_writes: evidenceWrites, ...result }));
    }
}

const worker = {
    fetch() { return new Response('Not found', { status: 404 }); },
    async scheduled(_event, env) {
        const plan = faultPlan(env);
        if (!plan || !env.FAL_FAULT_QUEUE?.send) return;
        for (const jobId of Object.keys(plan)) await env.FAL_FAULT_QUEUE.send({ version: 1, job_id: jobId });
    },
    queue: exerciseQueue,
};
export default worker;
