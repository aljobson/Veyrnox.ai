import { it, expect, vi } from 'vitest';
import worker, { signedRetryQueue, FIXTURE_PROMPT } from '../../workers/staging-fal-signed-retry-consumer.js';
const job = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333', handle = '44444444-4444-4444-8444-444444444444';
const environment = () => ({ SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co', PUBLIC_HOST: 'https://veyrnox-ai-staging.al-jobson.workers.dev',
    FAL_DISPATCH_QUEUE_NAME: 'veyrnox-fal-dispatch-staging', FAL_DISPATCH_SCHEMA_ENABLED: 'true', FAL_DISPATCH_QUEUE_CONSUMER_ENABLED: 'true',
    SUPABASE_SERVICE_ROLE_KEY: 'inert-service', FAL_KEY: 'inert-fal', FAL_SIGNED_RETRY_PROVIDER_TEST_APPROVED: 'true',
    FAL_SIGNED_RETRY_JOB_ID: job, FAL_SIGNED_RETRY_USER_ID: user, FAL_SIGNED_RETRY_MODEL_ID: 'signed-retry-fixture-1234abcd',
    FAL_SIGNED_RETRY_EXPIRES_AT: new Date(Date.now()+600_000).toISOString(), CALLBACK_GATE: { getByName: () => ({ register: vi.fn(async () => true) }) } });
const msg = (id = job) => ({ body: { version: 1, job_id: id }, ack: vi.fn(), retry: vi.fn() });
const batch = (env, m) => ({ queue: env.FAL_DISPATCH_QUEUE_NAME, messages: [m] });
const fact = env => ({ id: job, user_id: user, model_id: env.FAL_SIGNED_RETRY_MODEL_ID, credits: 2, free_allowance: false, provider_job_id: null });
it('requires approval, staging, dedicated ownership and an exact reference before DB mutation or provider spend', async () => {
    for (const patch of [{ FAL_SIGNED_RETRY_PROVIDER_TEST_APPROVED: 'false' }, { SUPABASE_URL: 'https://production.test' }, { FAL_SIGNED_RETRY_EXPIRES_AT: new Date(0).toISOString() }]) {
        const env = { ...environment(), ...patch }, m = msg(); const fetchCall = vi.fn(), rpc = vi.fn(), submit = vi.fn();
        await signedRetryQueue(batch(env,m),env,{ fetchCall,rpc,submit });
        expect(fetchCall).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(m.retry).toHaveBeenCalled();
    }
    const env = environment(), m = msg(); const rpc = vi.fn(), submit = vi.fn();
    await signedRetryQueue(batch(env,m),env,{ fetchCall: async () => Response.json([{ ...fact(env), user_id: token }]),rpc,submit });
    expect(rpc).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(m.retry).toHaveBeenCalled();
    expect((await worker.fetch()).status).toBe(404);
});
it('one fenced accepted submission pins the relay; mapping failure preserves accepted evidence; duplicate repairs without resubmission', async () => {
    const env = environment(); let started = false, accepted = null; const records = [];
    const register = vi.fn(async () => { throw Error('mapping acknowledgement lost'); });
    env.CALLBACK_GATE = { getByName: () => ({ register }) };
    const rpc = async (name,args) => {
        if (name === 'recover_fal_dispatch') return { ok: true };
        if (name === 'record_fal_dispatch') { records.push(args); accepted = args.p_provider_job_id; return { ok: true }; }
        if (started) return { disposition: 'INELIGIBLE' };
        started = true; return { disposition: 'CLAIMED', job_id: job, attempt_token: token, endpoint: 'fal-ai/flux-2-pro',
            payload: { prompt: FIXTURE_PROMPT, image_size: { width: 1024, height: 768 }, num_images: 1 } };
    };
    const submit = vi.fn(async (job,cfg) => {
        expect(cfg.webhookBaseUrl).toBe('https://veyrnox-fal-signed-retry-staging.al-jobson.workers.dev/api/webhook/fal');
        return { outcome: 'accepted', providerJobId: handle };
    });
    const fetchCall = async () => Response.json([{ ...fact(env), provider_job_id: accepted }]);
    const first = msg(); await signedRetryQueue(batch(env,first),env,{ rpc,submit,fetchCall });
    expect(first.ack).toHaveBeenCalled(); expect(records[0].p_outcome).toBe('ACCEPTED'); expect(accepted).toBe(handle);
    register.mockResolvedValue(true);
    const duplicate = msg(); await signedRetryQueue(batch(env,duplicate),env,{ rpc,submit,fetchCall });
    expect(duplicate.ack).toHaveBeenCalled(); expect(submit).toHaveBeenCalledTimes(1); expect(register).toHaveBeenLastCalledWith(job,handle);
});
it('payloads outside the approved image count and dimensions never reach the provider', async () => {
    for (const changed of [{ num_images: 2 }, { image_size: { width: 2048, height: 2048 } }, { image_urls: ['https://outside.test/input.png'] }]) {
        const env = environment(), m = msg(), records = [];
        const submit = vi.fn();
        const rpc = async (name,args) => {
            if (name === 'recover_fal_dispatch') return { ok: true };
            if (name === 'record_fal_dispatch') { records.push(args); return { ok: true }; }
            return { disposition: 'CLAIMED', job_id: job, attempt_token: token, endpoint: 'fal-ai/flux-2-pro',
                payload: { prompt: FIXTURE_PROMPT, image_size: { width: 1024, height: 768 }, num_images: 1, ...changed } };
        };
        await signedRetryQueue(batch(env,m),env,{ rpc,submit,fetchCall: async () => Response.json([fact(env)]) });
        expect(submit).not.toHaveBeenCalled(); expect(records[0].p_outcome).toBe('UNKNOWN'); expect(m.ack).toHaveBeenCalled();
    }
});
