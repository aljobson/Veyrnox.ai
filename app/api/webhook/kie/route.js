/**
 * POST /api/webhook/kie — kie.ai task callback.
 *
 * kie's HMAC covers only taskId + timestamp, not the body, so a verified
 * callback is a signal to look, never the result: the task is re-read from
 * kie with our key and that answer drives completion (lib/providerCompletion).
 */

import { NextResponse } from 'next/server';
import { verifyCallback, callbackTaskId, fetchTask } from '../../../../packages/adapters/kie.js';
import { envConfig } from '../../../../packages/db/supabase-client.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { findJob, completeJob, extFromUrl } from '../../../../lib/providerCompletion.js';
import { findStep, runtimeDeps, runtimeKeys } from '../../../../lib/autoShortRuntime.js';
import { handleStepCallback } from '../../../../lib/autoShortWebhook.js';

const SOURCE = 'kie';

export async function POST(req) {
    const cfg = envConfig();
    const apiKey = process.env.KIE_API_KEY;
    const hmacKey = process.env.KIE_WEBHOOK_HMAC_KEY;
    // Refuse before consuming anything so the delivery stays replayable.
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !hmacKey || !r2IsConfigured(r2EnvConfig())) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const raw = await req.text();
    let body;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const taskId = callbackTaskId(body);

    const verified = await verifyCallback(taskId, {
        signature: req.headers.get('x-webhook-signature'),
        timestamp: req.headers.get('x-webhook-timestamp'),
    }, { hmacKey });
    if (!verified) {
        console.error('[kie-webhook] signature rejected');
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    try {
        const job = await findJob(cfg, SOURCE, taskId);
        if (!job) {
            // Not a job: it may be one step of an Auto Short (ADR-0029).
            const step = await findStep(cfg, SOURCE, taskId);
            if (step) {
                const r = await kieStep(cfg, apiKey, taskId, step);
                return NextResponse.json(r.body, r.init);
            }
            // Signed with our key, so this is our task: most likely the callback
            // beat job_submitted. Non-2xx asks kie to deliver again.
            return NextResponse.json({ error: 'job_not_found' }, { status: 409 });
        }
        if (job.state === 'STORED') return NextResponse.json({ ok: true, duplicate: true });

        const outcome = await fetchTask(job.provider_endpoint, taskId, { apiKey });
        if (!outcome.ok) {
            console.error('[kie-webhook] task re-read failed', taskId, outcome.error);
            return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 });
        }
        if (outcome.state === 'pending') return NextResponse.json({ ok: true, pending: true });

        const ext = outcome.state === 'success' ? extFromUrl(outcome.outputUrl, '.bin') : '';
        const result = await completeJob({ source: SOURCE, job, providerJobId: taskId, outcome, ext, cfg });
        return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
        console.error('[kie-webhook] completion failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}

/** Re-read the task with our key and apply it to its Auto Short step. */
async function kieStep(cfg, apiKey, taskId, step) {
    const keys = runtimeKeys();
    if (!keys || !process.env.PUBLIC_HOST) return { body: { error: 'not_configured' }, init: { status: 503 } };
    const rec = await fetchTask(step.provider_endpoint, taskId, { apiKey });
    if (!rec.ok) return { body: { error: 'provider_unavailable' }, init: { status: 502 } };
    const outcome = rec.state === 'success' ? { state: 'success', outputUrl: rec.outputUrl }
        : rec.state === 'fail' ? { state: 'fail', errorCode: 'provider_failed' } : { state: 'pending' };
    const deps = runtimeDeps({ cfg, r2cfg: r2EnvConfig(), publicHost: process.env.PUBLIC_HOST, ...keys });
    const r = await handleStepCallback({ source: SOURCE, providerJobId: taskId, step, outcome, deps, cfg });
    return { body: r.body, init: { status: r.status } };
}
