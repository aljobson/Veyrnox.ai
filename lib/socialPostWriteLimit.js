import { NextResponse } from 'next/server';
import { rpc } from '../packages/db/supabase-client.js';

// Gate on POST /api/v1/social/posts before any RPC that would write a row.
export async function socialPostWriteLimit(authId, cfg) {
    let rate;
    try {
        rate = await rpc('consume_social_post_write_request', { p_auth_id: authId }, cfg);
    } catch {
        console.error('[social-posts] write rate limit unavailable');
    }
    const headers = { 'Cache-Control': 'no-store' };
    if (rate?.ok === false && rate.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers });
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
