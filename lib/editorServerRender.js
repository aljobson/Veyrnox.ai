import { validProjectDocument } from './projectDocument.js';
import { translateEditorRender, MAX_OUTPUT_BYTES } from './editorServerRenderTranslate.js';
import { publicJob } from './jobState.js';
import { requestContext, checkOrigin } from '../packages/security/context.js';
import { readJson, exactKeys, uuid, idempotencyKey } from '../packages/security/input.js';
import { ApiError } from '../packages/security/errors.js';

const fail = (status, code) => { throw new ApiError(status, code, code); };
export const TIMEOUT_MS = 45 * 60 * 1000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resultError = r => {
    if (r?.ok) return;
    const code = String(r?.code || 'internal').toLowerCase();
    fail(code === 'invalid_render' ? 400 : code === 'not_enabled' ? 501 : code === 'insufficient_balance' ? 402 : code === 'render_limit' || code === 'rate_limited' ? 429 : 409, code);
};

export function editorServerRenderHandlers(deps, { enabled = false, mode = enabled ? 'on' : 'off', previewUserIds = '', publicHost } = {}) {
    const route = run => async request => {
        try {
            const { userId } = requestContext(request);
            checkOrigin(request, publicHost);
            const response = await run(request, userId);
            response.headers.set('cache-control', 'private, no-store');
            return response;
        } catch (e) {
            return Response.json({ error: e instanceof ApiError ? e.code.toLowerCase() : 'internal' }, { status: e instanceof ApiError ? e.status : 500 });
        }
    };
    const admissionGate = authId => {
        if (!['preview', 'on'].includes(mode)) return Response.json({ error: 'editor_server_render_disabled' }, { status: 501 });
        if (mode === 'preview' && !(typeof previewUserIds === 'string' && previewUserIds.split(',')
            .map(id => id.trim()).filter(id => UUID_RE.test(id)).some(id => id.toLowerCase() === authId.toLowerCase()))) return Response.json({ error: 'preview_only' }, { status: 403 });
    };
    const quote = route(async (request, authId) => {
        const unavailable = admissionGate(authId);
        if (unavailable) return unavailable;
        const body = await readJson(request, 40000); exactKeys(body, ['document', 'resolution']);
        const doc = body.document;
        uuid(doc?.project_id);
        if (!['720p', '1080p'].includes(body.resolution)) fail(400, 'editor_render_invalid_document');
        const translated = translateEditorRender(doc.timeline, { resolution: body.resolution });
        if (translated.error) return Response.json(translated, { status: 400 });
        if (!validProjectDocument(doc, doc.project_id)) fail(400, 'editor_render_invalid_document');
        if (doc.canvas.frame_rate !== 30) return Response.json({ error: 'editor_render_unsupported', feature: 'canvas.frame_rate' }, { status: 400 });
        if (doc.timeline.video.length + doc.timeline.audio.length + doc.timeline.text.length > 40) fail(400, 'editor_render_clip_limit');
        const limited = await deps.rpc('consume_upload_request', { p_auth_id: authId });
        if (limited?.ok !== true) fail(429, 'rate_limited');
        const price = await deps.rpc('quote_server_render', { p_seconds: translated.seconds, p_resolution: translated.resolution });
        if (price?.code) resultError(price);
        if (!Number.isSafeInteger(price?.credits) || price.credits < 1) fail(503, 'quote_unavailable');
        return Response.json({ credits: price.credits, seconds: translated.seconds, resolution: translated.resolution, max_seconds: price.max_seconds });
    });
    const create = route(async (request, authId) => {
        const unavailable = admissionGate(authId);
        if (unavailable) return unavailable;
        const body = await readJson(request, 40000); exactKeys(body, ['document', 'resolution', 'label', 'quoted_credits']);
        if (Object.hasOwn(body, 'quoted_credits') && (!Number.isSafeInteger(body.quoted_credits) || body.quoted_credits < 1 || body.quoted_credits > 2147483647)) fail(400, 'invalid_quoted_credits');
        const key = idempotencyKey(request), doc = body.document;
        uuid(doc?.project_id);
        const translated = translateEditorRender(doc?.timeline, { resolution: body.resolution });
        if (translated.error) return Response.json(translated, { status: 400 });
        if (!validProjectDocument(doc, doc.project_id) || typeof body.label !== 'string' || !body.label.trim()
            || body.label.length > 160 || /[\u0000-\u001f\u007f]/.test(body.label)) fail(400, 'editor_render_invalid_document');
        if (doc.canvas.frame_rate !== 30) return Response.json({ error: 'editor_render_unsupported', feature: 'canvas.frame_rate' }, { status: 400 });
        if (doc.timeline.video.length + doc.timeline.audio.length + doc.timeline.text.length > 40) fail(400, 'editor_render_clip_limit');
        const limited = await deps.rpc('consume_upload_request', { p_auth_id: authId });
        if (limited?.ok !== true) fail(429, 'rate_limited');
        // Every media entry, including unused bin items, must be owned. No caller URL crosses this boundary.
        const sources = [];
        for (const m of Object.values(doc.timeline.media)) {
            const row = await deps.rpc('server_render_source', { p_auth_id: authId, p_media_id: m.id });
            if (!row?.ok || !row.mime_type?.startsWith(`${m.kind}/`)) fail(403, 'editor_render_media_not_owned');
            if (m.id.startsWith('u-')) {
                // Reservations are not completion receipts. Match the existing
                // upload consumer's object size/type checks before charging.
                const object = await deps.get(row.r2_key);
                const complete = object?.ok && Number(object.response.headers.get('content-length')) === row.size_bytes
                    && object.response.headers.get('content-type')?.split(';')[0] === row.mime_type;
                await object?.response?.body?.cancel();
                if (!complete) fail(409, 'editor_render_upload_incomplete');
            }
            const url = await deps.signGet(row.r2_key);
            sources.push({ id: m.id, url: url.url, size_bytes: row.size_bytes });
        }
        const admitted = await deps.rpc('admit_server_render', { p_auth_id: authId, p_request_key: key,
            p_document: doc, p_resolution: translated.resolution, p_seconds: translated.seconds, p_label: body.label.trim(),
            ...(Object.hasOwn(body, 'quoted_credits') ? { p_quoted_credits: body.quoted_credits } : {}) });
        resultError(admitted);
        if (admitted.idempotent) return Response.json({ job_id: admitted.job_id, state: admitted.state, credits: admitted.credits, idempotent: true,
            ...(admitted.state === 'REFUNDED' ? { ok: false, error: 'render_refunded', retry_with_new_key: true } : {}),
        }, { status: admitted.state === 'REFUNDED' ? 409 : 200 });
        let sent;
        try { sent = await deps.runner.run({ job_id: admitted.job_id, calls: translated.calls, sources }); }
        catch { sent = { ok: false }; }
        if (!sent?.ok) {
            await deps.rpc('fail_server_render', { p_job_id: admitted.job_id, p_error: sent?.error === 'render_busy' ? 'render_busy' : 'runner_submit_failed' });
            await deps.runner.cancel(admitted.job_id).catch(() => {});
            await deps.rpc('cleanup_server_render', { p_job_id: admitted.job_id });
            return Response.json({ error: sent?.error === 'render_busy' ? 'render_busy' : 'runner_submit_failed', job_id: admitted.job_id }, { status: 503 });
        }
        return Response.json({ job_id: admitted.job_id, credits: admitted.credits, state: 'SUBMITTED' }, { status: 202 });
    });
    const owned = async (request, authId) => {
        const id = uuid(new URL(request.url).searchParams.get('job_id')).toLowerCase();
        const result = await deps.rpc('get_user_job', { p_auth_id: authId, p_job_id: id });
        if (!result?.ok || result.provider !== 'concat-render') fail(404, 'not_found');
        return { ...result, id };
    };
    const status = route(async (request, authId) => {
        const j = await owned(request, authId);
        return Response.json({ job_id: j.id, ...publicJob(j), output_type: 'editor-render' });
    });
    const cancel = route(async (request, authId) => {
        const j = await owned(request, authId);
        const r = await deps.rpc('fail_server_render', { p_job_id: j.id, p_error: 'user_cancelled' });
        resultError(r);
        if (r.state === 'STORED') fail(409, 'job_finished');
        await deps.runner.cancel(j.id).catch(() => {});
        await deps.rpc('cleanup_server_render', { p_job_id: j.id });
        return Response.json({ job_id: j.id, state: 'REFUNDED' });
    });
    return { create, status, cancel, quote };
}

