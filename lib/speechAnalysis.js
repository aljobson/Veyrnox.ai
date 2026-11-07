import { rpc as realRpc, select as realSelect, envConfig } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { presignGetUrl, envConfig as r2EnvConfig, isConfigured } from '../packages/adapters/r2.js';
import { readJson, exactKeys, UUID_RE } from '../packages/security/input.js';
import { probeSpeechSource, speechSourceSizeAllowed } from './speechSourceProbe.js';
import { speechCorrelation } from './speechCutCorrelation.js';
import { SPEECH_CUT_LANGUAGES } from './speechCutLanguage.js';
import { parseSmartCutAnalysis } from '../app/veyrnox/_lib/smartCutAnalysis.js';
const KEY = /^[A-Za-z0-9._-]{8,128}$/;
const MODEL = 'elevenlabs-scribe-v2';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (code, status = 503, extra = {}) => json({ error: code, ...extra }, status);
const codes = { NOT_FOUND: 404, SOURCE_UNSUPPORTED: 400, SOURCE_TOO_LONG: 400, DURATION_MISMATCH: 400, PRICE_CHANGED: 409,
    IDEMPOTENCY_CONFLICT: 409, RESULT_EXPIRED: 410, SPEECH_CUT_UNAVAILABLE: 501, RATE_LIMITED: 429, INSUFFICIENT_BALANCE: 402, ACCOUNT_FROZEN: 403, AI_DISABLED: 403, PROVIDER_ADMISSION_PAUSED: 503, ACCOUNT_ON_HOLD: 403 };
const dbError = result => fail(Object.hasOwn(codes, result?.code) ? result.code.toLowerCase() : 'request_unavailable', codes[result?.code] || 503,
    result?.code === 'PRICE_CHANGED' ? { credits: result.credits } : {});
