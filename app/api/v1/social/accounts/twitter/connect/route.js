/**
 * POST /api/v1/social/accounts/twitter/connect — start the OAuth flow.
 * Technical spec §2.3/§2.7, ADR-0061. "twitter" is the DB's own network
 * value (packages/db/schema/supabase/0154's CHECK) — "X" only names the
 * product in comments and UI copy.
 *
 * Body: { codeChallenge } — the client generates its own PKCE verifier
 * and S256 challenge (app/lib/socialConnectClient.js), exactly like the
 * existing Instagram flow. X requires PKCE at its own authorize endpoint
 * (unlike LinkedIn), so unlike linkedin/connect this route's codeChallenge
 * really is forwarded to the provider, not just validated for contract
 * parity. The verifier itself never reaches this route.
 *
 * Response (200): { authorizeUrl } — the client navigates the browser
 * here directly (window.location.assign), same as signInWithOAuth.
 *
 * This route accepts Bearer credentials only; CSRF binding comes from signed `state`
 * (lib/social/oauthState.js) carrying the caller's own auth id, verified
 * on the way back in the callback route.
 */

import { NextResponse } from 'next/server';
import { connectCallbackPath, requestedClient } from '../../../../../../../lib/social/connectReturn.js';
import { networkReleased } from '../../../../../../../lib/social/networks.js';
import { envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { xConfig, buildAuthorizeUrl } from '../../../../../../../packages/adapters/social/twitter.js';
import { issueOAuthState } from '../../../../../../../lib/social/oauthStateStore.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    if (!networkReleased('twitter')) return NextResponse.json({ error: 'network_unavailable' }, { status: 404 });

    const cfg = envConfig();
    const xCfg = xConfig();
    const stateSecret = process.env.SOCIAL_OAUTH_STATE_SECRET;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !xCfg || !stateSecret || !publicHost) {
        return NextResponse.json({ error: 'twitter_not_configured' }, { status: 503 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const client = requestedClient(body);
    if (!client) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const codeChallenge = body && body.codeChallenge;
    if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
        return NextResponse.json({ error: 'invalid_code_challenge' }, { status: 400 });
    }

    let base;
    try {
        base = new URL(publicHost);
        if (base.protocol !== 'https:') throw new Error('not_https');
    } catch {
        return NextResponse.json({ error: 'twitter_not_configured' }, { status: 503 });
    }
    const redirectUri = new URL(connectCallbackPath('twitter', client), base).toString();

    let state;
    try {
        state = await issueOAuthState({ authId, network: 'twitter' }, stateSecret, cfg);
    } catch {
        return NextResponse.json({ error: 'oauth_state_unavailable' }, { status: 503 });
    }
    let authorizeUrl;
    try {
        authorizeUrl = buildAuthorizeUrl(xCfg, { redirectUri, state, codeChallenge });
    } catch (err) {
        console.error('[api/v1/social/accounts/twitter/connect] authorize URL build failed:', err && err.message);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({ authorizeUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
