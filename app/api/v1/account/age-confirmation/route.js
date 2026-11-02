import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../../packages/db/supabase-client.js';
import { ageConfirmationEnabled, AGE_VERSION_RE } from '../../../../../lib/minimumAge.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
    if (!ageConfirmationEnabled()) return json({ error: 'not_found' }, 404);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'body_invalid' }, 400); }
    if (!body || body.confirm !== true || typeof body.version !== 'string' || !AGE_VERSION_RE.test(body.version)) {
        return json({ error: 'confirmation_invalid' }, 400);
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'gateway_not_configured' }, 503);
    try {
        const rows = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}&deleted_at=is.null`, limit: 1 }, cfg);
        if (!rows?.[0]?.id) return json({ error: 'account_not_found' }, 404);
        const result = await rpc('confirm_minimum_age', { p_user_id: rows[0].id, p_version: body.version }, cfg);
        if (result?.ok !== true) return json({ error: 'confirmation_unavailable' }, 502);
        return json({ age_confirmed: true, confirmed_at: result.confirmed_at, version: result.version });
    } catch {
        return json({ error: 'confirmation_unavailable' }, 502);
    }
}
