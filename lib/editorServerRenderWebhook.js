import { verifyEditorRenderBody, CALLBACK_PATH, TIMESTAMP_HEADER, SIGNATURE_HEADER } from './editorServerRenderSigning.js';
import { readBody } from '../packages/security/input.js';
import { finalizeUploadedRender, UUID_RE } from './editorServerRender.js';
import { MAX_OUTPUT_BYTES } from './editorServerRenderTranslate.js';

export function editorServerRenderWebhook(deps) {
    return async request => {
        try {
            const raw = await readBody(request, 4096);
            if (!await verifyEditorRenderBody(deps.secret, CALLBACK_PATH, raw, request.headers.get(TIMESTAMP_HEADER), request.headers.get(SIGNATURE_HEADER))) {
                console.error('[editor-render] signature rejected');
                return Response.json({ error: 'invalid_signature' }, { status: 401 });
            }
            let body;
            try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
            catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
            if (!UUID_RE.test(body?.job_id) || !['started', 'upload_grant', 'done', 'failed'].includes(body?.event)) return Response.json({ error: 'invalid_event' }, { status: 400 });
            const job = await deps.job(body.job_id);
            if (!job) return Response.json({ error: 'not_found' }, { status: 404 });
            await deps.rpc('record_server_render_activity', { p_job_id: job.id });
            if (body.event === 'started' || body.event === 'upload_grant') {
                if (job.state !== 'SUBMITTED') return Response.json({ error: 'job_closed' }, { status: 409 });
                if (body.event === 'started') return Response.json({ ok: true });
                if (!Number.isSafeInteger(body.size_bytes) || body.size_bytes < 1 || body.size_bytes > MAX_OUTPUT_BYTES) {
                    await deps.rpc('fail_server_render', { p_job_id: job.id, p_error: 'render_too_large' });
                    return Response.json({ error: 'render_too_large' }, { status: 400 });
                }
                const grant = await deps.rpc('server_render_upload_grant', { p_job_id: job.id, p_size: body.size_bytes });
                if (!grant?.ok) return Response.json({ error: 'upload_closed' }, { status: 409 });
                const signed = await deps.signPut(grant.r2_key, grant.size_bytes);
                return Response.json({ upload_url: signed.url, headers: { ...signed.headers, 'Content-Length': String(grant.size_bytes) }, expires_in: 900 });
            }
            const externalId = `${job.id}:${body.event}`;
            if (await deps.dedup(externalId, { event: body.event }) === 'duplicate') return Response.json({ ok: true, duplicate: true });
            const result = body.event === 'done' ? await finalizeUploadedRender(job, deps)
                : await deps.rpc('fail_server_render', { p_job_id: job.id, p_error: /^[a-z0-9_]{1,64}$/.test(body.error_code || '') ? body.error_code : 'runner_failed' });
            if (!result?.ok) return Response.json({ error: 'render_not_applied' }, { status: 503 });
            await deps.rpc('cleanup_server_render', { p_job_id: job.id });
            await deps.processed(externalId);
            return Response.json({ ok: true });
        } catch (e) {
            return Response.json({ error: e.status === 413 ? 'body_too_large' : 'internal' }, { status: e.status === 413 ? 413 : 500 });
        }
    };
}
