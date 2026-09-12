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

// Provider payload allowlist. `inputs` is forwarded to fal verbatim, so
// every key the user may set is enumerated here with a bound; anything
// else is rejected. Quantity knobs (num_images, num_frames, duration
// beyond the priced unit, ...) are deliberately absent: the catalog price
// is per 5-second unit / single output and the payload must not buy more.
const MAX_INPUTS_BYTES = 8 * 1024;
const UNIT_SECONDS = 5;
const RATE_LIMIT_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60;
// `resolution` is deliberately absent: fal bills per tier and the catalog
// holds one cost per model (its priced tier), so the server never lets a
// request select a pricier tier. The provider default is the priced one.
const ALLOWED_INPUTS = {
    prompt: { kind: 'string', max: 2000 },
    negative_prompt: { kind: 'string', max: 2000 },
    aspect_ratio: { kind: 'enum', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9'] },
    duration_seconds: { kind: 'enum', values: [5, 10] },
    seed: { kind: 'int', min: 0, max: 2147483647 },
    image_url: { kind: 'url' },
};

// How each fal endpoint family expresses a clip length. `duration_seconds`
// is our field, not fal's; without this mapping the model runs at its
// default length while we bill for the requested one. Families not listed
// only accept the 5-second unit and receive no length field at all.
// ponytail: two families known; extend from each endpoint's OpenAPI as models land.
const DURATION_FIELDS = [
    { prefix: 'fal-ai/wan', field: 'duration', values: { 5: '5', 10: '10' } },
    { prefix: 'fal-ai/kling-video', field: 'duration', values: { 5: '5', 10: '10' } },
];

function durationSpec(modelRow) {
    const ep = String(modelRow.provider_endpoint || '');
    return DURATION_FIELDS.find((d) => ep.startsWith(d.prefix)) || null;
}

/** Translate validated inputs into the provider payload: only fal's own fields go out. */
function shapeForProvider(modelRow, inputs) {
    const { duration_seconds, ...rest } = inputs;
    const spec = durationSpec(modelRow);
    if (spec && duration_seconds) rest[spec.field] = spec.values[duration_seconds];
    return rest;
}

/** @returns {{ok:true}|{ok:false,error:string}} */
function validateInputs(inputs) {
    if (JSON.stringify(inputs).length > MAX_INPUTS_BYTES) return { ok: false, error: 'inputs_too_large' };
    for (const [key, value] of Object.entries(inputs)) {
        const rule = ALLOWED_INPUTS[key];
        if (!rule) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
        switch (rule.kind) {
            case 'string':
                if (typeof value !== 'string' || value.length > rule.max) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'enum':
                if (!rule.values.includes(value)) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'int':
                if (!Number.isInteger(value) || value < rule.min || value > rule.max) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'url': {
                let u;
                try { u = new URL(value); } catch { return { ok: false, error: `inputs_invalid:${key}` }; }
                if (u.protocol !== 'https:' || value.length > 2048) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            }
            default:
                return { ok: false, error: `inputs_invalid:${key}` };
        }
    }
    return { ok: true };
}

/** Credits owed: catalog price is per UNIT_SECONDS of video, per single image/audio output. */
function priceFor(modelRow, inputs) {
    const isVideo = typeof modelRow.modality === 'string' && modelRow.modality.endsWith('video');
    const seconds = isVideo ? (inputs.duration_seconds || UNIT_SECONDS) : UNIT_SECONDS;
    return modelRow.credits_5s * Math.ceil(seconds / UNIT_SECONDS);
}

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    const falKey = process.env.FAL_KEY;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !falKey || !publicHost) {
        return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const modelId = body && body.model_id;
    const idempotencyKey = body && body.idempotency_key;
    const inputs = body && body.inputs;
    if (typeof modelId !== 'string' || !modelId) return NextResponse.json({ error: 'model_id_required' }, { status: 400 });
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
        return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400 });
    }
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
        return NextResponse.json({ error: 'inputs_must_be_object' }, { status: 400 });
    }
    const inputsCheck = validateInputs(inputs);
    if (!inputsCheck.ok) return NextResponse.json({ error: inputsCheck.error }, { status: 400 });

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
            p_limit_per_window: RATE_LIMIT_PER_WINDOW,
            p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
        if (!rl || typeof rl.ok !== 'boolean') {
            // A null/odd body is not a pass; fail closed like a thrown RPC.
            console.error('[generations] rate check returned no verdict');
            return NextResponse.json({ error: 'rate_check_unavailable' }, { status: 503 });
        }
        if (rl.ok === false) {
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
                return NextResponse.json({ error: 'user_not_provisioned' }, { status: 409 });
            }
            const rlCode = rl.code ? String(rl.code).toLowerCase() : 'rate_check_failed';
            return NextResponse.json({ error: rlCode }, { status: 400 });
        }
    } catch (err) {
        // Fail closed: the rate limit is the entry-point control. A degraded
        // rate check must not turn into an unlimited submission path.
        console.error('[generations] rate check errored:', err);
        return NextResponse.json({ error: 'rate_check_unavailable' }, { status: 503 });
    }

    // 1. Look up the model in the catalog.
    let modelRow;
    try {
        const rows = await select(
            'model_catalog',
            { columns: 'id,provider,provider_endpoint,modality,credits_5s,gated_flag,active', filter: `id=eq.${encodeURIComponent(modelId)}` },
            cfg,
        );
        modelRow = Array.isArray(rows) && rows[0];
    } catch (err) {
        console.error('[generations] catalog lookup failed:', err);
        return NextResponse.json({ error: 'catalog_lookup_failed' }, { status: 502 });
    }
    if (!modelRow || !modelRow.active) return NextResponse.json({ error: 'model_not_found' }, { status: 404 });
    if (modelRow.provider !== 'fal') return NextResponse.json({ error: 'provider_unsupported' }, { status: 501 });
    if (modelRow.gated_flag) return NextResponse.json({ error: 'model_gated' }, { status: 402 });
    // A longer clip is only sold where we can actually request it from fal.
    if (inputs.duration_seconds && inputs.duration_seconds !== UNIT_SECONDS && !durationSpec(modelRow)) {
        return NextResponse.json({ error: 'duration_not_supported' }, { status: 400 });
    }

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
        return NextResponse.json({ error: 'user_lookup_failed' }, { status: 502 });
    }
    if (!userId) return NextResponse.json({ error: 'user_not_provisioned' }, { status: 409 });

    // 3. Debit atomically. Creates jobs row too. Price = catalog unit price
    //    times the validated unit count; never a client-supplied number.
    const credits = priceFor(modelRow, inputs);
    let debit;
    try {
        debit = await rpc('ledger_debit', {
            p_user_id: userId,
            p_idempotency_key: idempotencyKey,
            p_credits: credits,
            p_reason: 'debit:generation',
            p_model_id: modelId,
            p_inputs: inputs,
            // Authoritative rate limit, counted under the same row lock as
            // the insert (0030). The RPC above is only the cheap early 429.
            p_limit_per_window: RATE_LIMIT_PER_WINDOW,
            p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
    } catch (err) {
        console.error('[generations] ledger_debit failed:', err);
        return NextResponse.json({ error: 'debit_failed' }, { status: 502 });
    }
    if (debit && debit.ok === false && debit.code === 'RATE_LIMITED') {
        const retryAfter = Math.max(1, Math.min(600, Number(debit.retry_after_seconds) || RATE_WINDOW_SECONDS));
        return new NextResponse(
            JSON.stringify({ error: 'rate_limited', limit: debit.limit, count: debit.count, retry_after_seconds: retryAfter }),
            { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(retryAfter) } },
        );
    }
    if (!debit || debit.ok === false) {
        const status = debit && debit.code === 'INSUFFICIENT_BALANCE' ? 402 : 400;
        // Don't leak DB/RPC messages to the client — log server-side only.
        if (debit && debit.message) console.error('[generations] debit rejected:', debit.code, debit.message);
        // Convert DB SCREAMING_SNAKE across the trust boundary to snake_case.
        const debitCode = debit && debit.code ? String(debit.code).toLowerCase() : 'debit_rejected';
        return NextResponse.json({ error: debitCode }, { status });
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
        inputs: shapeForProvider(modelRow, inputs),
    }, { falKey, webhookBaseUrl });

    if (!falResult.ok) {
        // Refund immediately — fal wouldn't take the job so we owe the credits back.
        try {
            await rpc('ledger_refund', {
                p_job_id: jobId,
                p_user_id: userId,
                p_credits: credits,
                p_reason: 'refund:submit_failed',
            }, cfg);
        } catch (err) {
            // Log — the job stays in DEBITED and the reconcile job will flag it.
            console.error('[generations] refund-on-submit-fail failed:', err);
        }
        console.error('[generations] fal submit failed:', falResult.error);
        // Don't leak upstream vendor payloads to the client — log only.
        return NextResponse.json({ error: 'provider_submit_failed' }, { status: 502 });
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
