import { NextResponse } from 'next/server';
import { rpc } from '../packages/db/supabase-client.js';

// Both Top-up read routes use this same bucket before any data lookup.
// Missing users retain their empty/404 response without further DB work.
export async function topUpReadLimit(authId, cfg, isHistory = false) {
    if (process.env.TOP_UP_READ_RATE_LIMIT_ENABLED !== 'true') return null;
    let rate;
    try {
        rate = await rpc('consume_top_up_read_request', { p_auth_id: authId }, cfg);
    } catch {
        console.error('[top-ups] read rate limit unavailable');
    }
    const headers = { 'Cache-Control': 'no-store' };
    if (rate?.ok === false && rate.code === 'NOT_FOUND') {
        return NextResponse.json(isHistory ? { top_ups: [] } : { error: 'not_found' },
            { status: isHistory ? 200 : 404, headers });
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
