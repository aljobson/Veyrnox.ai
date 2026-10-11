import { rpc } from '../packages/db/supabase-client.js';
import { decryptToken, encryptToken } from './social/tokenCrypto.js';
import { xConfig, refreshAccessToken as refreshXToken } from '../packages/adapters/social/twitter.js';
import { tiktokConfig, refreshAccessToken as refreshTiktokToken } from '../packages/adapters/social/tiktok.js';
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

/** No expiry recorded, an unreadable one, or one inside the refresh buffer. */
export function tokenNearExpiry(target) {
    const at = Date.parse(target.token_expires_at || '');
    return !Number.isFinite(at) || at - Date.now() < TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Refresh an X or TikTok token and store the rotated pair with a compare-and-swap on the pair that
 * was read. Resolves the new access token; throws 'token_refresh_unavailable' when the app has no
 * credentials for the network, 'token_refresh_failed' otherwise.
 */
export async function rotateCoreToken(target, { cfg, cryptoCfg, env }) {
    const refreshToken = await decryptToken(target.refresh_token_enc, cryptoCfg);
    if (target.network === 'twitter') {
        const x = xConfig(env);
        if (!x) throw new Error('token_refresh_unavailable');
        const refreshed = await refreshXToken(x, refreshToken);
        const rotated = await rpc('rotate_extended_social_tokens', {
            p_account_id: target.account_id, p_network: 'twitter',
            p_expected_access_token_enc: target.access_token_enc, p_expected_refresh_token_enc: target.refresh_token_enc,
            p_access_token_enc: await encryptToken(refreshed.accessToken, cryptoCfg),
            p_refresh_token_enc: await encryptToken(refreshed.refreshToken, cryptoCfg),
            p_token_expires_at: refreshed.expiresAt,
        }, cfg);
        if (rotated?.ok !== true) throw new Error('token_refresh_failed');
        return refreshed.accessToken;
    }
    const tiktok = tiktokConfig(env);
    if (!tiktok) throw new Error('token_refresh_unavailable');
    const refreshed = await refreshTiktokToken(tiktok, refreshToken);
    if (refreshed.externalAccountId !== target.external_account_id) throw new Error('token_refresh_failed');
    const rotated = await rpc('rotate_tiktok_account_tokens', {
        p_account_id: target.account_id,
        p_expected_access_token_enc: target.access_token_enc, p_expected_refresh_token_enc: target.refresh_token_enc,
        p_access_token_enc: await encryptToken(refreshed.accessToken, cryptoCfg),
        p_refresh_token_enc: await encryptToken(refreshed.refreshToken, cryptoCfg),
        p_token_expires_at: refreshed.expiresAt, p_scopes: refreshed.scopes,
    }, cfg);
    if (rotated?.ok !== true) throw new Error('token_refresh_failed');
    return refreshed.accessToken;
}
