import { tenantRequest } from '../packages/db/tenant-client.js';
import { protectedRoute } from '../packages/security/route.js';
import { ApiError, errorResponse } from '../packages/security/errors.js';
import { exactKeys, idempotencyKey, readJson, uuid } from '../packages/security/input.js';
import { editorFeatureEnabled } from './editorRuntimeFlags.mjs';
import { rpc, envConfig as dbConfig } from '../packages/db/supabase-client.js';
import { presignPutUrl, presignGetUrl, listObjects, getObject, isConfigured, envConfig } from '../packages/adapters/r2.js';
import { PROJECT_MAX_BYTES, FILE_URL_TTL_SECONDS, withFileInspection, readFileBytes, inspectProjectFile, fileProjection } from './projectFiles.js';
const unavailable = () => new ApiError(503, 'storage-unavailable', 'Storage is temporarily unavailable.');
const missing = () => new ApiError(404, 'not-found', 'The resource was not found.');
const live = file => { if (file.cleanup_state !== 'live') throw new ApiError(409, 'file-unavailable', 'Create a new reservation for this file.'); };
const json = data => Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
const fields = 'id,state,cleanup_state,r2_key,declared_bytes,content_sha256,byte_size,reject_reason';
async function readFile(request, context, id, fileId) {
    const rows = await tenantRequest(request, context, `project_files?id=eq.${fileId}&project_id=eq.${id}&select=${fields}&limit=1`);
    if (!rows[0]) throw missing();
    live(rows[0]); return rows[0];
}
async function visibleProject(request, context, id) {
    const rows = await tenantRequest(request, context, `projects?id=eq.${id}&select=id&limit=1`);
    if (!rows[0]) throw missing();
}
export function proFileRoute(action) {
    return async (request, { params }) => {
        // Gate before configuration and identity, so disabled surfaces consistently return 404.
        if (process.env.TENANT_PROJECTS_ENABLED !== 'true' || !editorFeatureEnabled('PRO_EDITOR_ENABLED')) return errorResponse(missing(), crypto.randomUUID());
        const response = await protectedRoute(request, async context => {
            const p = await params;
            return action(request, context, uuid(p.id).toLowerCase(), p.fileId === undefined ? undefined : uuid(p.fileId).toLowerCase());
        });
        // Only this surface adopts kebab-case; existing tenant contracts remain unchanged.
        if (response.status >= 400) {
            const body = await response.json();
            body.error.code = body.error.code.toLowerCase().replaceAll('_', '-');
            return Response.json(body, { status: response.status, headers: response.headers });
        }
        return response;
    };
}
export const reserveFile = proFileRoute(async (request, context, id) => {
    const body = await readJson(request, 4096);
    exactKeys(body, ['label', 'size_bytes']);
    if (typeof body.label !== 'string' || !body.label.trim() || [...body.label].length > 120 || /[/\\\u0000-\u001f\u007f-\u009f]/u.test(body.label)
        || !Number.isSafeInteger(body.size_bytes) || body.size_bytes < 1 || body.size_bytes > PROJECT_MAX_BYTES)
        throw new ApiError(400, 'invalid-file', 'A label and a file of at most 8 MiB are required.');
    const r2 = envConfig();
    if (!isConfigured(r2)) throw unavailable();
    const reserved = await tenantRequest(request, context, 'rpc/reserve_project_file', { method: 'POST', proFileAware: true,
        body: { p_project_id: id, p_label: body.label, p_declared_bytes: body.size_bytes, p_request_key: idempotencyKey(request) } });
    live(reserved);
    if (reserved.state !== 'quarantined') return json(fileProjection(reserved));
    const remaining = Math.floor((Date.parse(reserved.created_at) + FILE_URL_TTL_SECONDS * 1000 - Date.now()) / 1000);
    if (!Number.isFinite(remaining) || remaining < 60) throw new ApiError(409, 'upload-closed', 'Create a new reservation for this upload.');
    let signed;
    try { signed = await presignPutUrl(reserved.r2_key, 'application/json', remaining, r2, body.size_bytes); } catch { throw unavailable(); }
    return json({ ...fileProjection(reserved), upload_url: signed.url, headers: signed.headers, content_type: 'application/json', max_bytes: PROJECT_MAX_BYTES, expires_in: signed.expires });
});
export const listFiles = proFileRoute(async (request, context, id) => {
    await visibleProject(request, context, id);
    const files = await tenantRequest(request, context, `project_files?project_id=eq.${id}&state=eq.inspected&cleanup_state=eq.live&select=id,label,byte_size,content_sha256,content_fingerprint,schema_version,created_at&order=created_at.desc,id.desc&limit=100`);
    return json({ files });
});
export const downloadFile = proFileRoute(async (request, context, id, fileId) => {
    const file = await readFile(request, context, id, fileId);
    if (file.state !== 'inspected') throw missing();
    let signed;
    try { signed = await presignGetUrl(file.r2_key, FILE_URL_TTL_SECONDS, envConfig()); } catch { throw unavailable(); }
    return json({ file_id: fileId, download_url: signed.url, expires_in: signed.expires });
});
export const inspectFile = proFileRoute(async (request, context, id, fileId) => {
    // A settled file is answered from a cheap caller-JWT read (RLS enforces membership); only a real
    // inspection takes the isolate slot, and only then is a rate-limit token spent, so a busy isolate
    // never costs the caller a token.
    const file = await readFile(request, context, id, fileId);
    if (file.state !== 'quarantined') return json({ ...fileProjection(file), idempotent: true });
    return withFileInspection(async () => {
        await tenantRequest(request, context, 'rpc/consume_project_file_inspection', { method: 'POST', proFileAware: true, body: { p_project_id: id, p_file_id: fileId } });
        const r2 = envConfig(), db = dbConfig();
        if (!isConfigured(r2) || !db.supabaseUrl || !db.serviceRoleKey) throw unavailable();
        let verdict;
        try {
            const listed = await listObjects(file.r2_key, r2, { maxKeys: 1 });
            if (!listed.ok) throw Error('list_failed');
            const object = listed.objects.find(o => o.key === file.r2_key);
            if (!object || !Number.isSafeInteger(object.size)) throw Error('missing');
            if (object.size > PROJECT_MAX_BYTES) verdict = { reject_reason: 'too_large' };
            else if (object.size !== file.declared_bytes) verdict = { reject_reason: 'size_mismatch' };
            else {
                const read = await getObject(file.r2_key, r2, { signal: AbortSignal.timeout(20000), logErrors: false });
                if (!read.ok) throw Error('read_failed');
                verdict = await inspectProjectFile(await readFileBytes(read.response, object.size));
            }
        } catch { throw unavailable(); } // Transport failures leave the reservation quarantined.
        try {
            await rpc('record_project_file_inspection', { p_file_id: fileId,
                p_content_sha256: verdict.content_sha256 ?? null, p_byte_size: verdict.byte_size ?? null,
                p_schema_version: verdict.schema_version ?? null, p_content_fingerprint: verdict.content_fingerprint ?? null,
                p_reject_reason: verdict.reject_reason }, db);
        } catch { throw unavailable(); }
        // Fresh caller-JWT read: never acknowledge bytes that cleanup already fenced off.
        return json(fileProjection(await readFile(request, context, id, fileId)));
    });
});
export const getHead = proFileRoute(async (request, context, id) => {
    await visibleProject(request, context, id);
    const rows = await tenantRequest(request, context, `project_pro_heads?project_id=eq.${id}&select=revision,file_id,actor_id,created_at&order=revision.desc&limit=1`);
    return json(rows[0] || { revision: 0, file_id: null });
});
export const putHead = proFileRoute(async (request, context, id) => {
    const body = await readJson(request, 4096);
    exactKeys(body, ['expected_revision', 'file_id']);
    if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0 || body.expected_revision >= 2147483647) throw new ApiError(400, 'invalid-revision', 'A non-negative revision is required.');
    return json(await tenantRequest(request, context, 'rpc/set_pro_project_head', { method: 'POST', proFileAware: true,
        body: { p_project_id: id, p_expected_revision: body.expected_revision, p_file_id: uuid(body.file_id).toLowerCase(), p_request_key: idempotencyKey(request) } }));
});
