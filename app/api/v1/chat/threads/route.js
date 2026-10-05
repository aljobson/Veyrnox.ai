/**
 * GET  /api/v1/chat/threads  — the caller's threads, pinned first.
 * POST /api/v1/chat/threads  — start one: { model_id }.
 * Data access is only through definer functions keyed by the verified auth id (ADR-0067).
 */
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { enter, reply, refusal } from '../../../../../lib/chatRoute.js';
import { MODEL_ID_RE } from '../../../../../lib/chat.js';

export async function GET(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    try {
        const r = await rpc('chat_list_threads', { p_auth_id: gate.authId }, gate.cfg);
        return r && r.ok === true ? reply({ threads: r.threads }) : refusal(r);
    } catch (err) {
        console.error('[chat] list failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}

export async function POST(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.model_id !== 'string' || !MODEL_ID_RE.test(body.model_id)) {
        return reply({ error: 'model_id_required' }, 400);
    }
    try {
        const r = await rpc('chat_create_thread', { p_auth_id: gate.authId, p_model_id: body.model_id }, gate.cfg);
        return r && r.ok === true ? reply({ thread: r.thread }, 201) : refusal(r);
    } catch (err) {
        console.error('[chat] create failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}
