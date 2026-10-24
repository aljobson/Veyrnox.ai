import { editorFeatureEnabled } from '../../../../lib/editorRuntimeFlags.mjs';
import { falDispatchEnabled, admitFalDispatch } from '../../../../lib/falDispatch.js';
import { publishFalDispatchWakeup } from '../../../../lib/falDispatchWakeup.js';
import { providerFor } from '../../../../packages/provider-sdk/registry.js';
import { logShadowRoute, shadowEnabled } from '../../../../lib/supplierRoutesShadow.js';
import { requestWaitUntil } from '../../../../lib/requestWaitUntil.js';
import { resolveOwnRoute, recordFirstAttempt } from '../../../../lib/supplierRoutesDispatch.js';
import { NextResponse } from 'next/server';
import { rpc, select, envConfig, SupabaseError } from '../../../../packages/db/supabase-client.js';
import { capabilityFor, declaredInputs, checkSource } from '../../../../lib/modelCapabilities.js';
import { refundRejectedSubmit, unknownSubmitResponse, recordSubmittedJob } from '../../../../lib/submitRejection.js';
import { freeAllowanceOn as isFreeAllowanceOn, takeFreeJob } from '../../../../lib/freeJob.js';
import { templateStartId } from '../../../../lib/templateStart.js';
import { classifySubmitFailure } from '../../../../lib/submitFailureClass.js';
import { readGenerationSources, resolveGenerationSources, sourceErrorStatus } from '../../../../lib/generationSources.js';
import { mediaInputKey } from '../../../../lib/generationSourceSlots.mjs';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../packages/adapters/r2.js';
import { editUnits, clipCaptionsEnabled, clipSlowEnabled } from '../../../../lib/clipEdit.js';
import { compositeRefundGate } from '../../../../lib/compositeRefunds.js';
import { resolveEdit, defaultDeps as editDeps } from '../../../../lib/clipEditSources.js';
import { checkPlan, checkCapacity } from '../../../../lib/montageGate.js';
import { normaliseNarration } from '../../../../lib/montageNarration.js';
import { providerSpendBody, providerSpendError, providerSpendLimit } from '../../../../lib/providerSpend.js';

