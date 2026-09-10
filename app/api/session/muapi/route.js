import { NextResponse } from 'next/server';
import { getApiKeyFromCookies } from '@/lib/authCookie';

// __Host- prefix pins the cookie to the exact origin, no subdomain leaks,
// and requires Secure + Path=/ + no Domain. Do not weaken these.
const COOKIE_NAME = '__Host-muapi_key';
// Kept for one release so users still carrying the old unprefixed cookie get
// it scrubbed on next login/logout. Safe to remove after 2026-12.
// ponytail: legacy scrub, drop after 2026-12 once telemetry shows no hits.
const LEGACY_COOKIE_NAME = 'muapi_key';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Conservative shape guard for a MuAPI key. Adjust if the upstream shape
// changes; keep tight enough to reject accidental pastes / prompt-injection.
// ponytail: regex-based shape guard, tighten to exact prefix if MuAPI documents one.
const MUAPI_KEY_REGEX = /^[A-Za-z0-9_-]{20,256}$/;

function cookieOptions() {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: MAX_AGE,
    };
}

// Reject requests that were not initiated from this same site. Blocks CSRF
// against this endpoint. Browsers that don't send Sec-Fetch-Site
// (very old) will fail closed here — acceptable for a settings endpoint.
function requireSameOrigin(request) {
    const site = request.headers.get('sec-fetch-site');
    return site === 'same-origin';
}

// Report whether a key is already stored for this session (never returns the key).

// ────────────────────────────────────────────────────────────────────────
// DEPRECATION BANNER (added Slice 3b, 2026-09-10)
//
// This bring-your-own-MuAPI-key session route is superseded by the
// Supabase auth + gateway ledger. It runs in a 30-day dual-run window;
// sunset date is 2026-10-10. After the sunset, this route returns 410
// Gone. Existing cookie holders should complete a Supabase signup
// before then.
//
// Every response from this route now carries `Deprecation: true` and
// `Sunset: Fri, 10 Oct 2026 00:00:00 GMT` (RFC 8594) so clients can
// surface a migration prompt without polling.
// ────────────────────────────────────────────────────────────────────────

const DEPRECATION_HEADERS = {
    Deprecation: 'true',
    Sunset: 'Fri, 10 Oct 2026 00:00:00 GMT',
    Link: '</api/webhook/supabase>; rel="successor-version"',
};

function withDeprecation(response) {
    for (const [k, v] of Object.entries(DEPRECATION_HEADERS)) response.headers.set(k, v);
    return response;
}

export async function GET(request) {
    const has = Boolean(getApiKeyFromCookies(request));
    return withDeprecation(NextResponse.json({ hasKey: has }));
}

// Save the MuAPI key server-side as an HttpOnly cookie.
export async function POST(request) {
    if (!requireSameOrigin(request)) {
        return withDeprecation(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return withDeprecation(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
    }
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!key) {
        return withDeprecation(NextResponse.json({ error: 'Missing key' }, { status: 400 }));
    }
    if (!MUAPI_KEY_REGEX.test(key)) {
        return withDeprecation(NextResponse.json({ error: 'Invalid key format' }, { status: 400 }));
    }
    const res = NextResponse.json({ ok: true });
    withDeprecation(res);
    res.cookies.set(COOKIE_NAME, key, cookieOptions());
    // Best-effort scrub of any legacy insecure cookie left over from before
    // the __Host- prefix rollout.
    res.cookies.set(LEGACY_COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    return res;
}

// Clear the cookie.
export async function DELETE(request) {
    if (!requireSameOrigin(request)) {
        return withDeprecation(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }
    const res = NextResponse.json({ ok: true });
    withDeprecation(res);
    res.cookies.set(COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    res.cookies.set(LEGACY_COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    return res;
}
