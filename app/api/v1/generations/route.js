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
import * as grsai from '../../../../packages/adapters/grsai.js';
import * as kie from '../../../../packages/adapters/kie.js';
import * as openrouter from '../../../../packages/adapters/openrouter.js';
import { capabilityFor, declaredInputs, checkInputs, checkSource, shapePayload } from '../../../../lib/modelCapabilities.js';
import { refundRejectedSubmit } from '../../../../lib/submitRejection.js';
import { resolveUploadedSource } from '../../../../lib/resolveSource.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../packages/adapters/r2.js';
import { start as startAutoShort, parentRef } from '../../../../lib/autoShort.js';
import { TOPIC_RE } from '../../../../lib/autoShortSteps.js';
import { runtimeDeps, runtimeKeys } from '../../../../lib/autoShortRuntime.js';
import { start as startClipEdit, parentRef as clipEditRef, editUnits } from '../../../../lib/clipEdit.js';
import { resolveEdit, defaultDeps as editDeps } from '../../../../lib/clipEditSources.js';

// Constrain idempotency keys to a safe printable range.
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
// Catalog ids are lowercase slugs ('wan-2.5', 'veo-3.1-fast-kie'). Bounded
// here so an unbounded string never reaches the PostgREST query string.
const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

// Provider payload allowlist. `inputs` is forwarded to fal verbatim, so
// every key the user may set is enumerated here with a bound; anything
// else is rejected. Quantity knobs (num_images, num_frames, duration
// beyond the priced unit, ...) are deliberately absent: the catalog price
// is per 5-second unit / single output and the payload must not buy more.
const MAX_INPUTS_BYTES = 8 * 1024;
const UNIT_SECONDS = 5;
const RATE_LIMIT_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60;
const MAX_SOURCES = 2;
// `resolution` is deliberately absent: fal bills per tier and the catalog
// holds one cost per model (its priced tier), so the server never lets a
// request select a pricier tier. The provider default is the priced one.
const ALLOWED_INPUTS = {
    prompt: { kind: 'string', max: 2000 },
    negative_prompt: { kind: 'string', max: 2000 },
    // Auto Short (ADR-0029); TOPIC_RE is checked again by its provider entry.
    topic: { kind: 'string', max: 200 },
    // Clip Editor: structured, so checked by lib/clipEditSources.js (within MAX_INPUTS_BYTES).
    clips: { kind: 'edit' },
    audio: { kind: 'edit' },
    aspect_ratio: { kind: 'enum', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9'] },
    duration_seconds: { kind: 'enum', values: [5, 10] },
    seed: { kind: 'int', min: 0, max: 2147483647 },
    image_url: { kind: 'url' },
    // Transform filters that operate on a clip (PRD A6). Same rule as
    // image_url: HTTPS only, bounded length, and in practice always a
    // presigned URL this server minted — never a client-supplied host.
    video_url: { kind: 'url' },

    // Filter feature selectors, verified against the live fal schemas on
    // 2026-09-18 (scripts/verify-filter-endpoints.mjs). These are NOT the
    // quantity knobs the comment above excludes: choosing a makeup style or
    // a target age buys exactly one output, same as the default. Without
    // them the filter has no controls and is not a product — you cannot
    // "age modify" without saying to what age.
    //
    // Bounds mirror the provider's own enum and range, so a value this
    // allowlist accepts is one the provider accepts.
    makeup_style: { kind: 'enum', values: ['natural', 'glamorous', 'smoky_eyes', 'bold_lips', 'no_makeup', 'remove_makeup', 'dramatic', 'bridal', 'professional', 'korean_style', 'artistic'] },
    intensity: { kind: 'enum', values: ['light', 'medium', 'heavy', 'dramatic'] },
    target_age: { kind: 'int', min: 6, max: 100 },
    preserve_identity: { kind: 'bool' },
};

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
            case 'bool':
                if (typeof value !== 'boolean') return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'edit':
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

// Per-provider submit. Each entry: the secret it needs, a pre-debit check that
// the inputs map onto a request the catalog price covers, and the submit call.
// Every model's own contract (inputs, lengths, pinned values) comes from its
// capability record (lib/modelCapabilities.js, ADR-0027); the kie and
// OpenRouter adapters still build their own bodies and must agree with it.
const PROVIDERS = {
    fal: {
        key: () => process.env.FAL_KEY,
        check: (record, _modelRow, inputs) => checkInputs(record, inputs),
        submit: (job, record, apiKey, publicHost, sources) => submitJob(
            { ...job, inputs: shapePayload(record, job.inputs, sources) },
            { falKey: apiKey, webhookBaseUrl: new URL('/api/webhook/fal', publicHost).toString() },
        ),
    },
    kie: {
        key: () => process.env.KIE_API_KEY,
        check: (record, modelRow, inputs) => {
            const own = checkInputs(record, inputs);
            if (!own.ok) return own;
            const target = kie.parseEndpoint(modelRow.provider_endpoint);
            return target ? kie.buildRequest(target, inputs) : { ok: false, error: 'provider_unsupported' };
        },
        submit: (job, _record, apiKey, publicHost) => kie.submitTask(job,
            { apiKey, callbackUrl: new URL('/api/webhook/kie', publicHost).toString() }),
    },
    grsai: {
        key: () => r2IsConfigured(r2EnvConfig()) ? process.env.GRSAI_API_KEY : null,
        check: (_record, modelRow, inputs) => grsai.buildRequest(modelRow.provider_endpoint, inputs),
        submit: (job, _record, apiKey) => grsai.submitTask(job, { apiKey }),
    },
    openrouter: {
        key: () => process.env.OPENROUTER_API_KEY,
        check: (record, modelRow, inputs) => {
            const own = checkInputs(record, inputs);
            return own.ok ? openrouter.buildRequest(modelRow.provider_endpoint, inputs) : own;
        },
        submit: (job, _record, apiKey, publicHost) => openrouter.submitVideo(job,
            { apiKey, callbackUrl: new URL('/api/webhook/openrouter', publicHost).toString() }),
    },
    // Auto Short: no single provider call. The orchestrator writes the script,
    // then submits the voice and scenes; their webhooks drive the rest.
    veyrnox: {
        key: () => (runtimeKeys() && r2IsConfigured(r2EnvConfig()) ? 'configured' : null),
        check: (record, _modelRow, inputs) => {
            const own = checkInputs(record, inputs);
            if (!own.ok || record.edit) return own;
            return TOPIC_RE.test(inputs.topic) ? { ok: true } : { ok: false, error: 'inputs_invalid:topic' };
        },
        submit: async (job, record, _key, publicHost) => {
            const deps = runtimeDeps({ cfg: envConfig(), r2cfg: r2EnvConfig(), publicHost, ...runtimeKeys() });
            if (record.edit) {
                const r = await startClipEdit({ jobId: job.job_id, edit: job.inputs.edit }, deps);
                return r.ok ? { ok: true, providerJobId: clipEditRef(job.job_id) } : { ok: false, error: r.error, errorCode: r.error };
            }
            const r = await startAutoShort({ jobId: job.job_id, topic: job.inputs.topic }, deps);
            return r.ok ? { ok: true, providerJobId: parentRef(job.job_id) } : { ok: false, error: r.error, errorCode: r.error };
        },
    },
};

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
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !publicHost) {
        return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const modelId = body && body.model_id;
    const idempotencyKey = body && body.idempotency_key;
    const inputs = body && body.inputs;
    if (typeof modelId !== 'string' || !MODEL_ID_RE.test(modelId)) return NextResponse.json({ error: 'model_id_required' }, { status: 400 });
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

    // Resolved AFTER the rate-limit check, deliberately. This does a SigV4
    // presign plus an R2 round trip, so running it first meant a request
    // that was about to be 429'd had already spent that work — an unmetered
    // path through a metered endpoint.
    // A Transform job names an uploaded source by its R2 key. The client
    // never sends a URL for it: the key is checked for ownership, the bytes
    // are checked against what was declared at signing time, and only then
    // does this server mint the short-lived URL the provider will fetch.
    // The key is what persists in jobs.inputs; the signed URL does not.
    // Lip sync takes two uploads (a face and the speech), so `source_keys`
    // holds up to MAX_SOURCES; `source_key` is the one-upload form.
    // An upload can carry someone's face or voice. The caller must state they
    // own it or have consent (AUP, /legal/aup); the statement is recorded on
    // the job by job_consent_attested (0096) once the debit has created it.
    const consent = body && body.consent === true;
    const rawKeys = body && body.source_keys !== undefined ? body.source_keys
        : body && body.source_key !== undefined ? [body.source_key] : [];
    if (!Array.isArray(rawKeys) || rawKeys.length > MAX_SOURCES
        || rawKeys.some((k) => typeof k !== 'string' || k.length > 200)) {
        return NextResponse.json({ error: 'source_key_invalid' }, { status: 400 });
    }
    const sources = {};   // input field -> resolved source
    const sourceKeys = {}; // input field -> upload key
    // A client-sent image_url/video_url is dropped here, ALWAYS — not only on
    // the upload path. Inside `if (rawKeys.length)` these two deletes left a
    // hole: a request with a media URL and no source key kept the client's
    // host, and then checkSource saw no resolved source and enforced neither
    // the model's maxPixels/maxSeconds cap (which its price is built on) nor
    // the consent statement. The only source a model may read is one this
    // server signed, so the key is the only way to name one.
    delete inputs.image_url;
    delete inputs.video_url;
    if (rawKeys.length) {
        if (!consent) return NextResponse.json({ error: 'consent_required' }, { status: 400 });
        const r2cfg = r2EnvConfig();
        if (!r2IsConfigured(r2cfg)) {
            return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
        }
        for (const key of rawKeys) {
            const source = await resolveUploadedSource(authId, key, r2cfg);
            if (!source.ok) {
                const status = source.error === 'source_not_found' ? 404 : source.error === 'internal' ? 502 : 400;
                return NextResponse.json({ error: source.error }, { status });
            }
            // Two uploads for one slot would leave one silently unused.
            if (sources[source.field]) return NextResponse.json({ error: 'source_key_invalid' }, { status: 400 });
            sources[source.field] = source;
            sourceKeys[source.field] = key;
            inputs[source.field] = source.url;
        }
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
    const provider = Object.prototype.hasOwnProperty.call(PROVIDERS, modelRow.provider) ? PROVIDERS[modelRow.provider] : null;
    if (!provider) return NextResponse.json({ error: 'provider_unsupported' }, { status: 501 });
    // No capability record = no known contract for this endpoint: refuse rather
    // than forward inputs the provider may bill differently for.
    const record = capabilityFor(modelRow.provider_endpoint);
    if (!record || record.provider !== modelRow.provider) {
        console.error('[generations] no capability record for', modelRow.id, modelRow.provider_endpoint);
        return NextResponse.json({ error: 'provider_unsupported' }, { status: 501 });
    }
    if (modelRow.gated_flag) return NextResponse.json({ error: 'model_gated' }, { status: 402 });
    const providerKey = provider.key();
    if (!providerKey) return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
    // From here on only the keys this model declares exist: the create page
    // sends one control set for every model, and an undeclared key must not
    // reach the provider, the job row, or the price.
    const modelInputs = declaredInputs(record, inputs);
    // Refuse before the debit anything the provider request cannot express at
    // the priced unit (a longer clip, an aspect ratio the model lacks, ...).
    const providerCheck = provider.check(record, modelRow, modelInputs);
    if (!providerCheck.ok) return NextResponse.json({ error: providerCheck.error }, { status: 400 });
    // A model priced by output size or length caps its sources' pixels/seconds.
    const sourceCheck = checkSource(record, sources);
    if (!sourceCheck.ok) return NextResponse.json({ error: sourceCheck.error }, { status: 400 });
    // The job row records which uploads were used, not the 15-minute URLs.
    const usedKeys = Object.fromEntries(Object.entries(sourceKeys).filter(([f]) => modelInputs[f] !== undefined));
    let storedInputs = Object.keys(usedKeys).length
        ? { ...Object.fromEntries(Object.entries(modelInputs).filter(([k]) => !(k in usedKeys))), source_keys: usedKeys }
        : modelInputs;
    // A Clip Editor job stores the resolved edit (owned R2 keys, real lengths)
    // and is priced on its output length, never on what the client sent.
    let pricedInputs = modelInputs;
    if (record.edit) {
        let resolved;
        try {
            resolved = await resolveEdit(authId, modelInputs, editDeps(cfg, r2EnvConfig()));
        } catch (err) {
            console.error('[generations] edit lookup failed:', err && err.message);
            return NextResponse.json({ error: 'edit_lookup_failed' }, { status: 502 });
        }
        if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
        storedInputs = { edit: resolved.edit };
        // Billed units, not raw seconds: a many-clip edit costs us per step
        // (lib/clipEdit.js editUnits), and priceFor multiplies the catalog's
        // credits_5s by the unit count either way.
        pricedInputs = { duration_seconds: editUnits(resolved.edit) * UNIT_SECONDS };
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
    const credits = priceFor(modelRow, pricedInputs);
    let debit;
    try {
        debit = await rpc('ledger_debit', {
            p_user_id: userId,
            p_idempotency_key: idempotencyKey,
            p_credits: credits,
            p_reason: 'debit:generation',
            p_model_id: modelId,
            p_inputs: storedInputs,
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
        const status = debit && debit.code === 'INSUFFICIENT_BALANCE' ? 402
            : debit && debit.code === 'ACCOUNT_FROZEN' ? 403 : 400;
        // Don't leak DB/RPC messages to the client — log server-side only.
        if (debit && debit.message) console.error('[generations] debit rejected:', debit.code, debit.message);
        // Convert DB SCREAMING_SNAKE across the trust boundary to snake_case.
        const debitCode = debit && debit.code ? String(debit.code).toLowerCase() : 'debit_rejected';
        return NextResponse.json({ error: debitCode }, { status });
    }

    const jobId = debit.job_id;
    const idempotent = debit.idempotent;
    if (rawKeys.length && jobId) {
        // Recorded before the provider call: a job that spends money on
        // someone's likeness must carry the statement that allowed it.
        try {
            const noted = await rpc('job_consent_attested', { p_job_id: jobId }, cfg);
            if (!noted || noted.ok !== true) console.error('[generations] consent not recorded:', noted && noted.code);
        } catch (err) {
            console.error('[generations] consent record failed:', err);
        }
    }
    const balanceAfter = debit.balance_after;

    // Idempotent replay — job already exists. Don't resubmit to fal; return
    // the existing shape. The state may be anywhere from DEBITED through
    // STORED; the client polls to learn.
    if (idempotent) {
        return NextResponse.json({ job_id: jobId, idempotent: true, balance_after: balanceAfter });
    }

    // 4. Submit to the provider.
    const submitResult = await provider.submit(
        { job_id: jobId, provider_endpoint: modelRow.provider_endpoint, inputs: record.edit ? storedInputs : modelInputs },
        record, providerKey, publicHost, sources,
    );

    if (!submitResult.ok) {
        // Record why on the job, then refund — the provider wouldn't take the
        // job so we owe the credits back.
        await refundRejectedSubmit({ jobId, userId, credits, errorCode: submitResult.errorCode }, cfg);
        console.error('[generations] provider submit failed:', modelRow.provider, submitResult.error);
        // A topic the script writer refused is the user's to change, not an outage.
        if (submitResult.errorCode === 'script_refused') return NextResponse.json({ error: 'topic_refused' }, { status: 422 });
        // Don't leak upstream vendor payloads to the client — log only.
        return NextResponse.json({ error: 'provider_submit_failed' }, { status: 502 });
    }

    // 5. Move state to SUBMITTED and record provider job id.
    try {
        await rpc('job_submitted', {
            p_job_id: jobId,
            p_provider: modelRow.provider,
            p_provider_job_id: submitResult.providerJobId,
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
