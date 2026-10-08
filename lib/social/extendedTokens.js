import { rpc } from '../../packages/db/supabase-client.js';
import { decryptToken, encryptToken } from './tokenCrypto.js';
import { EXTENDED_ADAPTERS } from './extendedAdapters.js';

export async function renewExtendedToken(account, accessToken, { cfg, cryptoCfg, env = process.env, now = new Date() }) {
    const adapter = EXTENDED_ADAPTERS[account.network];
    if (!adapter?.refreshAccessToken) return accessToken;
    const expires = Date.parse(account.token_expires_at);
    // Threads refresh is valid before expiry and after at least 24 hours;
    // its long-lived token gets renewed one day before expiry.
    const buffer = account.network === 'threads' ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000;
    if (Number.isFinite(expires) && expires - now.getTime() > buffer) return accessToken;
    const provider = adapter.config(env);
    if (!provider || (account.network !== 'threads' && !account.refresh_token_enc)) throw new Error('token_refresh_unavailable');
    const input = account.network === 'threads' ? accessToken : await decryptToken(account.refresh_token_enc, cryptoCfg);
    const result = await adapter.refreshAccessToken(provider, input);
    if (result.externalAccountId && result.externalAccountId !== account.external_account_id) throw new Error('token_account_mismatch');
    const rotated = await rpc('rotate_extended_social_tokens', {
        p_account_id: account.account_id, p_network: account.network,
        p_expected_access_token_enc: account.access_token_enc, p_expected_refresh_token_enc: account.refresh_token_enc || null,
        p_access_token_enc: await encryptToken(result.accessToken, cryptoCfg),
        p_refresh_token_enc: result.refreshToken ? await encryptToken(result.refreshToken, cryptoCfg) : null,
        p_token_expires_at: result.expiresAt,
    }, cfg);
    if (!rotated?.ok) throw new Error('token_rotation_lost');
    return result.accessToken;
}
