import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
import { referralsEnabled } from '../../../../lib/referrals.js';

// ADR-0071: the caller's own referral code (made on first use) and how many people they have sent. Counts only, never who.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    // Off means no database work at all, so a Worker ahead of migration 0217 never calls the functions.
    if (!referralsEnabled(process.env)) return json({ enabled: false });
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const limited = await accountReadLimit(authId, cfg, { enabled: true, code: null, referred: 0 });
    if (limited) return limited;
    try {
        const made = await rpc('referral_code_for', { p_auth_id: authId }, cfg);
        if (!made || made.ok !== true) return json(made?.code === 'USER_NOT_FOUND' ? { error: 'user_not_provisioned' } : { error: 'referrals_unavailable' }, made?.code === 'USER_NOT_FOUND' ? 409 : 502);
        const summary = await rpc('referral_summary', { p_auth_id: authId }, cfg);
        return json({ enabled: true, code: made.code, referred: summary?.ok === true && Number.isInteger(summary.referred) ? summary.referred : 0 });
    } catch {
        console.error('[referrals] read failed');
        return json({ error: 'referrals_unavailable' }, 502);
    }
}
