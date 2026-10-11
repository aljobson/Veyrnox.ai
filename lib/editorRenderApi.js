import { tenantRequest } from '../packages/db/tenant-client.js';
import { requestContext, checkOrigin } from '../packages/security/context.js';
import { readConfig } from '../packages/security/config.js';
import { securityLog } from '../packages/security/log.js';
import { ApiError, errorResponse, responseHeaders } from '../packages/security/errors.js';
import { uuid, readJson, exactKeys, idempotencyKey } from '../packages/security/input.js';
import { rpc, envConfig as dbEnvConfig } from '../packages/db/supabase-client.js';
import { presignPutUrl, presignGetUrl, getObject, sha256Hex, envConfig as storageConfig, isConfigured } from '../packages/adapters/r2.js';
import { readFilmMasterBytes } from './filmMasterBytes.js';
import { assetDownloadName } from './assetDownloadName.js';
import { inspectEditorRender, EDITOR_RENDER_MAX_BYTES } from './editorRenderInspection.js';

const issue = (status, code, message) => { throw new ApiError(status, code, message); };
const safe = row => { const { r2_key, request_key, owner_id, ...rest } = row; void r2_key; void request_key; void owner_id; return rest; };

/** Personal Library operations keep the caller's JWT; only byte inspection is privileged. */
export function editorRenderHandlers({ enabled = process.env.EDITOR_LIBRARY_EXPORTS_ENABLED === 'true', tenant = tenantRequest,
    call = rpc, cfg = dbEnvConfig(), r2cfg = storageConfig(), signPut = presignPutUrl, signGet = presignGetUrl,
    get = getObject, inspect = inspectEditorRender, now = Date.now } = {}) {
    async function route(request, run) {
        let requestId = crypto.randomUUID();
        try {
            const context = requestContext(request); requestId = context.requestId;
            if (!enabled) issue(404, 'NOT_FOUND', 'This feature is not available.');
            checkOrigin(request, readConfig(process.env).publicOrigin);
            const response = await run(context);
            for (const [key, value] of Object.entries(responseHeaders(requestId))) response.headers.set(key, value);
            return response;
        } catch (error) {
            securityLog('API_REQUEST_FAILED', { requestId, status: error instanceof ApiError ? error.status : 500 });
            const response = errorResponse(error, requestId);
            if (response.status === 429) response.headers.set('retry-after', '60');
            return response;
        }
    }
    function storage() { if (!isConfigured(r2cfg)) issue(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'); }
    async function owned(request, context, id) {
        const page = await tenant(request, context, 'rpc/read_editor_library_renders', { method: 'POST', body: { p_id: uuid(id).toLowerCase() } });
        const row = page.renders?.[0];
        if (!row || row.id !== id.toLowerCase()) issue(404, 'NOT_FOUND', 'The saved video was not found.');
        return row;
    }
    const list = request => route(request, async context => {
        const page = await tenant(request, context, 'rpc/read_editor_library_renders', { method: 'POST', body: { p_id: null } });
        return Response.json({ enabled: true, renders: (page.renders || []).map(safe) });
    });
    const reserve = request => route(request, async context => {
        const body = await readJson(request, 4096); exactKeys(body, ['label', 'sha256', 'size_bytes', 'rights_confirmed']);
        if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 160 || /[\u0000-\u001f\u007f]/.test(body.label)
            || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256) || !Number.isSafeInteger(body.size_bytes)
            || body.size_bytes < 1 || body.size_bytes > EDITOR_RENDER_MAX_BYTES || body.rights_confirmed !== true) issue(400, 'INVALID_RENDER', 'Confirm your rights and choose a valid MP4 render up to 25 MiB.');
        storage();
        const row = await tenant(request, context, 'rpc/reserve_editor_library_render', { method: 'POST', body: {
            p_label: body.label.trim(), p_sha256: body.sha256, p_size_bytes: body.size_bytes, p_rights_confirmed: true, p_idempotency_key: idempotencyKey(request),
        } });
        const id = uuid(row.id).toLowerCase();
        if (row.state === 'stored') return Response.json({ id, state: row.state, idempotent: true });
        const remaining = Math.floor((Date.parse(row.created_at) + 900000 - now()) / 1000);
        if (row.state !== 'quarantined' || remaining < 60 || row.r2_key !== `editor-renders/${context.userId.toLowerCase()}/${id}.mp4`) issue(409, 'UPLOAD_CLOSED', 'Start a new save for this export.');
        const grant = await signPut(row.r2_key, 'video/mp4', remaining, r2cfg, body.size_bytes);
        return Response.json({ id, state: row.state, idempotent: row.idempotent, upload_url: grant.url, headers: grant.headers, expires_in: remaining });
    });
    const inspectSaved = (request, id) => route(request, async context => {
        const row = await owned(request, context, id);
        if (row.state === 'stored') return Response.json({ id: row.id, state: 'stored', idempotent: true });
        storage();
        if (!cfg.supabaseUrl || !cfg.serviceRoleKey) issue(503, 'DATA_UNAVAILABLE', 'Inspection is temporarily unavailable.');
        const limited = await call('consume_upload_request', { p_auth_id: context.userId }, cfg);
        if (limited?.ok !== true) issue(429, 'RATE_LIMITED', 'Too many inspection requests. Try again in a minute.');
        const object = await get(row.r2_key, r2cfg);
        if (!object?.ok || object.response.headers.get('content-type')?.split(';')[0] !== 'video/mp4'
            || Number(object.response.headers.get('content-length')) !== row.size_bytes) {
            void object?.response?.body?.cancel().catch(() => {});
            issue(409, 'UPLOAD_INCOMPLETE', 'The upload is incomplete. Try saving again.');
        }
        let bytes;
        try { bytes = await readFilmMasterBytes(object.response.body, row.size_bytes, AbortSignal.timeout(30000)); }
        catch { issue(409, 'UPLOAD_INCOMPLETE', 'The upload is incomplete. Try saving again.'); }
        if (await sha256Hex(bytes) !== row.sha256) issue(400, 'RENDER_MISMATCH', 'The uploaded file did not match the export.');
        const media = await inspect(bytes);
        if (!media) issue(400, 'INVALID_RENDER', 'The export did not pass MP4 inspection.');
        // Ownership was established with the caller's JWT; this one RPC records bytes, never caller-supplied metadata.
        const result = await call('record_editor_render_inspection', { p_id: row.id, p_sha256: row.sha256, p_size_bytes: row.size_bytes,
            p_width: media.width, p_height: media.height, p_seconds: media.seconds, p_frame_rate: media.frame_rate }, cfg);
        return Response.json(result);
    });
    const asset = (request, id) => route(request, async context => {
        const row = await owned(request, context, id);
        if (row.state !== 'stored') issue(404, 'NOT_FOUND', 'The saved video was not found.');
        storage();
        const values = new URL(request.url).searchParams.getAll('download');
        if (values.length > 1 || values.length && values[0] !== '1') issue(400, 'INVALID_DOWNLOAD', 'Choose a valid download request.');
        const signed = await signGet(row.r2_key, 900, r2cfg, values.length ? { downloadFilename: assetDownloadName(row.id, 'video/mp4') } : undefined);
        return Response.json({ url: signed.url, mime_type: 'video/mp4', size_bytes: row.size_bytes, sha256: row.sha256, asset_expires_at: row.expires_at, expires_in: signed.expires });
    });
    const remove = request => route(request, async context => {
        const body = await readJson(request, 4096); exactKeys(body, ['id']);
        return Response.json(await tenant(request, context, 'rpc/remove_editor_library_render', { method: 'POST', body: { p_id: uuid(body.id).toLowerCase() } }));
    });
    return { list, reserve, inspectSaved, asset, remove };
}
