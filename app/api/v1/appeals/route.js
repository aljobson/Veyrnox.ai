/**
 * /api/v1/appeals — a user's sanctions and their appeals (ADR-0083).
 *
 *   GET                       the caller's warnings, takedowns and content
 *                             Freezes with each one's appeal state, plus any
 *                             generation hold. Never the operator's reason.
 *   POST { action_id, statement }
 *                             appeal one of them, once. A second submit for
 *                             the same action answers with the first appeal.
 *
 * Identity is the middleware's x-veyrnox-auth-id; the RPCs resolve the
 * account from it, so a client can never name another user.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return { response: json({ error: 'not_authenticated' }, 401) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: json({ error: 'not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(req) {
    const g = gate(req);
    if (g.response) return g.response;
    const limited = await accountReadLimit(g.authId, g.cfg, { sanctions: [], hold_until: null, frozen: false });
    if (limited) return limited;
    try {
        const result = await rpc('list_my_sanctions', { p_auth_id: g.authId }, g.cfg);
        if (!result || result.ok !== true) return json({ error: 'appeals_unavailable' }, 502);
        return json({ sanctions: Array.isArray(result.sanctions) ? result.sanctions : [], hold_until: result.hold_until || null, frozen: result.frozen === true });
    } catch (err) {
        console.error('[appeals] list failed:', err && err.message);
        return json({ error: 'appeals_unavailable' }, 502);
    }
}

export async function POST(req) {
    const g = gate(req);
    if (g.response) return g.response;
    // The same per-account limit as the reads: an appeal is one row per action, never a flood.
    const limited = await accountReadLimit(g.authId, g.cfg, { error: 'rate_limited' });
    if (limited) return limited;
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'body_too_large' }, 413);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'body_invalid' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'body_invalid' }, 400);
    const { action_id: actionId, statement } = body;
    if (typeof actionId !== 'string' || !UUID_RE.test(actionId)) return json({ error: 'action_id_invalid' }, 400);
    if (typeof statement !== 'string' || statement.trim().length < 10 || statement.length > 2000) return json({ error: 'statement_invalid' }, 400);

    let result;
    try {
        result = await rpc('submit_content_appeal', { p_auth_id: g.authId, p_action_id: actionId, p_statement: statement.trim() }, g.cfg);
    } catch (err) {
        console.error('[appeals] submit failed:', err && err.message);
        return json({ error: 'appeals_unavailable' }, 502);
    }
    if (!result || result.ok !== true) {
        const code = result && result.code ? String(result.code).toLowerCase() : 'appeal_rejected';
        return json({ error: code }, code === 'action_not_found' ? 404 : 400);
    }
    return json({ appeal_id: result.appeal_id, status: result.status, submitted_at: result.submitted_at, replayed: result.replayed === true },
        result.replayed === true ? 200 : 201);
}
