import { mkdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { rpc, envConfig as databaseConfig } from '../../packages/db/supabase-client.js';
import { envConfig as r2Config, isConfigured as r2Configured, presignGetUrl } from '../../packages/adapters/r2.js';
import { createStreamUpload } from '../../lib/cinema/stream.js';
import { checkClamd, downloadExact, inspectVideo, scanWithClamd, uploadTusFile } from './scan-file.mjs';

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
    const upload = deps.upload || uploadTusFile;
    const db = deps.db || databaseConfig(), storage = deps.storage || r2Config(), stream = deps.stream || scannerStreamConfig(env);
    if (!UUID.test(row?.upload_id || '') || !UUID.test(row?.claim_token || '') || typeof row.r2_key !== 'string'
        || !Number.isSafeInteger(Number(row.expected_size)) || !['video/mp4', 'video/webm', 'video/quicktime'].includes(row.expected_mime)) throw Error('invalid_claim');
    const size = Number(row.expected_size), path = `/quarantine/${row.upload_id}.video`;
    let sha256 = null, media = null, clamd = null, prepared = null;
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
        const video = await createVideo({ id: row.upload_id, file_size: size, expires_at: row.expires_at }, stream);
        const details = { reason: 'clean', format: media.format, codec: media.codec, duration_seconds: media.duration_seconds,
            width: media.width, height: media.height };
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
        if (!prepared?.ok) {
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

export async function scannerHealth(env = process.env, deps = {}) {
    const clamd = await (deps.checkClamd || checkClamd)({
        host: env.CLAMD_HOST || 'clamav', port: Number(env.CLAMD_PORT || 3310), timeoutMs: 3000,
    });
    if (env.CINEMA_QUARANTINE_SCANNER_ENABLED !== 'true') return { ok: true, mode: 'disabled', clamd: clamd.version };
    const db = deps.db || databaseConfig(), storage = deps.storage || r2Config();
    if (!db.supabaseUrl || !db.serviceRoleKey || !r2Configured(storage)) throw Error('scanner_unconfigured');
    scannerStreamConfig(env);
    return { ok: true, mode: 'enabled', clamd: clamd.version };
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
            const result = await drainScans();
            console.info(JSON.stringify({ event: 'cinema.malware_scan', ...result }));
            if (!result.claimed) await wait(5000);
        } catch (error) {
            console.error(JSON.stringify({ event: 'cinema.malware_scan', ok: false, code: error?.message || 'scanner_failed' }));
            await wait(5000);
        }
    }
    await new Promise(resolve => health.close(resolve));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main();
