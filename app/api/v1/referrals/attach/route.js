import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { normalizeReferralCode, referralsEnabled } from '../../../../../lib/referrals.js';

// ADR-0071: record that this (new) account was sent by the owner of a code. One field, { code }. It never says who the referrer is,
// and an unknown code and a malformed one answer the same, so the route cannot be used to find out which codes exist.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const REFUSED = { INVALID_CODE: 400, SELF_REFERRAL: 400, NOT_NEW: 409, ALREADY_ATTACHED: 409, USER_NOT_FOUND: 409 };

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!referralsEnabled(process.env)) return json({ error: 'not_found' }, 404);
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'code')) return json({ error: 'invalid_body' }, 400);
    const code = normalizeReferralCode(body.code);
    if (!code) return json({ error: 'invalid_code' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const rate = await accountReadLimit(authId, cfg, { error: 'user_not_provisioned' });
    if (rate) return rate;
    try {
        const r = await rpc('attach_referral', { p_auth_id: authId, p_code: code }, cfg);
        if (r && r.ok === true) return json({ attached: true });
        const c = r && typeof r.code === 'string' ? r.code : '';
        return json({ error: c === 'USER_NOT_FOUND' ? 'user_not_provisioned' : c.toLowerCase() || 'request_failed' }, REFUSED[c] || 400);
    } catch {
        console.error('[referrals] attach failed');
        return json({ error: 'referrals_unavailable' }, 502);
    }
}