// The AUP statement version a consent tick attests to. Bump when the wording
// at /legal/aup or on the create page changes; users re-attest under the new
// name on their next upload (attest_upload_rights, migration 0146).
export const RIGHTS_ATTESTATION_VERSION = 'aup-2026-09-26';

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
// Output choices are bounded again by the model contract before the debit.
// Only tiers at or below the catalog's priced ceiling are declared there.
const ALLOWED_INPUTS = {
    prompt: { kind: 'string', max: 2000 },
    negative_prompt: { kind: 'string', max: 2000 },
    voice_description: { kind: 'string', max: 500 }, // a voice in words, for speech models that take one; never a recording
    // Auto Short (ADR-0029); TOPIC_RE is checked again by its provider entry.
    topic: { kind: 'string', max: 200 },
    // Video agent (ADR-0074): the approved brief and its plan token; both are re-checked by verifyPlanToken before the debit.
    brief: { kind: 'string', max: 500 },
    plan_id: { kind: 'string', max: 600 },
    narration_text: { kind: 'string', max: 300 },
    // Clip Editor: structured, so checked by lib/clipEditSources.js (within MAX_INPUTS_BYTES).
    clips: { kind: 'edit' },
    audio: { kind: 'edit' },
    captions: { kind: 'edit' },
    aspect_ratio: { kind: 'enum', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9'] },
    duration_seconds: { kind: 'enum', values: [5, 10] },
    // ACE-Step v1 supports longer audio, but its one-Credit catalog unit is
    // costed at a maximum of 60 seconds. The model capability narrows this
    // outer bound to the one endpoint that declares the control.
    duration: { kind: 'int', min: 5, max: 60 },
    output_resolution: { kind: 'enum', values: ['480p', '720p'] },
    audio_enabled: { kind: 'bool' },
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
    const confirmedCredits = body && body.confirmed_credits;
    let inputs = body && body.inputs;
    if (typeof modelId !== 'string' || !MODEL_ID_RE.test(modelId)) return NextResponse.json({ error: 'model_id_required' }, { status: 400 });
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
        return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400 });
    }
    if (confirmedCredits !== undefined && (!Number.isInteger(confirmedCredits) || confirmedCredits < 0)) {
        return NextResponse.json({ error: 'confirmed_credits_invalid' }, { status: 400 });
    }
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
        return NextResponse.json({ error: 'inputs_must_be_object' }, { status: 400 });
    }
    const inputsCheck = validateInputs(inputs);
    if (!inputsCheck.ok) return NextResponse.json({ error: inputsCheck.error }, { status: 400 });
    if (Object.hasOwn(inputs, 'narration_text')) {
        const narration = normaliseNarration(inputs.narration_text);
        if (!narration.ok) return NextResponse.json({ error: narration.error }, { status: 400 });
        inputs = { ...inputs, narration_text: narration.text };
    }

    // 0. Shared per-user entry check. After migration 0113 this atomically
    // counts attempts (20 per fixed 60-second window), including requests
    // rejected later without a job. The existing 10-job sliding-window check
    // remains, with the authoritative job limit enforced inside ledger_debit.
    // This RPC must precede source signing, R2 reads and media inspection.
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

    // Bounded references, never client URLs. Legacy arrays keep their meaning; explicit
    // Library descriptors bind one asset to a model-declared slot (ADR-0094).
    const consent = body && body.consent === true;
    const references = readGenerationSources(body);
    if (!references.ok) return NextResponse.json({ error: references.error }, { status: 400 });
    const rawKeys = references.keys, rawAssets = references.assets;
    if (rawKeys.length || rawAssets.length) {
        if (!consent) return NextResponse.json({ error: 'consent_required' }, { status: 400 });
    }
    for (const slot of ['image','endImage','video','audio']) delete inputs[mediaInputKey(slot)];

    // 1. Look up the model in the catalog. The allowance column is asked for only when the flag is on, so a
    //    Worker running before migration 0205 is applied never queries a column that does not exist yet.
    const freeAllowanceOn = isFreeAllowanceOn(process.env);
    let modelRow;
    try {
        const rows = await select(
            'model_catalog',
            { columns: `id,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn ? ',free_allowance_per_day' : ''}`, filter: `id=eq.${encodeURIComponent(modelId)}` },
            cfg,
        );
        modelRow = Array.isArray(rows) && rows[0];
    } catch (err) {
        console.error('[generations] catalog lookup failed:', err);
        return NextResponse.json({ error: 'catalog_lookup_failed' }, { status: 502 });
    }
    if (!modelRow || !modelRow.active) return NextResponse.json({ error: 'model_not_found' }, { status: 404 });
    // ADR-0058 decision 9: Cloudflare supplies the visitor country. Keep US
    // requests off BytePlus until its written end-user ruling is recorded.
    if (modelRow.provider === 'byteplus' && req.headers.get('cf-ipcountry')?.trim().toUpperCase() === 'US') {
        return NextResponse.json({ error: 'model_region_unavailable' }, { status: 451 });
    }
    const provider = providerFor(modelRow.provider);
    if (!provider) return NextResponse.json({ error: 'provider_unsupported' }, { status: 501 });
    // ADR-0256 shadow mode: log the route chooseRoute would pick. Never awaited and never throws; waitUntil lets the read and the log finish after an early response. Off unless SUPPLIER_ROUTES_SHADOW is "true".
    const shadowDone = shadowEnabled() ? logShadowRoute(modelRow, cfg) : null;
    const keepAlive = shadowDone && requestWaitUntil();
    if (keepAlive) keepAlive(shadowDone);
    // ADR-0256 phase 1: the offer's own route when SUPPLIER_ROUTES_ENABLED is "true", else null. Never changes where the job goes.
    const ownRoute = await resolveOwnRoute(modelRow, cfg);
    // No capability record = no known contract for this endpoint: refuse rather
    // than forward inputs the provider may bill differently for.
    const record = capabilityFor(modelRow.provider_endpoint);
    if (!record || record.provider !== modelRow.provider) {
        console.error('[generations] no capability record for', modelRow.id, modelRow.provider_endpoint);
        return NextResponse.json({ error: 'provider_unsupported' }, { status: 501 });
    }
    if (record.outputStems && !editorFeatureEnabled('EDITOR_AUDIO_STEMS_ENABLED')) return NextResponse.json({ error: 'audio_stems_unavailable' }, { status: 503 });
    if (modelRow.gated_flag) return NextResponse.json({ error: 'model_gated' }, { status: 402 });
    for (const key of ['output_resolution', 'audio_enabled']) {
        if (inputs[key] !== undefined && !Object.hasOwn(record.inputs, key)) {
            return NextResponse.json({ error: `inputs_key_not_allowed:${key}` }, { status: 400 });
        }
    }
    const providerKey = provider.key();
    if (!providerKey) return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
    // Active capabilities precede source signing/inspection. Both frames pass caller
    // ownership, expiry, MIME sniffing and bounded size/length checks before debit.
    const r2cfg = rawKeys.length || rawAssets.length ? r2EnvConfig() : null;
    if (r2cfg && !r2IsConfigured(r2cfg)) return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
    const resolved = await resolveGenerationSources({ authId, keys: rawKeys, assets: rawAssets, record, r2cfg, dbcfg: cfg });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: sourceErrorStatus(resolved.error) });
    const { sources, sourceKeys, sourceAssets } = resolved;
    Object.assign(inputs,resolved.inputs);

    // From here on only the keys this model declares exist: the create page
    // sends one control set for every model, and an undeclared key must not
    // reach the provider, the job row, or the price.
    const modelInputs = declaredInputs(record, inputs);
    // Refuse before the debit anything the provider request cannot express at
    // the priced unit (a longer clip, an aspect ratio the model lacks, ...).
    const providerCheck = provider.check(record, modelRow, modelInputs);
    if (!providerCheck.ok) return NextResponse.json({ error: providerCheck.error }, { status: 400 });
    // Video agent (ADR-0074): a job is accepted only with the Approve ticket the
    // plan route issued for this caller, this exact brief and this price, and
    // with the idempotency key that ticket names, so one plan buys one run.
    if (record.agent) {
        const bad = await checkPlan({ modelInputs, authId, idempotencyKey, credits: priceFor(modelRow, {}) });
        if (bad) return NextResponse.json(bad.body, { status: bad.status });
    }
    // A model priced by output size or length caps its sources' pixels/seconds.
    const sourceCheck = checkSource(record, sources);
    if (!sourceCheck.ok) return NextResponse.json({ error: sourceCheck.error }, { status: 400 });
    // The job row records which uploads were used, not the 15-minute URLs.
    // Library sources are recorded by job id under their own name, so the
    // upload sweep (lib/uploadSweep.js), which deletes source_keys, never sees them.
    const usedKeys = Object.fromEntries(Object.entries(sourceKeys).filter(([f]) => modelInputs[f] !== undefined));
    const usedAssets = Object.fromEntries(Object.entries(sourceAssets).filter(([f]) => modelInputs[f] !== undefined));
    let storedInputs = Object.keys(usedKeys).length || Object.keys(usedAssets).length
        ? {
            ...Object.fromEntries(Object.entries(modelInputs).filter(([k]) => !(k in usedKeys) && !(k in usedAssets))),
            ...(Object.keys(usedKeys).length ? { source_keys: usedKeys } : {}),
            ...(Object.keys(usedAssets).length ? { source_assets: usedAssets } : {}),
        }
        : modelInputs;
    // A Clip Editor job stores the resolved edit (owned R2 keys, real lengths)
    // and is priced on its output length, never on what the client sent.
    let pricedInputs = modelInputs;
    if (record.edit) {
        // Captions are a new paid path: off until CLIP_EDIT_CAPTIONS_ENABLED is "true"
        // (0225 applied, billed cost checked, docs/editor/CAPTIONS.md).
        if (modelInputs.captions !== undefined && !clipCaptionsEnabled(process.env)) {
            return NextResponse.json({ error: 'captions_unavailable' }, { status: 400 });
        }
        // Slow motion is a new paid path with a placeholder price: off until CLIP_EDIT_SLOW_ENABLED is "true"
        // (0237 applied, fal's billed cost read, docs/editor/SPEED.md). Checked before any lookup or debit.
        if (Array.isArray(modelInputs.clips) && modelInputs.clips.some((c) => c && typeof c === 'object' && c.slow !== undefined)
            && !clipSlowEnabled(process.env)) {
            return NextResponse.json({ error: 'slow_unavailable' }, { status: 400 });
        }
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

    // An API client may pin the maximum charge it showed to a person. Check
    // against this uncached catalog row after all pricing inputs are resolved,
    // so a price change can never turn an old confirmation into permission to
    // spend more. Browser clients omit the field and keep their existing flow.
    const quotedCredits = priceFor(modelRow, pricedInputs);
    if (confirmedCredits !== undefined && confirmedCredits !== quotedCredits) {
        return NextResponse.json({
            error: 'credit_confirmation_mismatch',
            confirmed_credits: confirmedCredits,
            expected_credits: quotedCredits,
        }, { status: 409 });
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

    // Video agent: is the runner free? Asked before the debit, so "busy" or "offline" charges nothing.
    if (record.agent) {
        const full = await checkCapacity({ userId, idempotencyKey, modelId, narrationText: modelInputs.narration_text, cfg });
        if (full) {
            return NextResponse.json(full.body, { status: full.status, headers: full.retryAfter ? { 'retry-after': String(full.retryAfter) } : undefined });
        }
    }

    // A composite job whose account has had too many refunded in a day waits for the day to turn (M-07).
    const refundsGate = await compositeRefundGate({ rpc, cfg, userId, modelId });
    if (refundsGate) {
        return NextResponse.json(refundsGate.body, { status: refundsGate.status, headers: { 'retry-after': String(refundsGate.retryAfter) } });
    }

    // 3. Debit atomically. Creates jobs row too. Price = catalog unit price
    //    times the validated unit count; never a client-supplied number.
    let credits = quotedCredits;
    // ADR-0072: the template this started from, recorded on the job for the Popular ranking only. It is believed only if it names a
    // real template that belongs to this model, it never reaches a provider (the provider gets storedInputs / modelInputs below),
    // and a bad or missing one is simply ignored.
    const presetId = templateStartId(body && body.preset, modelId);
    const jobInputs = presetId ? { ...storedInputs, preset_id: presetId } : storedInputs;
    if (falDispatchEnabled(process.env) && modelRow.provider === 'fal' && modelRow.modality === 'text-to-image'
        && !rawKeys.length && !rawAssets.length) {
        return admitFalDispatch({ userId, key: idempotencyKey, model: modelRow, record,
            inputs: modelInputs, jobInputs, free: freeAllowanceOn, cfg, onCommitted: publishFalDispatchWakeup });
    }
    let debit = null;
    // ADR-0069: allowance and zero-credit job are atomic. No allowance falls through to paid debit;
    // after a lost acknowledgement ledger_debit finds the existing job by key.
    if (freeAllowanceOn && Number(modelRow.free_allowance_per_day) > 0) {
        debit = await takeFreeJob({
            cfg, authId, userId, key: idempotencyKey, modelId, inputs: jobInputs,
            limit: RATE_LIMIT_PER_WINDOW, windowSeconds: RATE_WINDOW_SECONDS,
        });
        if (debit && debit.free) credits = 0;
    }
    try {
        if (!debit) debit = await rpc('ledger_debit', {
            p_user_id: userId,
            p_idempotency_key: idempotencyKey,
            p_credits: credits,
            p_reason: 'debit:generation',
            p_model_id: modelId,
            p_inputs: jobInputs,
            // Authoritative rate limit, counted under the same row lock as
            // the insert (0030). The RPC above is only the cheap early 429.
            p_limit_per_window: RATE_LIMIT_PER_WINDOW,
            p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
    } catch (err) {
        const spend = providerSpendError(err);
        if (spend) return NextResponse.json(providerSpendBody(spend), {
            status: spend.status, headers: { 'retry-after': String(spend.retryAfter) },
        });
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
    if (debit?.ok === false && debit.code === 'PROVIDER_ADMISSION_PAUSED') {
        const retryAfter = Math.max(1, Math.min(600, Number(debit.retry_after_seconds) || 60));
        return NextResponse.json({ error: 'provider_admission_paused' }, {
            status: 503, headers: { 'retry-after': String(retryAfter) },
        });
    }
    const spendLimit = providerSpendLimit(debit);
    if (spendLimit) return NextResponse.json(providerSpendBody(spendLimit), {
        status: spendLimit.status, headers: { 'retry-after': String(spendLimit.retryAfter) },
    });
    if (!debit || debit.ok === false) {
        const status = debit && debit.code === 'INSUFFICIENT_BALANCE' ? 402
            : debit && (debit.code === 'ACCOUNT_FROZEN' || debit.code === 'ACCOUNT_ON_HOLD') ? 403 : 400;
        // Don't leak DB/RPC messages to the client — log server-side only.
        if (debit && debit.message) console.error('[generations] debit rejected:', debit.code, debit.message);
        // Convert DB SCREAMING_SNAKE across the trust boundary to snake_case.
        const debitCode = debit && debit.code ? String(debit.code).toLowerCase() : 'debit_rejected';
        return NextResponse.json({ error: debitCode }, { status });
    }

    const jobId = debit.job_id;
    const idempotent = debit.idempotent;
    if ((rawKeys.length || rawAssets.length) && jobId) {
        // Recorded before the provider call: a job that spends money on
        // someone's likeness must carry the statement that allowed it.
        try {
            const noted = await rpc('job_consent_attested', { p_job_id: jobId }, cfg);
            if (!noted || noted.ok !== true) console.error('[generations] consent not recorded:', noted && noted.code);
        } catch (err) {
            console.error('[generations] consent record failed:', err);
        }
        // The same statement, kept once at account level with the AUP version
        // it was made under (ADR-0058 decision 7): the record a provider's
        // "verify and retain rights in user-uploaded content" clause asks for.
        try {
            const attested = await rpc('attest_upload_rights', { p_user_id: userId, p_version: RIGHTS_ATTESTATION_VERSION }, cfg);
            if (!attested || attested.ok !== true) console.error('[generations] rights attestation not recorded:', attested && attested.code);
        } catch (err) {
            console.error('[generations] rights attestation failed:', err);
        }
    }
    const balanceAfter = debit.balance_after;

    // Idempotent replay — job already exists. Don't resubmit to fal; return
    // the existing shape. The state may be anywhere from DEBITED through
    // STORED; the client polls to learn.
    if (idempotent) {
        return NextResponse.json({ job_id: jobId, idempotent: true, balance_after: balanceAfter });
    }

    // These paid providers are always guarded: an ambiguous response may
    // already have spent supplier credits, so it must never trigger an
    // automatic refund. fal's durable outbox normally owns this boundary;
    // this also protects the legacy path while rollout flags change.
    const guardedSubmit = ['fal', 'kie', 'grsai', 'openrouter'].includes(modelRow.provider);

    // 4. Submit to the provider.
    const submitResult = await provider.submit(
        { job_id: jobId, provider_endpoint: modelRow.provider_endpoint, inputs: record.edit ? storedInputs : modelInputs },
        record, providerKey, publicHost, sources,
    );

    if (!submitResult.ok) {
        if (guardedSubmit && submitResult.outcome === 'unknown') return unknownSubmitResponse(jobId, cfg);
        // Record why on the job, then refund — the provider wouldn't take the
        // job so we owe the credits back. An untyped refusal (fal and kie
        // return log strings) may be classified by Jev (ADR-0066); null keeps
        // the generic code, and the refund is the same either way.
        const errorCode = submitResult.errorCode || await classifySubmitFailure(submitResult.error, process.env);
        await refundRejectedSubmit({ jobId, userId, credits, errorCode }, cfg);
        console.error('[generations] provider submit failed:', modelRow.provider, submitResult.error);
        // A topic the script writer refused is the user's to change, not an outage.
        if (submitResult.errorCode === 'script_refused') return NextResponse.json({ error: 'topic_refused' }, { status: 422 });
        // So is a prompt the provider refused, or an input it would not take.
        if (errorCode === 'provider_moderation' || errorCode === 'provider_input_rejected') {
            return NextResponse.json({ error: errorCode }, { status: 422 });
        }
        // Don't leak upstream vendor payloads to the client — log only.
        return NextResponse.json({ error: 'provider_submit_failed' }, { status: 502 });
    }

    // 5. Move state to SUBMITTED and record provider job id.
    const recorded = await recordSubmittedJob({ jobId, provider: modelRow.provider, providerJobId: submitResult.providerJobId }, cfg);
    if (guardedSubmit && !recorded) return unknownSubmitResponse(jobId, cfg);
    if (recorded) await recordFirstAttempt({ jobId, route: ownRoute, providerJobId: submitResult.providerJobId }, cfg);

    return NextResponse.json({
        job_id: jobId,
        state: 'SUBMITTED',
        balance_after: balanceAfter,
        ...(debit.free ? { free_allowance: true } : {}),
    });
}
