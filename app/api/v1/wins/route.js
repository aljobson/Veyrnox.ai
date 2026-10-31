import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { yourWinsEnabled, winsProjection } from '../../../../lib/yourWins.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!yourWinsEnabled(process.env)) return json({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'wins_unavailable' }, 502);
    try {
        const rate = await accountReadLimit(authId, cfg, { error: 'account_unavailable' });
        if (rate) return rate.status === 200 ? json({ error: 'account_unavailable' }, 403) : rate;
        const result = await rpc('read_your_wins', { p_auth_id: authId }, cfg);
        if (result?.ok === true) return json(winsProjection(result, process.env));
        if (result?.code === 'ACCOUNT_UNAVAILABLE') return json({ error: 'account_unavailable' }, 403);
    } catch { /* Never log upstream payloads. */ }
    console.error('[wins] request failed');
    return json({ error: 'wins_unavailable' }, 502);
}
