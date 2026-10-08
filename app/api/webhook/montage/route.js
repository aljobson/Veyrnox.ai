/**
 * POST /api/webhook/montage — signed callbacks from the isolated video-agent
 * runner (ADR-0074 §4). The HMAC covers `<t>.<raw body>` with a 300 s window;
 * the step is found by the run id we chose (`mr_<job id>`) and user, job and
 * R2 key all come from our rows, never from the payload. Not behind
 * AGENT_VIDEO_ENABLED: a run already paid for must still finish or refund.
 */

import { NextResponse } from 'next/server';
import { envConfig } from '../../../../packages/db/supabase-client.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { verifyRunnerBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../../../lib/montageSigning.js';
import { findStep } from '../../../../lib/autoShortRuntime.js';
import { montageDeps, runtimeConfig } from '../../../../lib/montageRuntime.js';
import { parseEvent, handleRunnerEvent, SOURCE } from '../../../../lib/montageWebhook.js';

const RUN_ID_RE = /^mr_[0-9a-f-]{36}$/i;
const MAX_BODY = 16 * 1024;

export async function POST(req) {
    const cfg = envConfig();
    const rt = runtimeConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !rt || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.length > MAX_BODY) return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
    const ok = await verifyRunnerBody(rt.runnerSecret, raw, req.headers.get(TIMESTAMP_HEADER), req.headers.get(SIGNATURE_HEADER));
    if (!ok) {
        console.error('[video-agent-webhook] signature rejected');
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const event = parseEvent(body);
    const runId = body && body.run_id;
    if (!event || !RUN_ID_RE.test(String(runId || ''))) return NextResponse.json({ error: 'invalid_event' }, { status: 400 });

    try {
        const step = await findStep(cfg, SOURCE, runId);
        if (!step) return NextResponse.json({ error: 'step_not_found' }, { status: 409 });
        const result = await handleRunnerEvent({ event, step, deps: montageDeps({ cfg, r2cfg, ...rt }), cfg });
        return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
        console.error('[video-agent-webhook] failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}
