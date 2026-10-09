/**
 * POST /api/v1/chat/threads/:id/messages — send a message, stream the reply (server-sent events).
 * Body: { text, idempotency_key }. The turn itself lives in lib/chatTurn.js (ADR-0067): one job per reply,
 * priced per reply from model_catalog, refunded when it fails.
 *
 * Events: start {job_id, credits, balance_after} · delta {text} · error {error} ·
 *         done {status, credits_charged, message_id?, balance?}
 */
import { limitRequestBody } from '../../../../../../../lib/requestBodyLimit.js';
import { enter, reply } from '../../../../../../../lib/chatRoute.js';
import { runChatTurn } from '../../../../../../../lib/chatTurn.js';
import { requestWaitUntil } from '../../../../../../../lib/requestWaitUntil.js';

export async function POST(req, { params }) {
    // The attempt limit is counted inside the turn (check_generation_rate_limit, then ledger_debit), not the read bucket.
    const gate = await enter(req, { readLimit: false });
    if (gate instanceof Response) return gate;
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
    const { id } = await params;
    // The turn is finished after the reader has gone (ADR-0067 amendment 10): the signal reports the disconnect and
    // waitUntil lets the save and the charge run to their end.
    return runChatTurn({ authId: gate.authId, threadId: id, body, signal: req.signal, waitUntil: requestWaitUntil(), cfg: gate.cfg });
}
