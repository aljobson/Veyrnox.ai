/**
 * PATCH  /api/v1/chat/folders/:id — rename: { name }.
 * DELETE /api/v1/chat/folders/:id — delete the folder. Its chats stay, with no folder.
 */
import { rpc } from '../../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { enter, reply, refusal } from '../../../../../../lib/chatRoute.js';
import { UUID_RE, validateFolderName } from '../../../../../../lib/chat.js';

async function call(req, params, fn, args) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'folder_not_found' }, 404);
    try {
        const r = await rpc(fn, { p_auth_id: gate.authId, p_folder_id: id, ...args }, gate.cfg);
        return r && r.ok === true ? r : refusal(r);
    } catch (err) {
        console.error(`[chat] ${fn} failed:`, err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}

export async function DELETE(req, { params }) {
    const r = await call(req, params, 'chat_delete_folder', {});
    return r instanceof Response ? r : reply({ ok: true });
}

export async function PATCH(req, { params }) {
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'name')) return reply({ error: 'invalid_body' }, 400);
    const v = validateFolderName(body.name);
    if (!v.ok) return reply({ error: v.error }, 400);
    const r = await call(req, params, 'chat_rename_folder', { p_name: v.name });
    return r instanceof Response ? r : reply({ folder: r.folder });
}
