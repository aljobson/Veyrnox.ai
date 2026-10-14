import { mkdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { rpc, envConfig as databaseConfig } from '../../packages/db/supabase-client.js';
import { envConfig as r2Config, isConfigured as r2Configured, presignGetUrl } from '../../packages/adapters/r2.js';
import { createStreamUpload } from '../../lib/cinema/stream.js';
import { checkClamd, downloadExact, inspectVideo, scanWithClamd, uploadTusFile } from './scan-file.mjs';
import { moderateSubmission, moderateVideo } from './moderate.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SAFE_REASONS = new Set(['size_mismatch', 'unsupported_media_type', 'invalid_media']);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function scannerStreamConfig(env = process.env) {
    if (!/^[a-f0-9]{32}$/.test(env.CINEMA_STREAM_ACCOUNT_ID || '') || !env.CINEMA_STREAM_API_TOKEN) throw Error('stream_unconfigured');
    return { account: env.CINEMA_STREAM_ACCOUNT_ID, token: env.CINEMA_STREAM_API_TOKEN };
}

export async function processScan(row, env = process.env, deps = {}) {
    const call = deps.rpcCall || rpc, sign = deps.presign || presignGetUrl;
    const download = deps.download || downloadExact, inspect = deps.inspect || inspectVideo;
    const antivirus = deps.antivirus || scanWithClamd, createVideo = deps.createVideo || createStreamUpload;
    const upload = deps.upload || uploadTusFile, moderate = deps.moderate || moderateVideo;
    const db = deps.db || databaseConfig(), storage = deps.storage || r2Config(), stream = deps.stream || scannerStreamConfig(env);
    if (!UUID.test(row?.upload_id || '') || !UUID.test(row?.claim_token || '') || typeof row.r2_key !== 'string'
        || !Number.isSafeInteger(Number(row.expected_size)) || !['video/mp4', 'video/webm', 'video/quicktime'].includes(row.expected_mime)) throw Error('invalid_claim');
    const size = Number(row.expected_size), path = `/quarantine/${row.upload_id}.video`;
    let sha256 = null, media = null, clamd = null, prepared = null, finalized = false;
    try {
        const signed = await sign(row.r2_key, 900, storage);
        ({ sha256 } = await download(signed.url, path, size));
        try { media = await inspect(path, size); }
        catch (error) {
            if (!SAFE_REASONS.has(error?.message)) throw error;
            const saved = await call('record_cinema_malware_scan', { p_upload_id: row.upload_id, p_claim_token: row.claim_token,
                p_verdict: 'flagged', p_sha256: sha256, p_sniffed_mime: null, p_scanner_version: null,
                p_details: { reason: error.message } }, db);
            if (saved?.ok !== true) throw Error('record_failed');
            return { ok: true, verdict: 'flagged' };
        }
        clamd = await antivirus(path, { host: env.CLAMD_HOST || 'clamav', port: Number(env.CLAMD_PORT || 3310), timeoutMs: 600000 });
        if (clamd.verdict === 'flagged') {
            const saved = await call('record_cinema_malware_scan', { p_upload_id: row.upload_id, p_claim_token: row.claim_token,
                p_verdict: 'flagged', p_sha256: sha256, p_sniffed_mime: media.mime, p_scanner_version: clamd.version,
                p_details: { reason: 'malware_signature', signature: clamd.signature } }, db);
            if (saved?.ok !== true) throw Error('record_failed');
            return { ok: true, verdict: 'flagged' };
        }
        if (clamd.verdict !== 'passed') throw Error('clamd_unavailable');
        const details = { reason: 'clean', format: media.format, codec: media.codec, duration_seconds: media.duration_seconds,
            width: media.width, height: media.height };
        if (env.CINEMA_CONTENT_MODERATOR_ENABLED === 'true') {
            const moderation = await moderate(path, media, env);
            if (!['passed', 'flagged', 'unavailable'].includes(moderation?.status)) throw Error('invalid_moderation_result');
            const saved = await call('record_cinema_upload_content_check', { p_upload_id: row.upload_id, p_claim_token: row.claim_token,
                p_verdict: moderation.status, p_sha256: sha256, p_provider: moderation.provider, p_model: moderation.model,
                p_details: moderation.details, p_sniffed_mime: media.mime, p_scanner_version: clamd.version,
                p_malware_details: details }, db);
            if (saved?.ok !== true) throw Error('content_record_failed');
            if (moderation.status !== 'passed') {
                finalized = true;
                return { ok: moderation.status === 'flagged', verdict: moderation.status };
            }
        }
        const video = await createVideo({ id: row.upload_id, file_size: size, expires_at: row.expires_at }, stream);
        prepared = await call('prepare_cinema_scanned_upload', { p_upload_id: row.upload_id, p_claim_token: row.claim_token,
            p_sha256: sha256, p_sniffed_mime: media.mime, p_scanner_version: clamd.version, p_details: details,
            p_uid: video.uid, p_url: video.url }, db);
        if (prepared?.ok !== true) throw Error('prepare_failed');
        try { await upload(video.url, path, size); }
        catch (error) {
            await call('fail_cinema_scanned_delivery', { p_upload_id: row.upload_id, p_uid: video.uid }, db).catch(() => {});
            throw error;
        }
        return { ok: true, verdict: 'passed' };
    } catch (error) {
        if (!prepared?.ok && !finalized) {
            await call('record_cinema_malware_scan', { p_upload_id: row.upload_id, p_claim_token: row.claim_token,
                p_verdict: 'unavailable', p_sha256: sha256, p_sniffed_mime: media?.mime || null,
                p_scanner_version: clamd?.version || null, p_details: { reason: 'scanner_unavailable' } }, db).catch(() => {});
        }
        return { ok: false, verdict: 'unavailable', error: error?.message || 'scanner_unavailable' };
    } finally { await unlink(path).catch(() => {}); }
}

