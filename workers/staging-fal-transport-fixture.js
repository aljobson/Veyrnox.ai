// Private service binding only: workers_dev false, no routes or credentials.
import { transportPlan } from './staging-fal-transport-worker.js';

export async function fixtureFetch(request, env) {
    const plan = transportPlan(env);
    const url = new URL(request.url);
    let webhook;
    try { webhook = new URL(url.searchParams.get('fal_webhook')); } catch { return new Response('Not found', { status: 404 }); }
    const jobId = webhook.searchParams.get('job_id');
    if (!plan || !Object.hasOwn(plan, jobId) || request.method !== 'POST'
        || url.origin !== 'https://queue.fal.run' || url.pathname !== '/staging-transport/controlled'
        || webhook.origin !== env.PUBLIC_HOST || webhook.pathname !== '/api/webhook/fal'
        || request.headers.get('authorization') !== 'Key controlled-no-provider-key') {
        return new Response('Not found', { status: 404 });
    }
    const body = await request.json();
    if (body.prompt !== 'controlled staging transport fixture' || Object.keys(body).some(key => !['prompt', 'image_size'].includes(key))) {
        return new Response('Not found', { status: 404 });
    }
    console.log(JSON.stringify({ event: 'staging.fal_transport_received', job_id: jobId, scenario: plan[jobId] }));
    if (plan[jobId] === 'lost_reply') throw Error('controlled transport reply loss');
    let sent = false;
    return new Response(new ReadableStream({
        pull(controller) {
            if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('{"request_id":"controlled')); }
            else controller.error(Error('controlled acceptance body loss'));
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
}
const worker = { fetch: fixtureFetch };
export default worker;