/** Bytes are inspected by the Worker. Never accept a runner digest or user JWT. */
export async function finalizeUploadedRender(job, deps) {
    if (job.state !== 'SUBMITTED') return { ok: true, idempotent: true };
    const object = await deps.get(job.inputs.output_key);
    if (!object?.ok) return { ok: false, missing: object?.status === 404 || object?.response?.status === 404 || object?.error === 'R2 GET 404' };
    const size = Number(object.response.headers.get('content-length'));
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_BYTES || size !== job.inputs.upload_size
        || object.response.headers.get('content-type')?.split(';')[0] !== 'video/mp4') {
        await object.response.body?.cancel();
        return deps.rpc('fail_server_render', { p_job_id: job.id, p_error: size > MAX_OUTPUT_BYTES ? 'render_too_large' : 'render_invalid' });
    }
    const bytes = await deps.readBytes(object.response.body, size);
    const media = await deps.inspect(bytes);
    // Inspection's seconds is the VIDEO packet extent, never the audio duration.
    if (!media || Math.abs(media.seconds - job.inputs.seconds) > Math.max(2 / media.frame_rate, 0.1)) return deps.rpc('fail_server_render', { p_job_id: job.id, p_error: 'render_invalid' });
    const translated = translateEditorRender(job.inputs.document.timeline, { resolution: job.inputs.resolution });
    if (media.width !== translated.width || media.height !== translated.height || media.frame_rate !== 30) return deps.rpc('fail_server_render', { p_job_id: job.id, p_error: 'render_invalid' });
    const result = await deps.rpc('finalize_server_render', { p_job_id: job.id, p_size: bytes.byteLength, p_sha256: await deps.sha256(bytes),
        p_width: media.width, p_height: media.height, p_seconds: media.seconds, p_frame_rate: media.frame_rate });
    return result?.code === 'JOB_CLOSED' ? { ok: true, idempotent: true } : result;
}
