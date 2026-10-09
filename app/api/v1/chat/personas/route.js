/**
 * GET  /api/v1/chat/personas — the caller's personas, by name, plus whether the feature is on.
 * POST /api/v1/chat/personas — save a new one: { name, instructions, model_id?, thinking?, web? }.
 * A persona is saved instructions plus a default model and options (ADR-0072); it is never priced and never touches a chat that already exists.
 * Data access is only through definer functions keyed by the verified auth id. Behind PERSONAS_ENABLED.
 */
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { enter, reply, refusal } from '../../../../../lib/chatRoute.js';
import { personasEnabled, validatePersona } from '../../../../../lib/chat.js';

export async function GET(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    // Off is a normal answer for the screen, which then shows nothing: no database work at all.
    if (!personasEnabled(process.env)) return reply({ enabled: false, personas: [] });
    try {
        const r = await rpc('chat_list_personas', { p_auth_id: gate.authId }, gate.cfg);
        return r && r.ok === true ? reply({ enabled: true, personas: r.personas }) : refusal(r);
    } catch (err) {
        console.error('[chat] list personas failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}

export async function POST(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    if (!personasEnabled(process.env)) return reply({ error: 'personas_unavailable' }, 404);
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    const v = validatePersona(body);
    if (!v.ok) return reply({ error: v.error }, 400);
    const p = v.persona;
    try {
        const r = await rpc('chat_save_persona', {
            p_auth_id: gate.authId, p_persona_id: null, p_name: p.name, p_instructions: p.instructions,
            p_model_id: p.model_id, p_thinking: p.thinking, p_web: p.web,
        }, gate.cfg);
        return r && r.ok === true ? reply({ persona: r.persona }, 201) : refusal(r);
    } catch (err) {
        console.error('[chat] save persona failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}
