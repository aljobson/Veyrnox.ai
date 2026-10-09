import { NextResponse } from 'next/server';
import { envConfig, rpc } from '../../packages/db/supabase-client.js';
import { accountReadLimit } from '../accountReadLimit.js';
import { createOAuthState, verifyOAuthState } from './oauthState.js';
import { tokenCryptoConfig, encryptToken, decryptToken } from './tokenCrypto.js';
import { EXTENDED_ADAPTERS } from './extendedAdapters.js';
import { extendedNetworksEnabled } from './networks.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PKCE = /^[A-Za-z0-9_-]{43,128}$/;
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function context(req, network) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return { error: reply({ error: 'not_authenticated' }, 401) };
    const adapter = EXTENDED_ADAPTERS[network];
    if (!extendedNetworksEnabled() || !adapter) return { error: reply({ error: 'network_unavailable' }, 404) };
    const cfg = envConfig(), provider = adapter.config(), cryptoCfg = tokenCryptoConfig();
    const secret = process.env.SOCIAL_OAUTH_STATE_SECRET;
    let redirectUri;
    try {
        const base = new URL(process.env.PUBLIC_HOST);
        if (base.protocol !== 'https:' || base.username || base.password) throw new Error();
        redirectUri = new URL(`/social/connect/callback/${network}`, base).toString();
    } catch { /* Missing/invalid PUBLIC_HOST is a deployment error. */ }
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !provider || !cryptoCfg || !secret || !redirectUri)
        return { error: reply({ error: `${network}_not_configured` }, 503) };
    return { authId, adapter, cfg, provider, cryptoCfg, secret, redirectUri };
}

export async function startExtendedConnect(req, network) {
    const ctx = context(req, network);
    if (ctx.error) return ctx.error;
    const body = await req.json().catch(() => null);
    if (!PKCE.test(body?.codeChallenge || '') || network === 'bluesky') return reply({ error: 'invalid_body' }, 400);
    const limited = await accountReadLimit(ctx.authId, ctx.cfg, { error: 'not_authenticated' });
    if (limited) return limited;
    const state = await createOAuthState({ authId: ctx.authId, network }, ctx.secret);
    const authorizeUrl = ctx.adapter.buildAuthorizeUrl(ctx.provider, { redirectUri: ctx.redirectUri, state });
    const url = new URL(authorizeUrl);
    if (network === 'gmb') {
        url.searchParams.set('code_challenge', body.codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
    }
    return reply({ authorizeUrl: url.toString() });
}

async function record(ctx, network, account) {
    const brand = await rpc('get_or_create_default_social_brand', { p_auth_id: ctx.authId }, ctx.cfg);
    if (!brand?.ok) throw new Error('brand_lookup_failed');
    const result = await rpc('record_social_account_connection', { p_auth_id: ctx.authId, p_brand_id: brand.brand_id,
        p_network: network, p_external_account_id: account.externalAccountId, p_display_name: account.displayName || null,
        p_avatar_url: account.avatarUrl || null, p_scopes: ctx.adapter.SCOPES,
        p_access_token_enc: await encryptToken(account.accessToken, ctx.cryptoCfg),
        p_refresh_token_enc: account.refreshToken ? await encryptToken(account.refreshToken, ctx.cryptoCfg) : null,
        p_token_expires_at: account.expiresAt || null }, ctx.cfg);
    if (result?.code === 'ACCOUNT_LIMIT') return reply({ ok: false, code: 'ACCOUNT_LIMIT' }, 409);
    if (!result?.ok) throw new Error('account_record_failed');
    return reply({ ok: true, account: { id: result.account_id, network, display_name: account.displayName, avatar_url: account.avatarUrl, status: 'active' } });
}

export async function finishExtendedConnect(req, network) {
    const ctx = context(req, network);
    if (ctx.error) return ctx.error;
    const body = await req.json().catch(() => null);
    const limited = await accountReadLimit(ctx.authId, ctx.cfg, { error: 'not_authenticated' });
    if (limited) return limited;
    let stage = 'validate';
    try {
        if (body?.selectionId) {
            if (!UUID.test(body.selectionId) || typeof body.resourceId !== 'string' || body.resourceId.length > 128) return reply({ error: 'invalid_body' }, 400);
            // Consume once, bound to this user and network. The payload never
            // crosses the API boundary, even as ciphertext.
            const pending = await rpc('consume_social_connection_selection', { p_auth_id: ctx.authId, p_network: network, p_id: body.selectionId }, ctx.cfg);
            if (!pending?.payload_enc) return reply({ error: 'selection_expired' }, 409);
            const accounts = JSON.parse(await decryptToken(pending.payload_enc, ctx.cryptoCfg));
            const chosen = accounts.find((a) => a.externalAccountId === body.resourceId);
            if (!chosen) return reply({ error: 'invalid_selection' }, 400);
            return await record(ctx, network, chosen);
        }
        if (network === 'bluesky') {
            if (typeof body?.identifier !== 'string' || body.identifier.length > 253 || !/^[A-Za-z0-9.-]+$/.test(body.identifier)
                || !/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(body?.appPassword || '')) return reply({ error: 'invalid_body' }, 400);
            stage = 'provider_session';
            const account = await ctx.adapter.connect(body);
            stage = 'record_account';
            return await record(ctx, network, account);
        }
        if (typeof body?.code !== 'string' || !body.code || body.code.length > 2048 || !PKCE.test(body.codeVerifier || '')) return reply({ error: 'invalid_body' }, 400);
        if (!await verifyOAuthState(body.state, { authId: ctx.authId, network }, ctx.secret)) return reply({ error: 'invalid_state' }, 400);
        const tokens = await ctx.adapter.exchangeCodeForToken(ctx.provider, { code: body.code, redirectUri: ctx.redirectUri, codeVerifier: body.codeVerifier });
        const candidates = await ctx.adapter.fetchCandidates(tokens.accessToken);
        if (!Array.isArray(candidates) || !candidates.length) return reply({ ok: false, code: 'NO_ELIGIBLE_RESOURCE' }, 409);
        if (candidates.length > 200) return reply({ error: 'too_many_resources' }, 409);
        const accounts = candidates.map((a) => ({ ...tokens, ...a }));
        if (!['facebook', 'pinterest', 'gmb'].includes(network)) return await record(ctx, network, accounts[0]);
        const pending = await rpc('prepare_social_connection_selection', { p_auth_id: ctx.authId, p_network: network,
            p_payload_enc: await encryptToken(JSON.stringify(accounts), ctx.cryptoCfg) }, ctx.cfg);
        if (!pending?.id) throw new Error('selection_store_failed');
        return reply({ ok: false, selectionId: pending.id, choices: accounts.map((a) => ({ id: a.externalAccountId, label: a.displayName || a.externalAccountId })) });
    } catch (err) {
        // Only our adapter's fixed error labels may reach logs or the browser.
        // Database/provider exception messages can contain credentials or payloads.
        const safeCode = /^(provider_request_failed_[0-9]{3}|invalid_session|unsupported_bluesky_host|brand_lookup_failed|account_record_failed)$/.test(err?.message || '')
            ? err.message : 'unexpected_failure';
        console.error('[social-connect] failed', network, stage, safeCode);
        return reply({ error: 'connect_failed', ...(network === 'bluesky' ? { stage, code: safeCode } : {}) }, 502);
    }
}
