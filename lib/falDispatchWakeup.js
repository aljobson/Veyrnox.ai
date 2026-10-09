import { getCloudflareContext } from '@opennextjs/cloudflare';
import { validFalWakeup } from './falDispatchMessage.js';

async function sendBounded(queue, jobId, timeoutMs) {
    let timer;
    try {
        await Promise.race([
            queue.send({ version: 1, job_id: jobId }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('publish timeout')), timeoutMs); }),
        ]);
    } catch {
        // A timed-out send may still commit. Duplicate references are safe.
        console.error(JSON.stringify({ event: 'generation.dispatch_wakeup_failed', job_id: jobId }));
    } finally { clearTimeout(timer); }
}

/** Called only after confirmed admission; attaches work to the request lifetime. */
export function publishFalDispatchWakeup(jobId, { env = process.env, context = getCloudflareContext, timeoutMs = 2000 } = {}) {
    if (env.FAL_DISPATCH_QUEUE_ENABLED !== 'true') return;
    if (!validFalWakeup({ version: 1, job_id: jobId })) throw new Error('invalid committed job');
    const { env: bindings, ctx } = context();
    if (!bindings?.FAL_DISPATCH_QUEUE?.send || !ctx?.waitUntil) throw new Error('queue not configured');
    ctx.waitUntil(sendBounded(bindings.FAL_DISPATCH_QUEUE, jobId, timeoutMs));
}
