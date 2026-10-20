import { rpc } from '../packages/db/supabase-client.js';

import { isAccountLocale } from './i18n/accountLocale.mjs';
export { isAccountLocale } from './i18n/accountLocale.mjs';

const LOOKUP_TIMEOUT_MS = 1500;

/** Optional display preference: old databases and unavailable reads preserve English. */
export async function readAccountLanguage(authId, cfg, rpcCall = rpc) {
    if (!authId) return null;
    try {
        const result = await rpcCall('get_user_language', { p_auth_id: authId }, { ...cfg, timeoutMs: LOOKUP_TIMEOUT_MS });
        return result?.ok === true && isAccountLocale(result.locale) ? result.locale : null;
    } catch { return null; }
}

