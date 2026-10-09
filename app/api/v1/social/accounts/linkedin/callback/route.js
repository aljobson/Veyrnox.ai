/**
 * POST /api/v1/social/accounts/linkedin/callback — complete the OAuth
 * flow. Technical spec §2.3/§2.7, ADR-0061.
 *
 * Called by a client page (not directly by LinkedIn's redirect — that
 * lands on a browser page, which then calls here with its own Bearer
 * identity, matching this app's cookie-free posture). Body: { code, state,
 * codeVerifier } — code and state come from LinkedIn's redirect query
 * string, codeVerifier from the sessionStorage value the connect step
 * stashed there. codeVerifier is validated for contract parity with every
 * other network (see the connect route's own note) but never forwarded to
 * LinkedIn, which has no documented PKCE support.
 *
 * The state token is verified against the CALLING identity (x-veyrnox-
 * auth-id), not just its own signature — a forged or replayed state for
 * a different user is rejected even if it's validly signed for someone
 * else's session, closing the loop without cookies.
 *
 * Response (200): { ok: true, account: { id, network, display_name,
 * avatar_url, status } } or { error } for a failure — never a raw
 * upstream error.
 */

import { NextResponse } from 'next/server';
import { networkReleased } from '../../../../../../../lib/social/networks.js';
import { rpc, envConfig, SupabaseError } from '../../../../../../../packages/db/supabase-client.js';
import { linkedinConfig, exchangeCodeForToken, fetchConnectedAccount, LINKEDIN_SCOPES } from '../../../../../../../packages/adapters/social/linkedin.js';
import { verifyOAuthState } from '../../../../../../../lib/social/oauthState.js';
import { tokenCryptoConfig, encryptToken } from '../../../../../../../lib/social/tokenCrypto.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Must match the connect route's CALLBACK_PATH exactly — this is the
// redirect_uri the token exchange authenticates against.
const CALLBACK_PATH = '/social/connect/callback/linkedin';

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    if (!networkReleased('linkedin')) return NextResponse.json({ error: 'network_unavailable' }, { status: 404 });

    const cfg = envConfig();
    const liCfg = linkedinConfig();
    const stateSecret = process.env.SOCIAL_OAUTH_STATE_SECRET;
    const cryptoCfg = tokenCryptoConfig();
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !liCfg || !stateSecret || !cryptoCfg || !publicHost) {
        return NextResponse.json({ error: 'linkedin_not_configured' }, { status: 503 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const { code, state, codeVerifier } = body || {};
    if (typeof code !== 'string' || !code || code.length > 2048
        || typeof codeVerifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const stateOk = await verifyOAuthState(state, { authId, network: 'linkedin' }, stateSecret);
    if (!stateOk) {
        return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
    }

    let base;
    try {
        base = new URL(publicHost);
        if (base.protocol !== 'https:') throw new Error('not_https');
    } catch {
        return NextResponse.json({ error: 'linkedin_not_configured' }, { status: 503 });
    }
    const redirectUri = new URL(CALLBACK_PATH, base).toString();

    let account;
    try {
        const { accessToken, refreshToken, expiresAt } = await exchangeCodeForToken(liCfg, { code, redirectUri });
        const connected = await fetchConnectedAccount(accessToken);
        account = { ...connected, accessToken, refreshToken, expiresAt };
    } catch (err) {
        console.error('[api/v1/social/accounts/linkedin/callback] token exchange failed:', err && err.message);
        return NextResponse.json({ error: 'connect_failed' }, { status: 502 });
    }

    let brand;
    try {
        brand = await rpc('get_or_create_default_social_brand', { p_auth_id: authId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts/linkedin/callback] brand lookup failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!brand || brand.ok !== true) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let accessTokenEnc;
    let refreshTokenEnc = null;
    try {
        accessTokenEnc = await encryptToken(account.accessToken, cryptoCfg);
        if (account.refreshToken) refreshTokenEnc = await encryptToken(account.refreshToken, cryptoCfg);
    } catch (err) {
        console.error('[api/v1/social/accounts/linkedin/callback] token encryption failed:', err && err.message);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let recorded;
    try {
        recorded = await rpc('record_social_account_connection', {
            p_auth_id: authId,
            p_brand_id: brand.brand_id,
            p_network: 'linkedin',
            p_external_account_id: account.externalAccountId,
            p_display_name: account.displayName,
            p_avatar_url: account.avatarUrl,
            p_scopes: LINKEDIN_SCOPES,
            p_access_token_enc: accessTokenEnc,
            p_refresh_token_enc: refreshTokenEnc,
            p_token_expires_at: account.expiresAt,
        }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts/linkedin/callback] account record failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (recorded && recorded.code === 'ACCOUNT_LIMIT') {
        // Free tier: one connected account per user (ADR-0063, 0169).
        return NextResponse.json({ ok: false, code: 'ACCOUNT_LIMIT' }, { status: 409 });
    }
    if (!recorded || recorded.ok !== true) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({
        ok: true,
        account: {
            id: recorded.account_id, network: 'linkedin',
            display_name: account.displayName, avatar_url: account.avatarUrl, status: 'active',
        },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
