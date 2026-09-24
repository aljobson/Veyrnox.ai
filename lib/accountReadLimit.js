import { NextResponse } from 'next/server';
import { rpc } from '../packages/db/supabase-client.js';

// Both account read routes use this same bucket before any data lookup.
// Missing users retain their zero-valued response without further DB work.
export async function accountReadLimit(authId, cfg, emptyBody) {
    if (process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED !== 'true') return null;
    let rate;
    try {
        rate = await rpc('consume_account_read_request', { p_auth_id: authId }, cfg);
    } catch {
        console.error('[account] read rate limit unavailable');
    }
    const headers = { 'Cache-Control': 'no-store' };
    if (rate?.ok === false && rate.code === 'NOT_FOUND') {
        return NextResponse.json(emptyBody, { headers });
    }
    if (rate?.ok === false && rate.code === 'RATE_LIMITED') {
        const retry = Number.isInteger(rate.retry_after_seconds)
            ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
        return NextResponse.json({ error: 'rate_limited', retry_after_seconds: retry },
            { status: 429, headers: { ...headers, 'Retry-After': String(retry) } });
    }
    if (rate?.ok !== true) {
        return NextResponse.json({ error: 'rate_limit_unavailable' },
            { status: 503, headers: { ...headers, 'Retry-After': '30' } });
    }
    return null;
}
