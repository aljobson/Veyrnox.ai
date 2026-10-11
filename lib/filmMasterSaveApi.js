import { rpc, select, envConfig } from '../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured, listObjects, presignPutUrl, getObject, putObject, sha256Hex } from '../packages/adapters/r2.js';
import { readBoundedBody } from './boundedBody.js';
import { ownsUploadKey } from './uploadSource.js';
import { FILM_MASTER_MAX_BYTES, inspectFilmMaster } from './filmMasterInspection.js';
import { signFilmMasterTicket, readFilmMasterTicket } from './filmMasterTicket.js';
import { readFilmMasterBytes } from './filmMasterBytes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
const saved = (id, idempotent = true) => reply({ saved: true, id, idempotent, library_url: `/app/library#master-${id}` });
const fields = ['upload_id', 'source_job_id', 'sha256', 'size_bytes', 'label', 'rights_confirmed'];

export function filmMasterSaveHandlers({ enabled = process.env.FILM_LIBRARY_SAVE_ENABLED === 'true' && process.env.FILM_LIBRARY_MASTERS_ENABLED === 'true',
    cfg = envConfig(), r2cfg = r2EnvConfig(), call = rpc, find = select, list = listObjects, sign = presignPutUrl,
    get = getObject, put = putObject, inspect = inspectFilmMaster, now = Date.now } = {}) {
    async function bodyFor(req, keys) {
        if (new URL(req.url).searchParams.size || req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw reply({ error: 'invalid_request' }, 400);
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body, 4096, AbortSignal.timeout(10000)))); }
        catch { throw reply({ error: 'invalid_request' }, 400); }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !keys.includes(k))) throw reply({ error: 'invalid_request' }, 400);
        return body;
    }
    async function authorize(req) {
        const auth = req.headers.get('x-veyrnox-auth-id');
        if (!UUID.test(auth || '')) throw reply({ error: 'not_authenticated' }, 401);
        if (!enabled) throw reply({ error: 'save_not_available' }, 503);
        if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) throw reply({ error: 'save_unavailable' }, 503);
        const rate = await call('consume_upload_request', { p_auth_id: auth }, cfg);
        if (rate?.code === 'RATE_LIMITED') throw reply({ error: 'rate_limited' }, 429);
        if (rate?.ok !== true) throw reply({ error: 'save_unavailable' }, 503);
        const users = await find('users', { columns: 'id,frozen_at', filter: `auth_id=eq.${encodeURIComponent(auth)}`, limit: 1 }, cfg);
        const user = users?.[0];
        if (!UUID.test(user?.id || '') || user.frozen_at) throw reply({ error: 'save_not_allowed' }, 403);
        return { auth, user: user.id };
    }
    async function sourceFor(auth, job) {
        const asset = await call('get_user_asset', { p_auth_id: auth, p_job_id: job }, cfg);
        if (asset?.ok !== true || asset.state !== 'STORED' || asset.mime_type !== 'video/mp4'
            || !(Date.parse(asset.asset_expires_at) > now())) throw reply({ error: 'source_not_found' }, 404);
        const rows = await find('assets', { columns: 'sha256', filter: `job_id=eq.${encodeURIComponent(job)}&r2_key=eq.${encodeURIComponent(asset.r2_key)}`, limit: 1 }, cfg);
        if (!SHA.test(rows?.[0]?.sha256 || '')) throw reply({ error: 'source_not_found' }, 404);
        return rows[0].sha256;
    }
    async function existing(auth, job, hash) {
        const page = await call('list_film_library_masters', { p_auth_id: auth }, cfg);
        if (page?.ok !== true || !Array.isArray(page.masters)) throw reply({ error: 'save_unavailable' }, 503);
        return { id: page.masters.find(m => m.source_job_id === job && m.sha256 === hash)?.id, count: page.masters.length };
    }
    async function reservation(key, user) {
        const rows = await find('upload_reservations', { columns: 'user_id,size_bytes,created_at,put_expires_at', filter: `r2_key=eq.${encodeURIComponent(key)}`, limit: 1 }, cfg);
        const row = rows?.[0];
        return row?.user_id === user ? row : null;
    }
    async function readBytes(key, size) {
        const object = await get(key, r2cfg);
        if (!object?.ok || object.response.headers.get('content-type')?.split(';')[0] !== 'video/mp4'
            || Number(object.response.headers.get('content-length')) !== size) {
            void object?.response?.body?.cancel().catch(() => {});
            throw reply({ error: 'upload_incomplete' }, 409);
        }
        try { return await readFilmMasterBytes(object.response.body, size, AbortSignal.timeout(30000)); }
        catch { throw reply({ error: 'upload_incomplete' }, 409); }
    }
    async function begin(req) {
        try {
            const { auth, user } = await authorize(req);
            const body = await bodyFor(req, fields);
            if (!UUID.test(body.upload_id || '') || !UUID.test(body.source_job_id || '') || !SHA.test(body.sha256 || '')
                || !Number.isSafeInteger(body.size_bytes) || body.size_bytes < 1 || body.size_bytes > FILM_MASTER_MAX_BYTES
                || typeof body.label !== 'string' || !body.label.trim() || body.label.length > 160
                || body.rights_confirmed !== true) return reply({ error: 'invalid_master' }, 400);
            const job = body.source_job_id.toLowerCase();
            const sourceHash = await sourceFor(auth, job);
            const prior = await existing(auth, job, body.sha256);
            if (prior.id) return saved(prior.id);
            if (prior.count >= 100) return reply({ error: 'master_limit' }, 429);
            const id = body.upload_id.toLowerCase(), key = `uploads/${auth.toLowerCase()}/${id}.mp4`;
            let row = await reservation(key, user);
            if (!row) {
                const held = await list(`uploads/${auth.toLowerCase()}/`, r2cfg, { maxKeys: 11 });
                if (!held?.ok) return reply({ error: 'save_unavailable' }, 503);
                if (held.objects.length >= 10) return reply({ error: 'upload_budget_exceeded' }, 429);
                const reserved = await call('reserve_upload', { p_auth_id: auth, p_key: key, p_size: body.size_bytes, p_stored: held.objects.map(({ key, size }) => ({ key, size })) }, cfg);
                if (reserved?.ok !== true && reserved?.code !== 'ALREADY_RESERVED') return reply({ error: reserved?.code === 'UPLOAD_BUDGET_EXCEEDED' ? 'upload_budget_exceeded' : 'save_unavailable' }, reserved?.code === 'UPLOAD_BUDGET_EXCEEDED' ? 429 : 503);
                row = await reservation(key, user);
            }
            const expiry = Math.min(Date.parse(row?.created_at) + 900000, Date.parse(row?.put_expires_at));
            const remaining = Math.floor((expiry - now()) / 1000);
            if (Number(row?.size_bytes) !== body.size_bytes || !(remaining >= 60)) return reply({ error: 'upload_expired' }, 409);
            const grant = await sign(key, 'video/mp4', remaining, r2cfg, body.size_bytes);
            const ticket = await signFilmMasterTicket({ auth_id: auth, user_id: user, id, key, job, source_hash: sourceHash,
                sha256: body.sha256, size: body.size_bytes, label: body.label.trim(), expires_at: expiry }, r2cfg.secretAccessKey);
            return reply({ ticket, upload_url: grant.url, headers: grant.headers, expires_in: remaining });
        } catch (e) { return e instanceof Response ? e : reply({ error: 'save_unavailable' }, 503); }
    }
    async function finish(req) {
        try {
            const { auth, user } = await authorize(req);
            const body = await bodyFor(req, ['ticket']);
            const ticket = await readFilmMasterTicket(body.ticket, r2cfg.secretAccessKey, auth, now());
            if (!ticket || ticket.user_id !== user || !ownsUploadKey(auth, ticket.key)) return reply({ error: 'upload_expired' }, 409);
            if (await sourceFor(auth, ticket.job) !== ticket.source_hash) return reply({ error: 'source_not_found' }, 404);
            const prior = await existing(auth, ticket.job, ticket.sha256);
            if (prior.id) return saved(prior.id);
            const row = await reservation(ticket.key, user);
            if (!row || Number(row.size_bytes) !== ticket.size || !(Date.parse(row.put_expires_at) > now())) return reply({ error: 'upload_expired' }, 409);
            const bytes = await readBytes(ticket.key, ticket.size);
            if (await sha256Hex(bytes) !== ticket.sha256) return reply({ error: 'master_mismatch' }, 400);
            const media = await inspect(bytes);
            if (!media) return reply({ error: 'invalid_master_media' }, 400);
            const key = `film-masters/${user}/${ticket.id}.mp4`;
            const stored = await put(key, bytes, 'video/mp4', r2cfg, { onlyIfAbsent: true });
            if (!stored?.ok && stored?.status !== 412) return reply({ error: 'save_unavailable' }, 503);
            if (await sha256Hex(await readBytes(key, ticket.size)) !== ticket.sha256) return reply({ error: 'master_mismatch' }, 409);
            const result = await call('store_film_library_master', { p_auth_id: auth, p_id: ticket.id, p_source_job_id: ticket.job,
                p_source_sha256: ticket.source_hash, p_label: ticket.label, p_sha256: ticket.sha256,
                p_size_bytes: ticket.size, p_seconds: media.seconds }, cfg);
            if (result?.ok !== true || !UUID.test(result.id || '')) return reply({ error: result?.code === 'MASTER_LIMIT' ? 'master_limit' : 'save_unavailable' }, result?.code === 'MASTER_LIMIT' ? 429 : 503);
            // Retain the reservation until the existing 24-hour sweep. It is a
            // durable receipt for cleaning an unregistered copy after a lost RPC reply.
            return saved(result.id, result.idempotent);
        } catch (e) { return e instanceof Response ? e : reply({ error: 'save_unavailable' }, 503); }
    }
    return { begin, finish };
}
