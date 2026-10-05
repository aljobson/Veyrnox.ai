import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../packages/db/supabase-client.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';

// ADR-0069: how many free generations the signed-in account has left today, per model. Per-user, so it cannot ride
// the public cached /api/catalog. The number comes from free_allowance_left; nothing is computed here.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    // Off means no banner and no database work at all, so a Worker ahead of migration 0206 never calls the function.
    if (process.env.FREE_ALLOWANCE_ENABLED !== 'true') return json({ enabled: false, left: {} });
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const empty = { enabled: true, left: {} };
    const limited = await accountReadLimit(authId, cfg, empty);
    if (limited) return limited;
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
        const id = users?.[0]?.id;
        if (!id || !UUID.test(id)) return json(empty);
        const left = await rpc('free_allowance_left', { p_user_id: id }, cfg);
        return json({ enabled: true, left: left && typeof left === 'object' && !Array.isArray(left) ? left : {} });
    } catch {
        console.error('[free-allowance] read failed');
        return json({ error: 'free_allowance_unavailable' }, 502);
    }
}
