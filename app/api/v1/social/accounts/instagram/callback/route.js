/**
 * POST /api/v1/social/accounts/instagram/callback — complete the OAuth
 * flow. Technical spec §2.3/§2.7, ADR-0061.
 *
 * Called by a client page (not directly by Meta's redirect — that lands
 * on a browser page, which then calls here with its own Bearer identity,
 * matching this app's cookie-free posture). Body: { code, state,
 * codeVerifier } — code and state come from Meta's redirect query
 * string. codeVerifier is validated for contract parity with every other
 * network (see the connect route's own note) but never forwarded to
 * Instagram Login, which has no documented PKCE support.
 *
 * The state token is verified against the CALLING identity (x-veyrnox-
 * auth-id), not just its own signature — a forged or replayed state for
 * a different user is rejected even if it's validly signed for someone
 * else's session, closing the loop without cookies.
 *
 * Response (200): { ok: true, account: { id, network, display_name,
 * avatar_url, status } } or { error } for a failure — never a raw
 * upstream error. Instagram Login authorizes a Business/Creator account
 * directly, with no linked-Facebook-Page chain to walk, so there is no
 * longer a distinct "no linked account" conflict to special-case here — a
 * personal account simply cannot complete this flow at all.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig, SupabaseError } from '../../../../../../../packages/db/supabase-client.js';
import { instagramConfig, exchangeCodeForToken, fetchConnectedAccount, INSTAGRAM_SCOPES } from '../../../../../../../packages/adapters/social/instagram.js';
import { verifyOAuthState } from '../../../../../../../lib/social/oauthState.js';
import { tokenCryptoConfig, encryptToken } from '../../../../../../../lib/social/tokenCrypto.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Must match the connect route's CALLBACK_PATH exactly — this is the
// redirect_uri the token exchange authenticates against.
const CALLBACK_PATH = '/social/connect/callback/instagram';

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    const igCfg = instagramConfig();
    const stateSecret = process.env.SOCIAL_OAUTH_STATE_SECRET;
    const cryptoCfg = tokenCryptoConfig();
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !igCfg || !stateSecret || !cryptoCfg || !publicHost) {
        return NextResponse.json({ error: 'instagram_not_configured' }, { status: 503 });
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
    const stateOk = await verifyOAuthState(state, { authId, network: 'instagram' }, stateSecret);
    if (!stateOk) {
        return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
    }

    let base;
    try {
        base = new URL(publicHost);
        if (base.protocol !== 'https:') throw new Error('not_https');
    } catch {
        return NextResponse.json({ error: 'instagram_not_configured' }, { status: 503 });
    }
    const redirectUri = new URL(CALLBACK_PATH, base).toString();

    let account;
    try {
        const { accessToken, expiresAt } = await exchangeCodeForToken(igCfg, { code, redirectUri });
        const connected = await fetchConnectedAccount(accessToken);
        account = { ...connected, accessToken, expiresAt };
    } catch (err) {
        console.error('[api/v1/social/accounts/instagram/callback] token exchange failed:', err && err.message);
        return NextResponse.json({ error: 'connect_failed' }, { status: 502 });
    }

    let brand;
    try {
        brand = await rpc('get_or_create_default_social_brand', { p_auth_id: authId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts/instagram/callback] brand lookup failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!brand || brand.ok !== true) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let accessTokenEnc;
    try {
        accessTokenEnc = await encryptToken(account.accessToken, cryptoCfg);
    } catch (err) {
        console.error('[api/v1/social/accounts/instagram/callback] token encryption failed:', err && err.message);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let recorded;
    try {
        recorded = await rpc('record_social_account_connection', {
            p_auth_id: authId,
            p_brand_id: brand.brand_id,
            p_network: 'instagram',
            p_external_account_id: account.externalAccountId,
            p_display_name: account.displayName,
            p_avatar_url: account.avatarUrl,
            p_scopes: INSTAGRAM_SCOPES,
            p_access_token_enc: accessTokenEnc,
            p_refresh_token_enc: null, // Meta long-lived tokens have no refresh token; re-auth before expiry instead
            p_token_expires_at: account.expiresAt,
        }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts/instagram/callback] account record failed:', status, err && err.body);
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
            id: recorded.account_id, network: 'instagram',
            display_name: account.displayName, avatar_url: account.avatarUrl, status: 'active',
        },
    }, { headers: { 'Cache-Control': 'no-store' } });
}
