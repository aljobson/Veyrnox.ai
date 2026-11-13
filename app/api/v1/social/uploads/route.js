import { readBoundedBody } from '../../../../../lib/boundedBody.js';
import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { presignGetUrl, presignPutUrl, envConfig as r2EnvConfig, isConfigured } from '../../../../../packages/adapters/r2.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { checkSocialUpload, socialUploadsEnabled } from '../../../../../lib/social/uploadPolicy.js';
import { checkSniffed, requireImageDimensions, DIMENSION_BYTES } from '../../../../../lib/uploadSource.js';
import { admissionAvailable } from '../../../../../lib/uploadAdmission.js';
import { fetchWithTimeout } from '../../../../../lib/fetchWithTimeout.js';

import { isUuidLoose } from '../../../../../lib/validate.js';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function context(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !isUuidLoose(authId)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!socialUploadsEnabled(process.env, authId)) return { error: reply({ error: 'uploads_not_open' }, 503) };
    const cfg = envConfig(), r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) return { error: reply({ error: 'not_configured' }, 503) };
    return { authId, cfg, r2cfg };
}
async function preview(upload, r2cfg) {
    const { r2_key, status, ...safe } = upload;
    const signed = await presignGetUrl(r2_key, 900, r2cfg);
    return { ...safe, url: signed.url };
}
export async function GET(req) {
    const ctx = context(req);
    if (ctx.error) return ctx.error;
    const { authId, cfg, r2cfg } = ctx;
    const limited = await accountReadLimit(authId, cfg);
    if (limited) return limited;
    try {
        const result = await rpc('read_social_upload', { p_auth_id: authId }, cfg);
        if (!result?.ok) throw new Error('read failed');
        return reply({ uploads: await Promise.all(result.uploads.map((u) => preview(u, r2cfg))) });
    } catch { return reply({ error: 'uploads_unavailable' }, 503); }
}
export async function POST(req) {
    const ctx = context(req);
    if (ctx.error) return ctx.error;
    const { authId, cfg, r2cfg } = ctx;
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body, 4096, req.signal))); }
    catch (err) { return reply({ error: err.status === 413 ? 'body_too_large' : 'invalid_body' }, err.status === 413 ? 413 : 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'invalid_body' }, 400);
    const limited = await socialPostWriteLimit(authId, cfg);
    if (limited) return limited;
    try {
        if (body.action === 'reserve') {
            const admission = admissionAvailable();
            if (!admission.ok) return reply({ error: admission.error }, 503);
            if (body.rights_confirmed !== true) return reply({ error: 'upload_consent_required' }, 400);
            const checked = checkSocialUpload(body.content_type, body.size_bytes);
            if (!checked.ok) return reply({ error: checked.error }, 400);
            if (typeof body.filename !== 'string' || !body.filename.trim() || body.filename.length > 180) return reply({ error: 'invalid_filename' }, 400);
            const result = await rpc('reserve_social_upload', {
                p_auth_id: authId, p_id: crypto.randomUUID(), p_filename: body.filename,
                p_mime_type: checked.contentType, p_size: body.size_bytes,
            }, cfg);
            if (!result?.ok) return reply({ error: result?.code?.toLowerCase() || 'upload_reservation_unavailable' }, result?.code === 'UPLOAD_BUDGET_EXCEEDED' ? 409 : 503);
            const signed = await presignPutUrl(result.r2_key, checked.contentType, 900, r2cfg, body.size_bytes);
            return reply({ id: result.id, upload_url: signed.url, content_type: signed.contentType, headers: signed.headers });
        }
        if (body.action !== 'complete' || typeof body.id !== 'string' || !isUuidLoose(body.id)) return reply({ error: 'invalid_body' }, 400);
        const result = await rpc('read_social_upload', { p_auth_id: authId, p_id: body.id }, cfg);
        const upload = result?.uploads?.[0];
        if (!upload) return reply({ error: 'upload_not_found' }, 404);
        // Read a bounded header (16 bytes, or the dimension window for an image); never buffer a video in the Worker.
        const signed = await presignGetUrl(upload.r2_key, 60, r2cfg);
        const window = String(upload.mime_type).startsWith('image/') ? DIMENSION_BYTES : 16;
        const end = Math.min(window - 1, upload.size_bytes - 1);
        const res = await fetchWithTimeout(signed.url, { headers: { Range: `bytes=0-${end}` } }, 8000, window);
        if (res.status !== 206 || res.headers.get('content-range') !== `bytes 0-${end}/${upload.size_bytes}`
            || res.headers.get('content-type')?.split(';')[0] !== upload.mime_type) return reply({ error: 'upload_integrity_failed' }, 400);
        const head = new Uint8Array(await res.arrayBuffer());
        const checked = checkSniffed(upload.mime_type, head);
        if (!checked.ok) return reply({ error: checked.error }, 400);
        const canvas = requireImageDimensions(upload.mime_type, head);
        if (!canvas.ok) return reply({ error: canvas.error }, 400);
        const completed = await rpc('complete_social_upload', { p_auth_id: authId, p_id: body.id }, cfg);
        if (!completed?.ok) return reply({ error: 'upload_not_found' }, 404);
        return reply({ upload: await preview(upload, r2cfg) });
    } catch { return reply({ error: 'upload_unavailable' }, 503); }
}
export async function DELETE(req) {
    const ctx = context(req);
    if (ctx.error) return ctx.error;
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body, 4096, req.signal))); }
    catch (err) { return reply({ error: err.status === 413 ? 'body_too_large' : 'invalid_body' }, err.status === 413 ? 413 : 400); }
    if (typeof body?.id !== 'string' || !isUuidLoose(body.id)) return reply({ error: 'invalid_body' }, 400);
    const limited = await socialPostWriteLimit(ctx.authId, ctx.cfg);
    if (limited) return limited;
    try {
        const result = await rpc('remove_social_upload', { p_auth_id: ctx.authId, p_id: body.id }, ctx.cfg);
        if (!result?.ok) return reply({ error: result?.code?.toLowerCase() || 'upload_unavailable' }, result?.code === 'UPLOAD_IN_USE' ? 409 : 404);
        return reply({ ok: true });
    } catch { return reply({ error: 'upload_unavailable' }, 503); }
}
