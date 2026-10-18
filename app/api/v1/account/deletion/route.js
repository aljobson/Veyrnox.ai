/**
 * POST /api/v1/account/deletion — step one of deleting the caller's own
 * account (ADR-0111): what would be lost, what stops it, and a confirmation
 * token for DELETE /api/v1/account.
 *
 * Response (200):
 *   { eligible: true,  forfeit: { credits, free_credits }, confirmation_token, expires_at }
 *   { eligible: false, forfeit: {...}, blockers: ['account_frozen' | ...] }
 * The token is single use, expires in 15 minutes and is bound to this
 * account. Nothing is changed by this call except the token it records.
 *
 * Errors: 401 not_authenticated, 404 not_found (flag off), 404 account_not_found,
 * 429 rate_limited, 502 deletion_unavailable, 503 gateway_not_configured.
 * Identity is the middleware-verified header only.
 */
import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { accountDeletionEnabled } from '../../../../../lib/accountDeletion.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!accountDeletionEnabled()) return json({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'gateway_not_configured' }, 503);

    let result;
    try {
        result = await rpc('prepare_account_deletion', { p_auth_id: authId }, cfg);
    } catch (err) {
        console.error('[account/deletion] prepare failed:', err && err.message);
        return json({ error: 'deletion_unavailable' }, 502);
    }
    if (result?.ok === true) {
        const { ok, ...rest } = result;
        return json(rest);
    }
    if (result?.error === 'rate_limited') {
        const retry = Number.isInteger(result.retry_after_seconds) ? Math.min(3600, Math.max(1, result.retry_after_seconds)) : 3600;
        return json({ error: 'rate_limited', retry_after_seconds: retry }, 429, { 'Retry-After': String(retry) });
    }
    if (result?.error === 'account_not_found') return json({ error: 'account_not_found' }, 404);
    console.error('[account/deletion] prepare refused:', result && result.error);
    return json({ error: 'deletion_unavailable' }, 502);
}
