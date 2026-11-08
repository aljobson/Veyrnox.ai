import { admissionAvailable } from './uploadAdmission.js';
import { ownsUploadKey } from './uploadSource.js';
import { resolveSpeechUpload } from './speechUploadSource.js';
import { rpc as realRpc, select as realSelect, envConfig } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { presignGetUrl, envConfig as r2EnvConfig, isConfigured } from '../packages/adapters/r2.js';
import { readJson, exactKeys, UUID_RE } from '../packages/security/input.js';
import { probeSpeechSource, speechSourceSizeAllowed } from './speechSourceProbe.js';
import { editorFeatureEnabled } from './editorRuntimeFlags.mjs';
import { speechCorrelation } from './speechCutCorrelation.js';
import { SPEECH_CUT_LANGUAGES } from './speechCutLanguage.js';
import { parseSmartCutAnalysis } from '../app/veyrnox/_lib/smartCutAnalysis.js';
const KEY = /^[A-Za-z0-9._-]{8,128}$/;
const MODEL = 'elevenlabs-scribe-v2';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (code, status = 503, extra = {}) => json({ error: code, ...extra }, status);
const codes = { NOT_FOUND: 404, SOURCE_UNSUPPORTED: 400, SOURCE_TOO_LONG: 400, DURATION_MISMATCH: 400, PRICE_CHANGED: 409,
    IDEMPOTENCY_CONFLICT: 409, RESULT_EXPIRED: 410, SPEECH_CUT_UNAVAILABLE: 501, RATE_LIMITED: 429, INSUFFICIENT_BALANCE: 402, ACCOUNT_FROZEN: 403, AI_DISABLED: 403, PROVIDER_ADMISSION_PAUSED: 503, ACCOUNT_ON_HOLD: 403, SPEECH_GATE_COOLDOWN: 429, SOURCE_NOT_ADMITTED: 503 };
const dbError = result => fail(Object.hasOwn(codes, result?.code) ? result.code.toLowerCase() : 'request_unavailable', codes[result?.code] || 503,
    result?.code === 'PRICE_CHANGED' ? { credits: result.credits } : {});
