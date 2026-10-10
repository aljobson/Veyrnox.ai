/**
 * /api/v1/admin/users/ledger — one account's ledger and a reasoned grant
 * (ADR-0083).
 *
 *   GET  ?user_id=<uuid>&limit=<n>   balance buckets, the newest ledger rows
 *                                    (reasons included: this is the operator
 *                                    view) and the account_actions log
 *   POST { user_id, credits, reason } append a Pack grant through
 *                                    admin_credit_grant with the admin's email
 *                                    as actor and the note on the action row.
 *                                    Requires an Idempotency-Key header: a
 *                                    replay answers 200 with the first result
 *                                    and `replayed: true`, never a second grant.
 *
 * Same four gates as /api/v1/admin/metrics (lib/adminGate.js); the RPC
 * re-checks users.is_admin itself.
 */

import { NextResponse } from 'next/server';
import { rpc } from '../../../../../../packages/db/supabase-client.js';
import { adminGate, rpcFailure, rpcRefusal, readJsonObject, idempotencyKey, UUID_RE, NO_STORE } from '../../../../../../lib/adminGate.js';

const WHERE = 'api/v1/admin/users/ledger';
const MAX_GRANT = 100000;

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const url = new URL(req.url);
    const userId = url.searchParams.get('user_id');
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) return NextResponse.json({ error: 'user_id_invalid' }, { status: 400 });
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? 100 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return NextResponse.json({ error: 'limit_invalid' }, { status: 400 });

    let result;
    try {
        result = await rpc('admin_user_ledger', { p_auth_id: g.authId, p_user_id: userId, p_limit: limit }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'ledger_unavailable');
    return NextResponse.json({
        balance: result.balance || null,
        entries: Array.isArray(result.entries) ? result.entries : [],
        actions: Array.isArray(result.actions) ? result.actions : [],
    }, { headers: NO_STORE });
}

export async function POST(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const k = idempotencyKey(req);
    if (k.response) return k.response;
    const b = await readJsonObject(req);
    if (b.response) return b.response;
    const { user_id: userId, credits, reason } = b.body;
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) return NextResponse.json({ error: 'user_id_invalid' }, { status: 400 });
    if (!Number.isInteger(credits) || credits < 1 || credits > MAX_GRANT) return NextResponse.json({ error: 'credits_invalid' }, { status: 400 });
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 200) return NextResponse.json({ error: 'reason_invalid' }, { status: 400 });

    let result;
    try {
        result = await rpc('admin_credit_grant', {
            p_auth_id: g.authId, p_user_id: userId, p_credits: credits, p_reason: reason.trim(), p_idempotency_key: k.key,
        }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'grant_rejected');
    const replayed = result.replayed === true;
    if (!replayed) console.error(`[${WHERE}] granted`, credits, 'credits to', userId, 'action', result.action_id);
    return NextResponse.json({
        action_id: result.action_id, entry_id: result.entry_id, credits_delta: result.credits_delta,
        balance_after: result.balance_after, replayed,
    }, { status: replayed ? 200 : 201, headers: NO_STORE });
}
