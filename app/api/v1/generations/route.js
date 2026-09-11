/**
 * POST /api/v1/generations — submit a generation.
 *
 * Full path:
 *   1. middleware.js verified the JWT and set x-veyrnox-auth-id
 *   2. Parse + validate body: { model_id, idempotency_key, inputs }
 *   3. Look up the model in model_catalog (price, endpoint, gated flag)
 *   4. Resolve users.id from auth_id
 *   5. ledger_debit RPC — atomic: creates jobs row (state=DEBITED),
 *      appends -delta ledger entry, updates balance. Returns fast on
 *      idempotent replay.
 *   6. fal.submitJob — POST to queue.fal.run/<endpoint>. Fails? refund.
 *   7. job_submitted RPC — records provider + provider_job_id, moves
 *      state DEBITED -> SUBMITTED.
 *   8. Return { job_id, state, balance_after }.
 *
 * The response never includes provider details (fal request id, status
 * url) — the client polls our /api/v1/jobs/:id in a later slice.
 */

import { NextResponse } from 'next/server';
import { rpc, select, envConfig, SupabaseError } from '../../../../packages/db/supabase-client.js';
import { submitJob } from '../../../../packages/adapters/fal.js';

// Constrain idempotency keys to a safe printable range.
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

    const cfg = envConfig();
    const falKey = process.env.FAL_KEY;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !falKey || !publicHost) {
        return NextResponse.json({ error: 'gateway not configured' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
    const modelId = body && body.model_id;
    const idempotencyKey = body && body.idempotency_key;
    const inputs = body && body.inputs;
    if (typeof modelId !== 'string' || !modelId) return NextResponse.json({ error: 'model_id required' }, { status: 400 });
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
        return NextResponse.json({ error: 'idempotency_key required (8-128 chars, [A-Za-z0-9._-])' }, { status: 400 });
    }
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
        return NextResponse.json({ error: 'inputs must be an object' }, { status: 400 });
    }

    // 0. Per-user rate-limit check. Postgres-backed sliding window against
    //    jobs.created_at — no dedicated table, no external cache. One RPC
    //    call adds ~10-30ms to the hot path; acceptable, we already do
    //    several Postgres calls per submission.
    //
    //    Baseline: 10 generations per 60 seconds per user. Applies to
    //    every plan for now; tier-specific limits arrive with Phase 4
    //    premium gating.
    try {
        const rl = await rpc('check_generation_rate_limit', {
            p_auth_id: authId,
            p_limit_per_window: 10,
            p_window_seconds: 60,
        }, cfg);
        if (rl && rl.ok === false) {
            if (rl.code === 'RATE_LIMITED') {
                const retryAfter = Math.max(1, Math.min(600, Number(rl.retry_after_seconds) || 60));
                return new NextResponse(
                    JSON.stringify({ error: 'rate_limited', limit: rl.limit, count: rl.count, retry_after_seconds: retryAfter }),
                    {
                        status: 429,
                        headers: {
                            'content-type': 'application/json',
                            'retry-after': String(retryAfter),
                        },
                    }
                );
            }
            if (rl.code === 'USER_NOT_FOUND') {
                return NextResponse.json({ error: 'user not provisioned' }, { status: 401 });
            }
            return NextResponse.json({ error: rl.code || 'rate check failed' }, { status: 400 });
        }
    } catch (err) {
        // Rate-limit check failure is not fatal — the downstream ledger_debit
        // still gates money movement. Log and continue.
        console.warn('[generations] rate check errored, continuing:', err);
    }

    // 1. Look up the model in the catalog.
    let modelRow;
    try {
        const rows = await select(
            'model_catalog',
            { columns: 'id,provider,provider_endpoint,credits_5s,gated_flag,active', filter: `id=eq.${encodeURIComponent(modelId)}` },
            cfg,
        );
        modelRow = Array.isArray(rows) && rows[0];
    } catch (err) {
        console.error('[generations] catalog lookup failed:', err);
        return NextResponse.json({ error: 'catalog lookup failed' }, { status: 502 });
    }
    if (!modelRow || !modelRow.active) return NextResponse.json({ error: 'unknown model' }, { status: 404 });
    if (modelRow.provider !== 'fal') return NextResponse.json({ error: 'model not on fal.ai (Slice 5)' }, { status: 501 });
    if (modelRow.gated_flag) return NextResponse.json({ error: 'gated model — plan check pending (Phase 4)' }, { status: 402 });

    // 2. Resolve users.id from auth_id.
    let userId;
    try {
        const userRows = await select(
            'users',
            { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}` },
            cfg,
        );
        userId = Array.isArray(userRows) && userRows[0] && userRows[0].id;
    } catch (err) {
        console.error('[generations] user lookup failed:', err);
        return NextResponse.json({ error: 'user lookup failed' }, { status: 502 });
    }
    if (!userId) return NextResponse.json({ error: 'user not provisioned' }, { status: 401 });

    // 3. Debit atomically. Creates jobs row too.
    let debit;
    try {
        debit = await rpc('ledger_debit', {
            p_user_id: userId,
            p_idempotency_key: idempotencyKey,
            p_credits: modelRow.credits_5s,
            p_reason: 'debit:generation',
            p_model_id: modelId,
            p_inputs: inputs,
        }, cfg);
    } catch (err) {
        console.error('[generations] ledger_debit failed:', err);
        return NextResponse.json({ error: 'debit failed' }, { status: 502 });
    }
    if (!debit || debit.ok === false) {
        const status = debit && debit.code === 'INSUFFICIENT_BALANCE' ? 402 : 400;
        // Don't leak DB/RPC messages to the client — log server-side only.
        if (debit && debit.message) console.error('[generations] debit rejected:', debit.code, debit.message);
        return NextResponse.json({ error: (debit && debit.code) || 'debit rejected' }, { status });
    }

    const jobId = debit.job_id;
    const idempotent = debit.idempotent;
    const balanceAfter = debit.balance_after;

    // Idempotent replay — job already exists. Don't resubmit to fal; return
    // the existing shape. The state may be anywhere from DEBITED through
    // STORED; the client polls to learn.
    if (idempotent) {
        return NextResponse.json({ job_id: jobId, idempotent: true, balance_after: balanceAfter });
    }

    // 4. Submit to fal.
    const webhookBaseUrl = new URL('/api/webhook/fal', publicHost).toString();
    const falResult = await submitJob({
        job_id: jobId,
        provider_endpoint: modelRow.provider_endpoint,
        inputs,
    }, { falKey, webhookBaseUrl });

    if (!falResult.ok) {
        // Refund immediately — fal wouldn't take the job so we owe the credits back.
        try {
            await rpc('ledger_refund', {
                p_job_id: jobId,
                p_user_id: userId,
                p_credits: modelRow.credits_5s,
                p_reason: 'refund:submit_failed',
            }, cfg);
        } catch (err) {
            // Log — the job stays in DEBITED and the reconcile job will flag it.
            console.error('[generations] refund-on-submit-fail failed:', err);
        }
        console.error('[generations] fal submit failed:', falResult.error);
        // Don't leak upstream vendor payloads to the client — log only.
        return NextResponse.json({ error: 'provider submit failed' }, { status: 502 });
    }

    // 5. Move state to SUBMITTED and record provider job id.
    try {
        await rpc('job_submitted', {
            p_job_id: jobId,
            p_provider: 'fal',
            p_provider_job_id: falResult.providerJobId,
        }, cfg);
    } catch (err) {
        // The debit + fal submit both succeeded — the state row is
        // slightly out of sync. Not user-facing; the reconcile job or
        // webhook arrival will correct it.
        console.error('[generations] job_submitted RPC failed:', err);
    }

    return NextResponse.json({
        job_id: jobId,
        state: 'SUBMITTED',
        balance_after: balanceAfter,
    });
}
