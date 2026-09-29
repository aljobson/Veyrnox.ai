/**
 * POST /api/v1/social/accounts/youtube/connect — start the OAuth flow.
 * Technical spec §2.3/§2.7, ADR-0061.
 *
 * Connect only — no publish path exists for YouTube yet (packages/
 * adapters/social/youtube.js's own header explains why: it has no API
 * for a static image post, only a resumable video upload, which needs
 * its own scheduling-engine design). A post scheduled to a connected
 * YouTube account will fail cleanly with 'network_not_implemented'
 * (lib/socialPublishSweep.js) until that lands.
 *
 * Body: { codeChallenge } — validated for contract parity with every
 * other network's connect route, even though Google's own authorize
 * endpoint has no documented PKCE requirement for a web server
 * (confidential) client and never sees this value (matches how
 * linkedin/connect and tiktok/connect handle the same case).
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
import { youtubeConfig, buildAuthorizeUrl } from '../../../../../../../packages/adapters/social/youtube.js';
import { createOAuthState } from '../../../../../../../lib/social/oauthState.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Per-network path (app/social/connect/callback/[network]/page.js), not a
// shared one: multiple providers redirecting to the same URL would leave
// the landing page with no reliable way to know which network's /callback
// route to call — a provider's redirect carries no such hint itself.
const CALLBACK_PATH = '/social/connect/callback/youtube';

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    const ytCfg = youtubeConfig();
    const stateSecret = process.env.SOCIAL_OAUTH_STATE_SECRET;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !ytCfg || !stateSecret || !publicHost) {
        return NextResponse.json({ error: 'youtube_not_configured' }, { status: 503 });
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
        return NextResponse.json({ error: 'youtube_not_configured' }, { status: 503 });
    }
    const redirectUri = new URL(CALLBACK_PATH, base).toString();

    const state = await createOAuthState({ authId, network: 'youtube' }, stateSecret);
    let authorizeUrl;
    try {
        authorizeUrl = buildAuthorizeUrl(ytCfg, { redirectUri, state });
    } catch (err) {
        console.error('[api/v1/social/accounts/youtube/connect] authorize URL build failed:', err && err.message);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({ authorizeUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