const digest = async (assetId, fingerprint) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${assetId}:${fingerprint}:1`))), b => b.toString(16).padStart(2, '0')).join('');

export function speechAnalysisHandlers({ rpc = realRpc, select = realSelect, submit = submitJob, probe = probeSpeechSource,
    sign = presignGetUrl, cfg = envConfig(), r2cfg = r2EnvConfig(), env = process.env } = {}) {
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
            ? fail('request_failed_refunded', 409, { refunded: true }) : json({ id: result.id, status: 'failed', refunded: result.refunded === true });
        if (result.status === 'completed') {
            const parsed = parseSmartCutAnalysis(result.analysis);
            if (!parsed.ok) return fail('analysis_invalid');
            return json({ id: result.id, status: 'completed', analysis: parsed.analysis, ...(result.kind === 'reused_cache' ? { reused: true } : {}) });
        }
        return json({ id: result.id, status: 'queued', progress: result.progress === 'transcribing' ? 'transcribing' : 'queued',
            ...(result.kind === 'joined_in_flight' ? { reused: 'in_flight' } : {}) }, 202);
    };
    const quote = async request => {
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            if (env.SPEECH_CUT_ENABLED !== 'true') return fail('speech_cut_unavailable', 501);
            const auth = await gate(request); if (auth instanceof Response) return auth;
            const row = await model(); if (!row) return fail('speech_cut_unavailable', 501);
            // Same fail-closed sources as private.fal_admission_paused(model, false).
            const [capacity, admission] = await Promise.all([
                select('fal_capacity_policy', { columns: 'enabled', filter: 'singleton=eq.true&limit=1' }, cfg),
                select('fal_admission_control', { columns: 'paused', filter: 'singleton=eq.true&limit=1' }, cfg),
            ]);
            if (capacity?.[0]?.enabled !== false || admission?.[0]?.paused !== false) return fail('speech_cut_unavailable', 501);
            return json({ credits: row.credits_5s, max_seconds: 60, languages: SPEECH_CUT_LANGUAGES });
        } catch { return fail('quote_unavailable'); }
    };
    const get = async (request, id) => {
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            if (env.SPEECH_CUT_ENABLED !== 'true') return fail('speech_cut_unavailable', 501);
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
    const run = async request => {
        let jobId, submitted = false;
        try {
            if (!UUID_RE.test(request.headers.get('x-veyrnox-auth-id') || '')) return fail('not_authenticated', 401);
            if (env.SPEECH_CUT_ENABLED !== 'true') return fail('speech_cut_unavailable', 501);
            const auth = await gate(request); if (auth instanceof Response) return auth;
            let body;
            try {
                body = await readJson(request, 2048);
                exactKeys(body, ['source', 'duration', 'idempotencyKey', 'expectedCredits']);
                if (!body.source || typeof body.source !== 'object' || Array.isArray(body.source)) return fail('invalid_source', 400);
                exactKeys(body.source, ['type', 'jobId']);
            } catch { return fail('invalid_request', 400); }
            if (body.source.type !== 'job' || !UUID_RE.test(body.source.jobId || '')) return fail('invalid_source', 400);
            if (typeof body.idempotencyKey !== 'string' || !KEY.test(body.idempotencyKey)) return fail('invalid_idempotency_key', 400);
            if (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration < .5 || body.duration > 60) return fail('invalid_duration', 400);
            if (!Number.isSafeInteger(body.expectedCredits) || body.expectedCredits < 1) return fail('invalid_credits', 400);
            const args = { p_auth_id: auth, p_asset_job_id: body.source.jobId };
            const prior = await call('speech_analysis_by_key', { p_auth_id: auth, p_key: body.idempotencyKey });
            if (prior?.ok !== true && !prior?.found) return fail('read_unavailable');
            const asset = await call('speech_source', args);
            if (asset?.ok !== true) return dbError(asset);
            if (prior?.found) {
                if (prior.digest !== await digest(body.source.jobId, asset.sha256)) return fail('idempotency_conflict', 409);
                return outcome(prior, true);
            }
            const row = await model(); if (!row) return fail('speech_cut_unavailable', 501);
            if (!env.FAL_KEY || !env.PUBLIC_HOST || !isConfigured(r2cfg) || typeof env.SPEECH_CUT_WEBHOOK_SECRET !== 'string' || env.SPEECH_CUT_WEBHOOK_SECRET.length < 32) return fail('speech_cut_unavailable', 501);
            const host = new URL(env.PUBLIC_HOST);
            if (host.protocol !== 'https:' || host.username || host.password) return fail('speech_cut_unavailable', 501);
            if (!speechSourceSizeAllowed(asset)) return fail('source_unsupported', 400);
            const cachedProbe = asset.probe?.fingerprint === asset.sha256 && asset.probe?.mime === asset.mime_type ? asset.probe : null;
            const measured = cachedProbe || await probe(asset, r2cfg);
            if (!measured || !speechSourceSizeAllowed(asset, measured.duration)) return fail('source_unsupported', 400);
            if (measured.duration > 60) return fail('source_too_long', 400);
            if (!cachedProbe) {
                const stored = await call('speech_source_probe_store', { ...args, p_fingerprint: measured.fingerprint, p_duration: measured.duration, p_mime: measured.mime });
                if (stored?.ok !== true) return dbError(stored);
            }
            // The RPC checks the quote, probe, same-key replay, joins and new-work quota atomically.
            const admitted = await call('speech_analysis_request', { ...args, p_duration: body.duration, p_key: body.idempotencyKey, p_expected_credits: body.expectedCredits });
            if (admitted?.ok !== true) return dbError(admitted);
            if (!admitted.fresh) return outcome(admitted, !!admitted.replay);
            jobId = admitted.id;
            const freshAsset = await call('speech_source', args);
            if (freshAsset?.ok !== true || freshAsset.sha256 !== measured.fingerprint) throw new Error('source_removed');
            const { url } = await sign(freshAsset.r2_key, 900, r2cfg);
            const callback = new URL('/api/webhook/fal', host.origin);
            callback.searchParams.set('speech_token', await speechCorrelation(jobId, env.SPEECH_CUT_WEBHOOK_SECRET));
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
    return { quote, get, byKey, run };
}
