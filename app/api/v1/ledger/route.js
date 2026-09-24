import { NextResponse } from 'next/server';
import { select, envConfig } from '../../../../packages/db/supabase-client.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
import { historyCursor, historyPage } from '../../../../lib/historyCursor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 25;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function kind(reason, delta) {
    if (reason === 'grant:signup') return 'signup_grant';
    if (reason === 'expire:free') return 'free_credit_expiry';
    if (reason.startsWith('refund:')) return 'generation_refund';
    if (reason.startsWith('debit:')) return 'generation';
    if (reason === 'grant:topup') return 'top_up';
    if (reason.startsWith('reverse:')) return 'payment_adjustment';
    return 'adjustment';
}
export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID.test(authId)) return json({ error: 'not_authenticated' }, 401);
    let cursor;
    try { cursor = historyCursor(req.url); } catch { return json({ error: 'invalid_cursor' }, 400); }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const limited = await accountReadLimit(authId, cfg, { entries: [], next: null });
    if (limited) return limited;
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
        const id = users?.[0]?.id;
        if (!id || !UUID.test(id)) return json({ entries: [], next: null });
        const rows = await select('ledger_entries', {
            columns: 'id,delta,free_delta,reason,job_id,created_at',
            filter: `user_id=eq.${id}${cursor}&order=created_at.desc,id.desc`, limit: LIMIT + 1,
        }, cfg);
        const { items, next } = historyPage(rows, LIMIT);
        // Operator notes/reasons may contain internal detail; return stable categories.
        return json({ entries: items.map(({ reason, ...row }) => ({ ...row, kind: kind(reason, row.delta) })), next });
    } catch {
        console.error('[ledger/history] read failed');
        return json({ error: 'history_unavailable' }, 502);
    }
}
