import { NextResponse } from 'next/server';

const COOKIE_NAME = 'muapi_key';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function cookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: MAX_AGE,
    };
}

// Report whether a key is already stored for this session (never returns the key).
export async function GET(request) {
    const has = Boolean(request.cookies.get(COOKIE_NAME)?.value);
    return NextResponse.json({ hasKey: has });
}

// Save the MuAPI key server-side as HttpOnly cookie.
export async function POST(request) {
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
    // Basic shape guard: reasonable length, no control chars / whitespace.
    if (key.length > 512 || /[\s\x00-\x1f]/.test(key)) {
        return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, key, cookieOptions());
    return res;
}

// Clear the cookie.
export async function DELETE() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    return res;
}
