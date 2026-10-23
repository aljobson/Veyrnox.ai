import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { checkinEnabled } from '../../../../lib/checkin.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
import { limitRequestBody } from '../../../../lib/requestBodyLimit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(req, claim) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!checkinEnabled(process.env)) return json({ error: 'not_found' }, 404);
    if (claim) {
        const limited = await limitRequestBody(req);
        if (limited.response) return limited.response;
        if ((await limited.request.text()).length) return json({ error: 'invalid_body' }, 400);
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'checkin_unavailable' }, 502);
    // Same shared read/write bucket as referral attachment. A missing account is a 403 here.
    const rate = await accountReadLimit(authId, cfg, { error: 'account_unavailable' });
    if (rate) {
        if (rate.status === 200) return json({ error: 'account_unavailable' }, 403);
        return rate;
    }
    try {
        const r = await rpc(claim ? 'daily_checkin' : 'read_checkin_status', { p_auth_id: authId }, cfg);
        if (r?.ok === true) return json(r);
        if (r?.code === 'ACCOUNT_UNAVAILABLE') return json({ error: 'account_unavailable' }, 403);
        if (r?.code === 'CHECKIN_BUSY') return json({ error: 'checkin_busy' }, 409);
    } catch {
        console.error('[checkin] request failed');
    }
    return json({ error: 'checkin_unavailable' }, 502);
}
export const GET = (req) => handle(req, false);
export const POST = (req) => handle(req, true);
