/**
 * POST /api/webhook/openrouter — OpenRouter video job callback.
 *
 * The signature covers the body, but the job is still re-read with our key:
 * the output is only downloadable from OpenRouter's content endpoint, and the
 * status read is the same code path either way.
 */

import { NextResponse } from 'next/server';
import { verifyWebhook, fetchVideo, contentUrl } from '../../../../packages/adapters/openrouter.js';
import { envConfig } from '../../../../packages/db/supabase-client.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { findJob, completeJob } from '../../../../lib/providerCompletion.js';

const SOURCE = 'openrouter';

export async function POST(req) {
    const cfg = envConfig();
    const apiKey = process.env.OPENROUTER_API_KEY;
    const secret = process.env.OPENROUTER_WEBHOOK_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !secret || !r2IsConfigured(r2EnvConfig())) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    const verified = await verifyWebhook(raw, req.headers.get('x-openrouter-signature'), { secret });
    if (!verified) {
        console.error('[openrouter-webhook] signature rejected');
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const videoId = body && (body.id || (body.data && body.data.id));

    try {
        const job = await findJob(cfg, SOURCE, videoId);
        if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 409 });
        if (job.state === 'STORED') return NextResponse.json({ ok: true, duplicate: true });

        const status = await fetchVideo(videoId, { apiKey });
        if (!status.ok) {
            console.error('[openrouter-webhook] job re-read failed', videoId, status.error);
            return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 });
        }
        if (status.state === 'pending') return NextResponse.json({ ok: true, pending: true });

        const outcome = status.state === 'success'
            ? { state: 'success', outputUrl: contentUrl(videoId, 0) }
            : { state: 'fail', errorCode: status.errorCode };
        const result = await completeJob({
            source: SOURCE, job, providerJobId: videoId, outcome, ext: '.mp4', cfg,
            copyOptions: { authorization: `Bearer ${apiKey}` },
        });
        return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
        console.error('[openrouter-webhook] completion failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}
