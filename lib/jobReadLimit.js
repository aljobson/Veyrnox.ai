import { NextResponse } from 'next/server';

// The owner-scoped list/status RPCs share a quota after migration 0114.
// Other verdicts keep their existing route-specific handling.
export function jobReadLimitResponse(row) {
    if (row?.ok !== false || row.code !== 'RATE_LIMITED') return null;
    const retry = Number.isInteger(row.retry_after_seconds)
        ? Math.max(1, Math.min(60, row.retry_after_seconds)) : 60;
    return NextResponse.json({ error: 'rate_limited', retry_after_seconds: retry }, {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retry) },
    });
}