export async function drainScans(env = process.env, deps = {}) {
    if (env.CINEMA_QUARANTINE_SCANNER_ENABLED !== 'true') return { ok: true, skipped: 'disabled' };
    const db = deps.db || databaseConfig(), storage = deps.storage || r2Config();
    if (!db.supabaseUrl || !db.serviceRoleKey || !r2Configured(storage)) throw Error('scanner_unconfigured');
    const call = deps.rpcCall || rpc;
    const rows = await call('claim_cinema_malware_scans', { p_limit: 1, p_lease_seconds: 1800 }, db);
    if (!Array.isArray(rows) || rows.length > 1) throw Error('invalid_claim_batch');
    if (!rows.length) return { ok: true, claimed: 0, passed: 0, flagged: 0, unavailable: 0 };
    const result = await processScan(rows[0], env, { ...deps, db, storage, rpcCall: call });
    return { ok: result.ok, claimed: 1, passed: result.verdict === 'passed' ? 1 : 0,
        flagged: result.verdict === 'flagged' ? 1 : 0, unavailable: result.verdict === 'unavailable' ? 1 : 0 };
}

export async function drainSubmissionModeration(env = process.env, deps = {}) {
    if (env.CINEMA_CONTENT_MODERATOR_ENABLED !== 'true') return { ok: true, skipped: 'disabled' };
    const db = deps.db || databaseConfig();
    if (!db.supabaseUrl || !db.serviceRoleKey || !env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.length < 20) throw Error('moderator_unconfigured');
    const call = deps.rpcCall || rpc, moderate = deps.moderateSubmission || moderateSubmission;
    const rows = await call('claim_cinema_submission_moderation', { p_lease_seconds: 900 }, db);
    if (!Array.isArray(rows) || rows.length > 1) throw Error('invalid_moderation_claim');
    if (!rows.length) return { ok: true, claimed: 0, passed: 0, flagged: 0, unavailable: 0 };
    const row = rows[0], result = await moderate(row, env);
    if (!['passed', 'flagged', 'unavailable'].includes(result?.status)) throw Error('invalid_moderation_result');
    const saved = await call('record_cinema_submission_content_moderation', { p_submission_id: row.submission_id,
        p_claim_token: row.claim_token, p_verdict: result.status, p_model: result.model,
        p_evidence_sha256: row.evidence_sha256, p_details: result.details }, db);
    if (saved?.ok !== true) throw Error('moderation_record_failed');
    return { ok: result.status !== 'unavailable', claimed: 1, passed: result.status === 'passed' ? 1 : 0,
        flagged: result.status === 'flagged' ? 1 : 0, unavailable: result.status === 'unavailable' ? 1 : 0 };
}

export async function scannerHealth(env = process.env, deps = {}) {
    const clamd = await (deps.checkClamd || checkClamd)({
        host: env.CLAMD_HOST || 'clamav', port: Number(env.CLAMD_PORT || 3310), timeoutMs: 3000,
    });
    if (env.CINEMA_QUARANTINE_SCANNER_ENABLED !== 'true') return { ok: true, mode: 'disabled', clamd: clamd.version };
    const db = deps.db || databaseConfig(), storage = deps.storage || r2Config();
    if (!db.supabaseUrl || !db.serviceRoleKey || !r2Configured(storage)) throw Error('scanner_unconfigured');
    scannerStreamConfig(env);
    const contentModeration = env.CINEMA_CONTENT_MODERATOR_ENABLED === 'true' ? 'enabled' : 'disabled';
    if (contentModeration === 'enabled' && (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.length < 20)) throw Error('anthropic_unconfigured');
    return { ok: true, mode: 'enabled', clamd: clamd.version, content_moderation: contentModeration,
        ...(contentModeration === 'enabled' ? { content_model: env.CINEMA_CONTENT_MODEL || 'claude-haiku-5-5' } : {}) };
}

export async function startHealthServer(env = process.env, deps = {}) {
    const host = deps.host || '0.0.0.0', port = Number(deps.port ?? env.PORT ?? 8080);
    const server = createServer(async (request, response) => {
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        if (request.method !== 'GET' || request.url !== '/healthz') {
            response.statusCode = 404; response.end(JSON.stringify({ ok: false })); return;
        }
        try { response.statusCode = 200; response.end(JSON.stringify(await scannerHealth(env, deps))); }
        catch { response.statusCode = 503; response.end(JSON.stringify({ ok: false, code: 'scanner_unavailable' })); }
    });
    server.listen(port, host);
    await once(server, 'listening');
    return server;
}

async function main() {
    await mkdir('/quarantine', { recursive: true, mode: 0o700 });
    let stopping = false;
    process.once('SIGTERM', () => { stopping = true; });
    process.once('SIGINT', () => { stopping = true; });
    const health = await startHealthServer();
    while (!stopping) {
        try {
            const malware = await drainScans(), content = await drainSubmissionModeration();
            console.info(JSON.stringify({ event: 'cinema.moderation_cycle', malware, content }));
            if (!malware.claimed && !content.claimed) await wait(5000);
        } catch (error) {
            console.error(JSON.stringify({ event: 'cinema.moderation_cycle', ok: false, code: error?.message || 'scanner_failed' }));
            await wait(5000);
        }
    }
    await new Promise(resolve => health.close(resolve));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main();
