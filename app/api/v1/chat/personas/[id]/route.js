/**
 * PATCH  /api/v1/chat/personas/:id — change one of the caller's personas (the whole persona, as on create).
 * DELETE /api/v1/chat/personas/:id — delete it. Chats started from it keep the instructions they were given.
 * Behind PERSONAS_ENABLED.
 */
import { rpc } from '../../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { enter, reply, refusal } from '../../../../../../lib/chatRoute.js';
import { UUID_RE, personasEnabled, validatePersona } from '../../../../../../lib/chat.js';

async function call(req, params, fn, args) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    if (!personasEnabled(process.env)) return reply({ error: 'personas_unavailable' }, 404);
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'persona_not_found' }, 404);
    try {
        const r = await rpc(fn, { p_auth_id: gate.authId, p_persona_id: id, ...args }, gate.cfg);
        return r && r.ok === true ? r : refusal(r);
    } catch (err) {
        console.error(`[chat] ${fn} failed:`, err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}

export async function DELETE(req, { params }) {
    const r = await call(req, params, 'chat_delete_persona', {});
    return r instanceof Response ? r : reply({ ok: true });
}

export async function PATCH(req, { params }) {
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    const v = validatePersona(body);
    if (!v.ok) return reply({ error: v.error }, 400);
    const p = v.persona;
    const r = await call(req, params, 'chat_save_persona', { p_name: p.name, p_instructions: p.instructions, p_model_id: p.model_id, p_thinking: p.thinking, p_web: p.web });
    return r instanceof Response ? r : reply({ persona: r.persona });
}
