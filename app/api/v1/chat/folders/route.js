/**
 * GET  /api/v1/chat/folders — the caller's folders, by name, each with its chat count.
 * POST /api/v1/chat/folders — make one: { name }.
 * Data access is only through definer functions keyed by the verified auth id (ADR-0067).
 */
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { enter, reply, refusal } from '../../../../../lib/chatRoute.js';
import { validateFolderName } from '../../../../../lib/chat.js';

export async function GET(req) {
    const gate = await enter(req);
    if (gate instanceof Response) return gate;
    try {
        const r = await rpc('chat_list_folders', { p_auth_id: gate.authId }, gate.cfg);
        return r && r.ok === true ? reply({ folders: r.folders }) : refusal(r);
    } catch (err) {
        console.error('[chat] list folders failed:', err && err.message);
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'name')) return reply({ error: 'invalid_body' }, 400);
    const v = validateFolderName(body.name);
    if (!v.ok) return reply({ error: v.error }, 400);
    try {
        const r = await rpc('chat_create_folder', { p_auth_id: gate.authId, p_name: v.name }, gate.cfg);
        return r && r.ok === true ? reply({ folder: r.folder }, 201) : refusal(r);
    } catch (err) {
        console.error('[chat] create folder failed:', err && err.message);
        return reply({ error: 'temporarily_unavailable' }, 503);
    }
}
