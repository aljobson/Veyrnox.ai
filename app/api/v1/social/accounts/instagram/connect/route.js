/**
 * POST /api/v1/social/accounts/instagram/connect — start the OAuth flow.
 * Technical spec §2.3/§2.7, ADR-0061.
 *
 * Body: { codeChallenge } — the client generates its own PKCE verifier
 * and S256 challenge (app/lib/authClient.js's randomVerifier/s256
 * pattern, sessionStorage-held), exactly like the existing Apple/Google
 * flow. The verifier itself never reaches this route.
 *
 * Response (200): { authorizeUrl } — the client navigates the browser
 * here directly (window.location.assign), same as signInWithOAuth.
 *
 * No cookies (this app is Bearer/localStorage-only, CLAUDE.md "Identity
 * & sessions") — CSRF binding instead comes from a signed `state` token
 * (lib/social/oauthState.js) carrying the caller's own auth id, verified
 * on the way back in the callback route.
 */

import { NextResponse } from 'next/server';
import { envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { instagramConfig, buildAuthorizeUrl } from '../../../../../../../packages/adapters/social/instagram.js';
import { createOAuthState } from '../../../../../../../lib/social/oauthState.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALLBACK_PATH = '/social/connect/callback';

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    const igCfg = instagramConfig();
    const stateSecret = process.env.SOCIAL_OAUTH_STATE_SECRET;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !igCfg || !stateSecret || !publicHost) {
        return NextResponse.json({ error: 'instagram_not_configured' }, { status: 503 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const codeChallenge = body && body.codeChallenge;
    if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
        return NextResponse.json({ error: 'invalid_code_challenge' }, { status: 400 });
    }

    let base;
    try {
        base = new URL(publicHost);
        if (base.protocol !== 'https:') throw new Error('not_https');
    } catch {
        return NextResponse.json({ error: 'instagram_not_configured' }, { status: 503 });
    }
    const redirectUri = new URL(CALLBACK_PATH, base).toString();

    const state = await createOAuthState({ authId, network: 'instagram' }, stateSecret);
    let authorizeUrl;
    try {
        authorizeUrl = buildAuthorizeUrl(igCfg, { redirectUri, state, codeChallenge });
    } catch (err) {
        console.error('[api/v1/social/accounts/instagram/connect] authorize URL build failed:', err && err.message);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({ authorizeUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
