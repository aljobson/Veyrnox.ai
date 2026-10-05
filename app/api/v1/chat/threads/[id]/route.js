/**
 * GET    /api/v1/chat/threads/:id — the thread and its messages.
 * PATCH  /api/v1/chat/threads/:id — { title?, pinned?, system_prompt?, model_id? }. Unknown keys are refused.
 * DELETE /api/v1/chat/threads/:id — soft delete: gone from every read at once.
 */
import { rpc } from '../../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { enter, reply, refusal } from '../../../../../../lib/chatRoute.js';
import { UUID_RE, validateThreadPatch } from '../../../../../../lib/chat.js';

async function call(req, params, fn, args) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'thread_not_found' }, 404);
    try {
        const r = await rpc(fn, { p_auth_id: gate.authId, p_thread_id: id, ...args }, gate.cfg);
        return r && r.ok === true ? r : refusal(r);
    } catch (err) {
        console.error(`[chat] ${fn} failed:`, err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}

export async function GET(req, { params }) {
    const r = await call(req, params, 'chat_get_thread', {});
    return r instanceof Response ? r : reply({ thread: r.thread, messages: r.messages });
}

export async function DELETE(req, { params }) {
    const r = await call(req, params, 'chat_delete_thread', {});
    return r instanceof Response ? r : reply({ ok: true });
}

export async function PATCH(req, { params }) {
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    const v = validateThreadPatch(body);
    if (!v.ok) return reply({ error: v.error }, 400);
    const r = await call(req, params, 'chat_update_thread', {
        p_title: v.patch.title ?? null, p_pinned: v.patch.pinned ?? null,
        p_system_prompt: v.patch.system_prompt ?? null, p_model_id: v.patch.model_id ?? null,
    });
    return r instanceof Response ? r : reply({ thread: r.thread });
}
