import { NextResponse } from 'next/server';
import { select, envConfig } from '../../../../../packages/db/supabase-client.js';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { usageWindows, USAGE_WINDOWS } from '../../../../../lib/usageWindows.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 1000;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const empty = { spent: { day: 0, week: 0, month: 0 }, truncated: false };
    const limited = await accountReadLimit(authId, cfg, empty);
    if (limited) return limited;
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
        const id = users?.[0]?.id;
        if (!id || !UUID.test(id)) return json(empty);
        const now = Date.now();
        const since = new Date(now - USAGE_WINDOWS.month * 86_400_000).toISOString();
        const rows = await select('ledger_entries', {
            columns: 'delta,reason,created_at',
            filter: `user_id=eq.${id}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`, limit: MAX_ROWS + 1,
        }, cfg);
        // More rows than the cap means the month figure is a floor, and the page says so.
        return json({ spent: usageWindows(rows.slice(0, MAX_ROWS), now), truncated: rows.length > MAX_ROWS });
    } catch {
        console.error('[ledger/usage] read failed');
        return json({ error: 'usage_unavailable' }, 502);
    }
}
