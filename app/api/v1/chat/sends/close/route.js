/**
 * POST /api/v1/chat/sends/close — ask about a chat send by its own idempotency key (ADR-0067 amendment 11).
 * Body: { idempotency_key }, in the one shape the browser makes.
 *
 * 200 { closed: false, job_id, state, refunded, credits, model_id, error_code? }  the job that send made (as GET /jobs/:id)
 * 200 { closed: true }   the send made no job, and its key is now closed: no chat reply can be charged for it
 *
 * For a send that was stopped before `start`, so no job id ever reached the browser. Looked for among the caller's own
 * sends only, and closed for the caller only: another person's key reads as one that made no job, whether it did or
 * not. A POST because it can change what is stored. Counted against the shared job-read quota, inside the database call.
 */
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { enter, reply } from '../../../../../../lib/chatRoute.js';
import { SEND_KEY_RE, closeAnswer, sendCloseEnabled } from '../../../../../../lib/chatSendClose.js';
import { rpc } from '../../../../../../packages/db/supabase-client.js';

export async function POST(req) {
    // The quota is counted inside chat_close_send (consume_job_read_request), like the job read: not the chat read bucket.
    const gate = await enter(req, { readLimit: false });
    if (gate instanceof Response) return gate;
    // Off until migration 0242 is applied. The browser reads any refusal as no answer, and its warning stays.
    if (!sendCloseEnabled(process.env)) return reply({ error: 'send_close_not_open' }, 503);
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    const key = body && typeof body === 'object' ? body.idempotency_key : undefined;
    if (typeof key !== 'string' || !SEND_KEY_RE.test(key)) return reply({ error: 'invalid_key' }, 400);
    try {
        return closeAnswer(await rpc('chat_close_send', { p_auth_id: gate.authId, p_idempotency_key: key }, gate.cfg));
    } catch (err) {
        console.error('[chat] chat_close_send failed:', err && err.message);
        return reply({ error: 'close_failed' }, 502);
    }
}
