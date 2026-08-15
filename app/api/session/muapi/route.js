import { NextResponse } from 'next/server';

// __Host- prefix pins the cookie to the exact origin, no subdomain leaks,
// and requires Secure + Path=/ + no Domain. Do not weaken these.
const COOKIE_NAME = '__Host-muapi_key';
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
    // 'same-origin' for fetch from our own pages; 'none' for user-typed URL
    // (which shouldn't be POSTing JSON anyway).
    return site === 'same-origin';
}

// Report whether a key is already stored for this session (never returns the key).
export async function GET(request) {
    const has = Boolean(
        request.cookies.get(COOKIE_NAME)?.value ||
        request.cookies.get(LEGACY_COOKIE_NAME)?.value
    );
    return NextResponse.json({ hasKey: has });
}

// Save the MuAPI key server-side as an HttpOnly cookie.
export async function POST(request) {
    if (!requireSameOrigin(request)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!key) {
        return NextResponse.json({ error: 'Missing key' }, { status: 400 });
    }
    if (!MUAPI_KEY_REGEX.test(key)) {
        return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, key, cookieOptions());
    // Best-effort scrub of any legacy insecure cookie left over from before
    // the __Host- prefix rollout.
    res.cookies.set(LEGACY_COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    return res;
}

// Clear the cookie.
export async function DELETE(request) {
    if (!requireSameOrigin(request)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    res.cookies.set(LEGACY_COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    return res;
}
