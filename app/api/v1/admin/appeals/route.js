/**
 * /api/v1/admin/appeals — the appeals queue (ADR-0083, Ofcom ICU D1/D2/D10).
 *
 *   GET  ?status=open|upheld|rejected&limit=<n>
 *                                    appeals with the sanction they contest,
 *                                    the operator's original reason and the
 *                                    user's statement; open ones first
 *   POST { appeal_id, decision, reason }
 *                                    decide one, once. 'upheld' takes the
 *                                    strike out of the count, recomputes the
 *                                    hold and lifts a content Freeze when
 *                                    fewer than three strikes remain;
 *                                    'rejected' records why. Requires an
 *                                    Idempotency-Key: a replay answers 200
 *                                    with the first decision.
 *
 * Same four gates as /api/v1/admin/metrics (lib/adminGate.js). After a
 * decision the user is emailed (lib/violationEmail.js); `email` in the
 * response is 'sent', 'failed' or 'skipped'.
 */

import { NextResponse } from 'next/server';
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { notifyAppealDecision } from '../../../../../lib/violationEmail.js';
import { adminGate, rpcFailure, rpcRefusal, readJsonObject, idempotencyKey, UUID_RE, NO_STORE } from '../../../../../lib/adminGate.js';

const WHERE = 'api/v1/admin/appeals';
const STATUSES = new Set(['open', 'upheld', 'rejected']);
const DECISIONS = new Set(['upheld', 'rejected']);

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'open';
    if (status !== 'all' && !STATUSES.has(status)) return NextResponse.json({ error: 'status_invalid' }, { status: 400 });
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return NextResponse.json({ error: 'limit_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('list_content_appeals', { p_auth_id: g.authId, p_status: status === 'all' ? null : status, p_limit: limit }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'appeals_unavailable');
    return NextResponse.json({ appeals: Array.isArray(result.appeals) ? result.appeals : [] }, { headers: NO_STORE });
}

export async function POST(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const k = idempotencyKey(req);
    if (k.response) return k.response;
    const b = await readJsonObject(req);
    if (b.response) return b.response;
    const { appeal_id: appealId, decision, reason } = b.body;
    if (typeof appealId !== 'string' || !UUID_RE.test(appealId)) return NextResponse.json({ error: 'appeal_id_invalid' }, { status: 400 });
    if (!DECISIONS.has(decision)) return NextResponse.json({ error: 'decision_invalid' }, { status: 400 });
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) return NextResponse.json({ error: 'reason_invalid' }, { status: 400 });

    let result;
    try {
        result = await rpc('decide_content_appeal', {
            p_auth_id: g.authId, p_appeal_id: appealId, p_decision: decision, p_reason: reason.trim(), p_idempotency_key: k.key,
        }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'decision_rejected', ['appeal_not_found']);
    const body = {
        appeal_id: result.appeal_id, status: result.status, action_id: result.action_id,
        standing_takedowns: result.standing_takedowns, hold_until: result.hold_until || null, unfrozen: result.unfrozen === true,
    };
    if (result.replayed === true) {
        return NextResponse.json({ ...body, email: 'skipped', replayed: true }, { status: 200, headers: NO_STORE });
    }
    console.error(`[${WHERE}] decided`, decision, 'for appeal', appealId, 'user', result.user_id, 'standing', result.standing_takedowns, 'unfrozen', result.unfrozen);
    const email = await notifyAppealDecision({
        cfg: g.cfg, userId: result.user_id, actionId: result.action_id, decision, appealedAction: result.appealed_action,
        unfrozen: result.unfrozen === true, holdUntil: result.hold_until || null,
    });
    return NextResponse.json({ ...body, email, replayed: false }, { status: 201, headers: NO_STORE });
}
