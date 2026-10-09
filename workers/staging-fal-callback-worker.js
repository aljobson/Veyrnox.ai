// Operator-only controlled callback recovery exercise. No HTTP dispatch or fal calls.
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';
import { FAL_JOB_ID, validFalWakeup } from '../lib/falDispatchMessage.js';

export function callbackPlan(env, now = Date.now()) {
    if (env.SUPABASE_URL !== 'https://yrqzwqywxfesmbvhzjgj.supabase.co'
        || env.PUBLIC_HOST !== 'https://veyrnox-ai-staging.al-jobson.workers.dev'
        || env.FAL_DISPATCH_QUEUE_NAME !== 'veyrnox-fal-dispatch-staging'
        || env.FAL_CALLBACK_EXERCISE_ENABLED !== 'true'
        || !FAL_JOB_ID.test(env.FAL_CALLBACK_FIXTURE_USER || '')
        || !env.FAL_CALLBACK_FIXTURE_MODEL?.startsWith('deployed-fault-')) return null;
    const remaining = Date.parse(env.FAL_CALLBACK_EXPIRES_AT) - now;
    if (!(remaining > 0 && remaining <= 15 * 60_000)) return null;
    try {
        const plan = JSON.parse(env.FAL_CALLBACK_SCENARIOS);
        if (!plan || Array.isArray(plan) || Object.keys(plan).length !== 2
            || !Object.keys(plan).every(id => FAL_JOB_ID.test(id))
            || !Object.values(plan).includes('copy_failure')
            || !Object.values(plan).includes('lost_stored_ack')) return null;
        return plan;
    } catch { return null; }
}

export async function callbackQueue(batch, env, { rpc = realRpc, http = fetchWithTimeout, now = Date.now } = {}) {
    const plan = callbackPlan(env, now());
    for (const message of batch.messages) {
        if (!plan || !validFalWakeup(message.body) || !Object.hasOwn(plan, message.body.job_id)
            || !env.FAL_CALLBACK_BUCKET?.put || !env.SUPABASE_SERVICE_ROLE_KEY) {
            message.retry({ delaySeconds: 30 }); continue;
        }
        const id = message.body.job_id, handle = `staging-callback-${id}`;
        const cfg = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
        const headers = { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` };
        // Verify dedicated fixture ownership before calling the real handler or mutating anything.
        const url = new URL('/rest/v1/jobs', cfg.supabaseUrl);
        url.search = new URLSearchParams({ id: `eq.${id}`, select: 'id,user_id,model_id,provider,provider_job_id,state', limit: '1' });
        try {
            const res = await http(url, { headers });
            if (!res.ok) throw new Error('fixture read failed');
            const rows = await res.json(), job = rows[0];
            if (rows.length !== 1 || job.id !== id || job.user_id !== env.FAL_CALLBACK_FIXTURE_USER
                || job.model_id !== env.FAL_CALLBACK_FIXTURE_MODEL || job.provider !== 'fal'
                || job.provider_job_id !== handle || !['SUBMITTED', 'SUCCEEDED', 'STORED'].includes(job.state)) {
                throw new Error('fixture identity refused');
            }
            if (job.state === 'STORED') { message.ack(); continue; }
            let copies = 0, registrations = 0;
            const scenario = plan[id];
            const handler = createFalWebhookHandler({
                config: () => cfg,
                expectedTenant: () => 'controlled-internal-fixture',
                storageConfig: () => ({ accountId: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' }),
                // These requests are created below, never accepted over HTTP. This is not fal signature evidence.
                verify: async (_raw, signed) => signed.requestId === handle && signed.userId === 'controlled-internal-fixture',
                fetchCall: http,
                rpcCall: async (name, args, options) => {
                    if (!['job_succeeded', 'job_stored'].includes(name) || args.p_provider !== 'fal'
                        || args.p_provider_job_id !== handle) throw new Error('fixture RPC refused');
                    const result = await rpc(name, args, options);
                    if (name === 'job_stored') {
                        registrations++;
                        if (scenario === 'lost_stored_ack' && registrations === 1 && result?.ok) {
                            throw new Error('controlled committed registration acknowledgement loss');
                        }
                    }
                    return result;
                },
                copyAsset: async (source, key) => {
                    if (source !== 'https://fal.media/controlled-fixture.png' || !key.startsWith(`fal/${handle}/`)) {
                        throw new Error('fixture copy refused');
                    }
                    copies++;
                    if (scenario === 'copy_failure' && copies === 1) return { ok: false, error: 'controlled transient copy failure' };
                    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII='), c => c.charCodeAt(0));
                    await env.FAL_CALLBACK_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
                    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
                    return { ok: true, r2Key: key, mimeType: 'image/png', size: bytes.length, sha256 };
                },
            });
            const statuses = [];
            for (let delivery = 0; delivery < 3; delivery++) {
                const req = new Request('https://controlled.invalid/api/webhook/fal', { method: 'POST',
                    headers: { 'x-fal-webhook-request-id': handle, 'x-fal-webhook-user-id': 'controlled-internal-fixture' },
                    body: JSON.stringify({ request_id: handle, status: 'OK', payload: { images: [{ url: 'https://fal.media/controlled-fixture.png' }] } }),
                });
                statuses.push((await handler(req)).status);
            }
            const passed = statuses.join(',') === '500,200,200' && registrations === 1
                && copies === (scenario === 'copy_failure' ? 2 : 1);
            console.log(JSON.stringify({ event: 'staging.callback_fault_result', job_id: id, scenario, statuses, copies, registrations, passed }));
            if (passed) message.ack(); else message.retry({ delaySeconds: 30 });
        } catch {
            console.log(JSON.stringify({ event: 'staging.callback_fault_error', job_id: id }));
            message.retry({ delaySeconds: 30 });
        }
    }
}
const worker = { fetch() { return new Response('Not found', { status: 404 }); }, queue: callbackQueue };
export default worker;
