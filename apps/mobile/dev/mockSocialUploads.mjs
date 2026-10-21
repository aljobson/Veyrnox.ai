import { randomUUID } from 'node:crypto';
import { checkSocialUpload } from '../../../lib/social/uploadPolicy.js';
import { checkSniffed } from '../../../lib/uploadSource.js';

export const uploadsEnabled = process.env.MOCK_SOCIAL_UPLOADS === '1';
const uploads = new Map();
const approvals = new Map();
const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const ownerOf = req => {
    const bearer = req.headers.authorization || '';
    try {
        const payload = JSON.parse(Buffer.from(bearer.replace(/^Bearer /, '').split('.')[1], 'base64url').toString());
        if (typeof payload.sub === 'string' && payload.sub) return payload.sub;
    } catch { /* Simple non-JWT tokens are useful in isolated mock tests. */ }
    return bearer || 'mock-owner';
};
const readJson = async req => { let text = ''; for await (const chunk of req) text += chunk; try { return JSON.parse(text); } catch { return {}; } };
const preview = (row, origin) => ({ id: row.id, filename: row.filename, mime_type: row.mime_type, size_bytes: row.size_bytes, url: `${origin}/mock-r2/${row.id}` });
function sweep() {
    for (const [id, row] of uploads) if ((row.status === 'deleting' && Date.now() > row.putExpiresAt) || (row.status === 'pending' && Date.now() - row.created > 86400000)) uploads.delete(id);
}
export function validateUploadMedia(req, res, body) {
    const media = body.media?.filter(m => m.uploadId) ?? [];
    if (!media.length) return false;
    if (!uploadsEnabled || media.some(m => m.jobId)) { reply(res, 400, { error: 'invalid_media' }); return true; }
    for (const m of media) {
        const row = uploads.get(m.uploadId);
        if (!row || row.owner !== ownerOf(req) || row.status !== 'ready' || (row.mime_type.startsWith('video/') ? 'video' : 'image') !== m.mediaType) {
            reply(res, 404, { error: 'MEDIA_NOT_FOUND' }); return true;
        }
    }
    return false;
}
// Run before mock-server's JSON reader: PUT is a raw stream, never text or JSON.
export async function mockSocialUploads(req, res, origin, posts = []) {
    const path = new URL(req.url, origin).pathname;
    const raw = path.match(/^\/mock-r2\/([^/]+)$/);
    const route = path === '/api/v1/social/uploads';
    const approval = path === '/api/v1/social/approvals' && req.method === 'POST';
    if (!raw && !route && !approval) return false;
    sweep();
    if (!uploadsEnabled && !approval) { reply(res, 503, { error: 'uploads_not_open' }); return true; }
    const fail = (code, status = 400) => { reply(res, status, { error: code }); return true; };
    if (raw) {
        const row = uploads.get(raw[1]);
        if (!row || row.status === 'deleting') return fail('upload_not_found', 404);
        if (req.method === 'GET' && row.status === 'ready') {
            res.writeHead(200, { 'content-type': row.mime_type, 'content-length': row.bytes.length }); res.end(row.bytes); return true;
        }
        if (req.method !== 'PUT') return fail('upload_not_found', 404);
        if (Date.now() > row.created + 15 * 60000) return fail('upload_url_expired', 403);
        if (row.bytes) return fail('upload_failed', 412);
        if (Number(req.headers['content-length']) !== row.size_bytes || req.headers['content-type'] !== row.mime_type || req.headers['if-none-match'] !== '*') return fail('upload_integrity_failed');
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > row.size_bytes) return fail('upload_integrity_failed'); chunks.push(chunk); }
        if (length !== row.size_bytes) return fail('upload_integrity_failed');
        row.bytes = Buffer.concat(chunks); reply(res, 200, {}); return true;
    }
    if (route && req.method === 'GET') {
        reply(res, 200, { uploads: [...uploads.values()].filter(r => r.owner === ownerOf(req) && r.status === 'ready').map(r => preview(r, origin)) }); return true;
    }
    const body = await readJson(req);
    if (approval) {
        if (validateUploadMedia(req, res, body)) return true;
        const prior = approvals.get(body.idempotencyKey);
        if (prior) { reply(res, 200, { ...prior, idempotent: true }); return true; }
        const result = { request_id: randomUUID(), review_links: (body.reviewers ?? []).map(email => ({ email, url: `${origin}/social/review/${randomUUID()}` })) };
        for (const media of body.media ?? []) if (media.uploadId) uploads.get(media.uploadId).inUse = true;
        approvals.set(body.idempotencyKey, result); reply(res, 200, result); return true;
    }
    if (req.method === 'POST' && body.action === 'reserve') {
        if (body.rights_confirmed !== true) return fail('upload_consent_required');
        const checked = checkSocialUpload(body.content_type, body.size_bytes);
        if (!checked.ok) return fail(checked.error);
        if (typeof body.filename !== 'string' || !body.filename.trim() || body.filename.length > 180) return fail('invalid_filename');
        const mine = [...uploads.values()].filter(r => r.owner === ownerOf(req));
        if (mine.length >= 10 || mine.reduce((n, r) => n + r.size_bytes, 0) + body.size_bytes > 209715200) return fail('upload_budget_exceeded', 409);
        const id = randomUUID();
        uploads.set(id, { id, owner: ownerOf(req), filename: body.filename, mime_type: checked.contentType, size_bytes: body.size_bytes, status: 'pending', created: Date.now(), putExpiresAt: Date.now() + 16 * 60000 });
        reply(res, 200, { id, upload_url: `${origin}/mock-r2/${id}`, content_type: checked.contentType, headers: { 'Content-Type': checked.contentType, 'If-None-Match': '*' } }); return true;
    }
    const row = uploads.get(body.id);
    if (!row || row.owner !== ownerOf(req) || row.status === 'deleting') return fail('upload_not_found', 404);
    if (req.method === 'DELETE') {
        if (row.inUse || posts.some(p => ['draft', 'scheduled', 'publishing'].includes(p.status) && p.media?.some(m => m.uploadId === row.id))) return fail('upload_in_use', 409);
        row.status = 'deleting'; reply(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && body.action === 'complete') {
        if (!row.bytes || row.bytes.length !== row.size_bytes) return fail('upload_integrity_failed');
        const checked = checkSniffed(row.mime_type, row.bytes.subarray(0, 16));
        if (!checked.ok) return fail(checked.error);
        row.status = 'ready'; reply(res, 200, { upload: preview(row, origin) }); return true;
    }
    return fail('invalid_body');
}