const digest = async (assetId, fingerprint) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${assetId}:${fingerprint}:1`))), b => b.toString(16).padStart(2, '0')).join('');

export function speechAnalysisHandlers({ rpc = realRpc, select = realSelect, submit = submitJob, probe = probeSpeechSource,
    sign = presignGetUrl, resolveUpload = resolveSpeechUpload, cfg = envConfig(), r2cfg = r2EnvConfig(), env = process.env } = {}) {
    const call = (name, args) => rpc(name, args, cfg);
    const gate = async request => {
        const auth = request.headers.get('x-veyrnox-auth-id');
        if (!UUID_RE.test(auth || '')) return fail('not_authenticated', 401);
        const rate = await call('consume_account_read_request', { p_auth_id: auth });
        return rate?.ok === true ? auth : dbError(rate);
    };
    const model = async () => {
        const rows = await select('model_catalog', { columns: 'id,credits_5s,provider_endpoint,active,provider', filter: `id=eq.${MODEL}&active=eq.true&limit=1` }, cfg);
        const row = rows?.[0];
        return row?.active === true && row.provider === 'fal' && row.provider_endpoint === 'fal-ai/elevenlabs/speech-to-text/scribe-v2'
            && Number.isSafeInteger(row.credits_5s) && row.credits_5s > 0 ? row : null;
    };
    const outcome = (result, replay = false) => {
        if (result?.ok !== true) return dbError(result);
        if (result.found === false) return fail('request_not_found', 404);
        if (result.status === 'failed') return replay && result.refunded === true
            ? fail('request_failed_refunded', 409, { refunded: true, credits: result.credits }) : json({ id: result.id, status: 'failed', refunded: result.refunded === true, credits: result.credits });
        if (result.status === 'completed' && result.speech === false) return json({ id: result.id, status: 'completed', speech: false, refunded: result.refunded === true, credits: result.credits });
        if (result.status === 'completed') {
            const parsed = parseSmartCutAnalysis(result.analysis);
            if (!parsed.ok) return fail('analysis_invalid');
            return json({ id: result.id, status: 'completed', credits: result.credits, analysis: parsed.analysis, ...(result.kind === 'reused_cache' ? { reused: true } : {}) });
        }
        return json({ id: result.id, status: 'queued', credits: result.credits, progress: result.progress === 'transcribing' ? 'transcribing' : 'queued',
            ...(result.kind === 'joined_in_flight' ? { reused: 'in_flight' } : {}) }, 202);
    };
    const quote = async request => {
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            if (!editorFeatureEnabled('SPEECH_CUT_ENABLED', env)) return fail('speech_cut_unavailable', 501);
            const best = new URL(request.url).searchParams.get('capability') === 'best-cut';
            if (best && !editorFeatureEnabled('BEST_CUT_ENABLED', env)) return fail('speech_cut_unavailable', 501);
            const auth = await gate(request); if (auth instanceof Response) return auth;
            const row = await model(); if (!row) return fail('speech_cut_unavailable', 501);
            // Same fail-closed sources as private.fal_admission_paused(model, false).
            const [capacity, admission] = await Promise.all([
                select('fal_capacity_policy', { columns: 'enabled', filter: 'singleton=eq.true&limit=1' }, cfg),
                select('fal_admission_control', { columns: 'paused', filter: 'singleton=eq.true&limit=1' }, cfg),
            ]);
            if (capacity?.[0]?.enabled !== false || admission?.[0]?.paused !== false) return fail('speech_cut_unavailable', 501);
            return json({ credits: row.credits_5s, max_seconds: 60, languages: SPEECH_CUT_LANGUAGES, ...(best ? { source_types: ['job', 'upload'] } : {}) });
        } catch { return fail('quote_unavailable'); }
    };
    const get = async (request, id) => {
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            const auth = await gate(request); if (auth instanceof Response) return auth;
            if (!UUID_RE.test(id || '')) return fail('invalid_id', 400);
            return outcome(await call('speech_analysis_get', { p_auth_id: auth, p_id: id }));
        } catch { return fail('read_unavailable'); }
    };
    const byKey = async (request, key) => {
        try {
            const auth = await gate(request); if (auth instanceof Response) return auth;
            if (!KEY.test(key || '')) return fail('invalid_idempotency_key', 400);
            return outcome(await call('speech_analysis_by_key', { p_auth_id: auth, p_key: key }));
        } catch { return fail('read_unavailable'); }
    };
    const validSource = value => value && (value.type === 'job' ? UUID_RE.test(value.jobId || '') : value.type === 'upload' && typeof value.key === 'string');
    const source = async (auth, value) => {
        if (value.type === 'job') return call('speech_source', { p_auth_id: auth, p_asset_job_id: value.jobId });
        // Strict grants are create-only. Otherwise an outstanding PUT could replace verified bytes before provider fetch.
        if (env.UPLOAD_INTEGRITY_ENABLED !== 'true') return { ok: false, code: 'SOURCE_NOT_ADMITTED' };
        if (!ownsUploadKey(auth, value.key) || !admissionAvailable(env).ok) return { ok: false, code: 'SOURCE_NOT_ADMITTED' };
        const reserved = await select('upload_reservations', { columns: 'r2_key,size_bytes', filter: `r2_key=eq.${encodeURIComponent(value.key)}&limit=1` }, cfg);
        if (reserved?.[0]?.r2_key !== value.key) return { ok: false, code: 'SOURCE_NOT_ADMITTED' };
        const asset = await resolveUpload(auth, value.key, r2cfg, { admission: () => admissionAvailable(env) });
        return asset?.ok && Number(reserved[0].size_bytes) !== Number(asset.size_bytes) ? { ok: false, code: 'SOURCE_UNSUPPORTED' } : asset;
    };
    const preflight = async request => {
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            if (!editorFeatureEnabled('SPEECH_CUT_ENABLED', env) || !editorFeatureEnabled('BEST_CUT_ENABLED', env)) return fail('speech_cut_unavailable', 501);
            const auth = await gate(request); if (auth instanceof Response) return auth;
            let body;
            try {
                body = await readJson(request, 8192); exactKeys(body, ['sources']);
                // One source per call: each upload is streamed and hashed (<=100 MiB), so the read quota in gate() meters one clip at a time.
                if (!Array.isArray(body.sources) || body.sources.length !== 1) return fail('invalid_source', 400);
                for (const value of body.sources) { exactKeys(value, value.type === 'upload' ? ['type', 'key'] : ['type', 'jobId']); if (!validSource(value)) return fail('invalid_source', 400); }
            } catch { return fail('invalid_request', 400); }
            const clips = [];
            for (const value of body.sources) {
                const asset = await source(auth, value); if (asset?.ok !== true) return dbError(asset);
                const result = await call('speech_analysis_preflight', { p_auth_id: auth, p_source_kind: value.type, p_asset_job_id: value.jobId || null, p_fingerprint: asset.sha256, p_size: Number(asset.size_bytes) });
                if (result?.ok !== true) return dbError(result);
                clips.push({ cached: result.cached === true, credits: result.credits });
            }
            return json({ clips });
        } catch { return fail('preflight_unavailable'); }
    };
    const run = async request => {
        let jobId, submitted = false;
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            const auth = await gate(request); if (auth instanceof Response) return auth;
            let body;
            try {
                body = await readJson(request, 2048);
                exactKeys(body, ['source', 'duration', 'idempotencyKey', 'expectedCredits', 'accepts_no_speech', 'cacheOnly']);
                if (!body.source || typeof body.source !== 'object' || Array.isArray(body.source)) return fail('invalid_source', 400);
                exactKeys(body.source, body.source.type === 'upload' ? ['type', 'key'] : ['type', 'jobId']);
            } catch { return fail('invalid_request', 400); }
            const best = body.accepts_no_speech === true;
            if ((body.accepts_no_speech !== undefined && typeof body.accepts_no_speech !== 'boolean') || (body.cacheOnly !== undefined && typeof body.cacheOnly !== 'boolean')) return fail('invalid_request', 400);
            if (!validSource(body.source) || (body.source.type === 'upload' && !best)) return fail('invalid_source', 400);
            if (typeof body.idempotencyKey !== 'string' || !KEY.test(body.idempotencyKey)) return fail('invalid_idempotency_key', 400);
            if (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration < .5 || body.duration > 60) return fail('invalid_duration', 400);
            if (!Number.isSafeInteger(body.expectedCredits) || body.expectedCredits < 0 || (body.expectedCredits === 0 && !(best && body.cacheOnly === true))) return fail('invalid_credits', 400);
            const args = { p_auth_id: auth, p_asset_job_id: body.source.jobId || null };
            const prior = await call('speech_analysis_by_key', { p_auth_id: auth, p_key: body.idempotencyKey });
            if (prior?.ok !== true && !prior?.found) return fail('read_unavailable');
            if (prior?.found) {
                if (prior.source_ref) {
                    if (prior.source_ref !== (body.source.key || body.source.jobId) || prior.accepts_no_speech !== best) return fail('idempotency_conflict', 409);
                } else {
                    const previousAsset = await call('speech_source', args);
                    if (prior.digest !== await digest(body.source.jobId, previousAsset?.sha256)) return fail('idempotency_conflict', 409);
                }
                return outcome(prior, true);
            }
            if (!editorFeatureEnabled('SPEECH_CUT_ENABLED', env) || (best && !editorFeatureEnabled('BEST_CUT_ENABLED', env))) return fail('speech_cut_unavailable', 501);
            const asset = await source(auth, body.source);
            if (asset?.ok !== true) return dbError(asset);
            const row = await model(); if (!row) return fail('speech_cut_unavailable', 501);
            if (!env.FAL_KEY || !env.PUBLIC_HOST || !isConfigured(r2cfg) || typeof env.FAL_KEY !== 'string' || env.FAL_KEY.length < 32) return fail('speech_cut_unavailable', 501);
            const host = new URL(env.PUBLIC_HOST);
            if (host.protocol !== 'https:' || host.username || host.password) return fail('speech_cut_unavailable', 501);
            if (!speechSourceSizeAllowed(asset)) return fail('source_unsupported', 400);
            const cachedProbe = asset.probe?.fingerprint === asset.sha256 && asset.probe?.mime === asset.mime_type ? asset.probe : null;
            const measured = cachedProbe || await probe(asset, r2cfg);
            if (!measured || !speechSourceSizeAllowed(asset, measured.duration)) return fail('source_unsupported', 400);
            if (measured.duration > 60) return fail('source_too_long', 400);
            if (!cachedProbe && body.source.type === 'job') {
                const stored = await call('speech_source_probe_store', { ...args, p_fingerprint: measured.fingerprint, p_duration: measured.duration, p_mime: measured.mime });
                if (stored?.ok !== true) return dbError(stored);
            }
            // The RPC checks the quote, probe, same-key replay, joins and new-work quota atomically.
            const admitted = await call(best ? 'speech_analysis_request_v2' : 'speech_analysis_request', { ...args, p_duration: body.duration, p_key: body.idempotencyKey, p_expected_credits: body.expectedCredits,
                ...(best ? { p_source_kind: body.source.type, p_upload_key: body.source.key || null, p_fingerprint: asset.sha256, p_size: Number(asset.size_bytes), p_measured: measured.duration, p_mime: asset.mime_type, p_accepts_no_speech: true, p_cache_only: body.cacheOnly === true } : {}) });
            if (admitted?.ok !== true) return dbError(admitted);
            if (!admitted.fresh) return outcome(admitted, !!admitted.replay);
            jobId = admitted.id;
            const freshAsset = body.source.type === 'upload' ? (admissionAvailable(env).ok ? asset : null) : await call('speech_source', args);
            if (freshAsset?.ok !== true || freshAsset.sha256 !== measured.fingerprint) throw new Error('source_removed');
            const { url } = await sign(freshAsset.r2_key, 900, r2cfg);
            const callback = new URL('/api/webhook/fal', host.origin);
            callback.searchParams.set('speech_token', await speechCorrelation(jobId, env.FAL_KEY));
            // Once dispatch begins, any thrown transport/ack error is uncertain, never an immediate refund.
            submitted = true;
            const result = await submit({ job_id: jobId, provider_endpoint: row.provider_endpoint, inputs: { audio_url: url, tag_audio_events: false } },
                { falKey: env.FAL_KEY, webhookBaseUrl: callback.toString(), sanitisedSubmission: true });
            if (result.outcome === 'rejected') {
                const refunded = await call('speech_analysis_fail', { p_job_id: jobId, p_code: 'provider_rejected' });
                return fail('provider_rejected', 502, { refunded: refunded?.refunded === true });
            }
            if (result.ok && result.providerJobId) {
                await call('job_submitted', { p_job_id: jobId, p_provider: 'fal', p_provider_job_id: result.providerJobId });
            } else await call('job_submit_rejected', { p_job_id: jobId, p_error_code: 'provider_outcome_unknown' });
            return json({ id: jobId, status: 'queued' }, 202);
        } catch {
            if (jobId && submitted) {
                await call('job_submit_rejected', { p_job_id: jobId, p_error_code: 'provider_outcome_unknown' }).catch(() => {});
                return json({ id: jobId, status: 'queued' }, 202);
            }
            if (jobId) {
                const result = await call('speech_analysis_fail', { p_job_id: jobId, p_code: 'submission_failed' }).catch(() => null);
                return fail('submission_failed', 502, { refunded: result?.refunded === true });
            }
            return fail('request_unavailable');
        }
    };
    return { quote, get, byKey, run, preflight };
}
