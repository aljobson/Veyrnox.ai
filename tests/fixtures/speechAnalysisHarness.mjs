import { createHash } from 'node:crypto';
import { speechAnalysisHandlers } from '../../lib/speechAnalysis.js';
import { createFalWebhookHandler } from '../../lib/falWebhookHandler.js';
import { speechCorrelation } from '../../lib/speechCutCorrelation.js';
import { assetId, fixtures } from './speechCut.mjs';
export const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
export const r2 = { accountId: 'test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test', jurisdiction: 'eu' };
export const body = () => ({ source: { type: 'job', jobId: assetId }, duration: 12, expectedCredits: 2, idempotencyKey: 'speech-key-1234' });
export const request = (value = body(), auth = AUTH) => new Request('https://untrusted.test/api/v1/editor/speech-analyses', {
    method: value ? 'POST' : 'GET', headers: { 'x-veyrnox-auth-id': auth, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}),
});
// Transport fixture only. Real money, concurrency and cleanup are asserted by the PG suite.
export function fixture(options = {}) {
    const calls = [], submissions = [], events = new Map(); let job, debit = 0, refunds = 0, verified = true;
    const fingerprint = 'a'.repeat(64), digest = createHash('sha256').update(`${assetId}:${fingerprint}:1`).digest('hex');
    const receipts = new Map();
    const env = { SPEECH_CUT_ENABLED: 'true', FAL_KEY: 'f'.repeat(40), PUBLIC_HOST: 'https://worker.test', ...options.env };
    const asset = { ok: true, sha256: fingerprint, r2_key: 'private-object', mime_type: 'video/mp4', size_bytes: 500, ...options.asset };
    const view = () => ({ ok: true, id: JOB, status: job?.status || 'queued', progress: job?.state === 'SUBMITTED' ? 'transcribing' : 'queued', analysis: job?.analysis, refunded: job?.state === 'REFUNDED' });
    const rpc = async (name, args) => {
        calls.push({ name, args });
        if (options.rpc?.[name]) return options.rpc[name](args);
        if (name === 'consume_account_read_request') return { ok: true };
        if (name === 'speech_source') return args.p_auth_id === AUTH && !options.removed ? asset : { ok: false, code: 'NOT_FOUND' };
        if (name === 'speech_source_probe_store') return { ok: true };
        if (name === 'speech_analysis_by_key') return args.p_auth_id === AUTH && receipts.has(args.p_key)
            ? { ...view(), ...receipts.get(args.p_key), digest, found: true } : { ok: true, found: false };
        if (name === 'speech_analysis_get') return args.p_auth_id === AUTH && args.p_id === JOB && job && !options.removed ? view() : { ok: false, code: 'NOT_FOUND' };
        if (name === 'speech_analysis_request') {
            if (args.p_expected_credits !== 2) return { ok: false, code: 'PRICE_CHANGED', credits: 2 };
            if (Math.abs(args.p_duration - 12) > .25) return { ok: false, code: 'DURATION_MISMATCH' };
            const kind = job ? job.status === 'completed' ? 'reused_cache' : 'joined_in_flight' : 'new';
            if (!job) { debit++; job = { state: 'DEBITED', status: 'queued', inputs: { kind: 'speech_analysis' } }; }
            receipts.set(args.p_key, { kind }); return { ...view(), fresh: kind === 'new', kind };
        }
        if (name === 'job_submitted') {
            job.state = 'SUBMITTED'; job.provider = args.p_provider_job_id;
            if (options.lostAck) throw Error('private DB ack'); return { ok: true };
        }
        if (name === 'job_submit_rejected') return { ok: true };
        if (name === 'speech_analysis_fail') {
            if (job.state !== 'STORED' && job.state !== 'REFUNDED') { refunds++; job.state = 'REFUNDED'; job.status = 'failed'; }
            return { ok: true, refunded: job.state === 'REFUNDED' };
        }
        if (name === 'speech_analysis_callback') {
            if (options.removed) await rpc('speech_analysis_fail', { p_job_id: JOB });
            if (['REFUNDED', 'STORED'].includes(job.state)) return { ok: true, closed: true };
            job.state = 'SUBMITTED'; job.provider = args.p_provider_request_id; return { ok: true, assetId, duration: 12 };
        }
        if (name === 'speech_analysis_complete') { job.state = 'STORED'; job.status = 'completed'; job.analysis = args.p_analysis; return { ok: true }; }
        throw Error(`Unexpected RPC ${name}`);
    };
    const handlers = speechAnalysisHandlers({ rpc, select: async table => {
        if (table === 'fal_capacity_policy') return options.missingPolicy ? [] : [{ enabled: options.capacity ?? false }];
        if (table === 'fal_admission_control') return options.missingPolicy ? [] : [{ paused: options.paused ?? false }];
        return options.inactive ? [] : [{ id: 'elevenlabs-scribe-v2', active: true, provider: 'fal', provider_endpoint: 'fal-ai/elevenlabs/speech-to-text/scribe-v2', credits_5s: 2 }];
    },
        cfg: {}, r2cfg: r2, env, probe: options.probe || (async () => ({ duration: 12, mime: 'video/mp4', fingerprint })),
        sign: options.sign || (async () => ({ url: 'https://r2.test/source?signature=PRIVATE' })),
        submit: async (...args) => { submissions.push(args); if (options.submitThrow) throw Error('PRIVATE URL'); return options.submit || { ok: true, providerJobId: 'provider-1' }; } });
    const fetchCall = async (input, init = {}) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/jobs')) return Response.json(job?.provider === 'provider-1' ? [{ ...job, id: JOB, user_id: AUTH }] : []);
        if (!url.pathname.endsWith('/webhook_events')) throw Error('unexpected fetch');
        if (init.method === 'POST') { const row = JSON.parse(init.body); if (events.has(row.external_id)) return Response.json([]); events.set(row.external_id, row); return Response.json([row]); }
        const row = events.get('provider-1');
        if (init.method === 'PATCH') { Object.assign(row, JSON.parse(init.body)); return Response.json([row]); }
        return Response.json(row ? [row] : []);
    };
    const webhook = createFalWebhookHandler({ rpcCall: rpc, fetchCall, verify: async () => verified,
        config: () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }), storageConfig: () => r2, expectedTenant: () => 'tenant', speechSecret: () => env.FAL_KEY });
    const callback = async (event = {}, token = true) => {
        const url = new URL('https://worker.test/api/webhook/fal');
        if (token) { url.searchParams.set('job_id', JOB); url.searchParams.set('speech_token', await speechCorrelation(JOB, env.FAL_KEY)); }
        return webhook(new Request(url, { method: 'POST', headers: { 'x-fal-webhook-request-id': 'provider-1' },
            body: JSON.stringify({ request_id: 'provider-1', status: 'OK', payload: fixtures[0].restart, user_id: 'ATTACKER', ...event }) }));
    };
    return { ...handlers, webhook, callback, rpc, calls, submissions, events, env, options, job: () => job, debit: () => debit, refunds: () => refunds, verify: value => { verified = value; } };
}
