import { AI_ENVIRONMENTS } from './environments.js';

/**
 * What an operator surface says about the environment it is running in.
 * Pure, so the admin banner and its tests share one answer.
 *
 * APP_ENV and SUPABASE_URL are inlined at build time (next.config.mjs;
 * scripts/verify-baked-environment.mjs makes a build match its target), so reading them from
 * process.env only says what the bundle was built for. PRODUCTION and STAGING are therefore
 * shown only when the request-scoped Worker bindings (`runtime`) are present AND agree with the
 * baked values AND with the canonical project. LOCAL needs an explicit loopback database.
 * Everything else, including missing bindings, is UNKNOWN and must be treated as production.
 *
 * @param {string | undefined} appEnv baked APP_ENV
 * @param {string | undefined} supabaseUrl baked SUPABASE_URL
 * @param {{ appEnv?: string, supabaseUrl?: string } | null} [runtime] the Worker's own bindings, or null where there is no Worker
 * @returns {{ kind: 'production' | 'staging' | 'local' | 'unknown', label: string, detail: string }}
 */
export function environmentLabel(appEnv, supabaseUrl, runtime = null) {
    if (appEnv === 'development' && isLoopbackUrl(supabaseUrl) && (runtime === null || (runtime.appEnv === 'development' && isLoopbackUrl(runtime.supabaseUrl)))) {
        return { kind: 'local', label: 'LOCAL', detail: 'Local development build.' };
    }
    for (const name of /** @type {const} */ (['production', 'staging'])) {
        if (appEnv !== name || !runtime) continue;
        const canonical = normalizeOrigin(AI_ENVIRONMENTS[name].supabaseUrl);
        const agrees = runtime.appEnv === name
            && normalizeOrigin(supabaseUrl) === canonical
            && normalizeOrigin(runtime.supabaseUrl) === canonical;
        if (!agrees) break;
        return name === 'production'
            ? { kind: 'production', label: 'PRODUCTION', detail: 'Live data. Changes here affect real people and real money.' }
            : { kind: 'staging', label: 'STAGING', detail: 'Test data only. Not what customers see.' };
    }
    // Missing, misspelled, disagreeing or unverifiable values must never read as "safe".
    return { kind: 'unknown', label: 'UNKNOWN ENVIRONMENT', detail: 'APP_ENV and the database do not agree, or could not be verified. Treat this as production.' };
}

/** @param {unknown} value @returns {boolean} */
export function isLoopbackUrl(value) {
    try {
        const url = new URL(String(value));
        return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

/** @param {unknown} value @returns {string} */
export function normalizeOrigin(value) {
    try {
        return new URL(String(value)).origin.toLowerCase();
    } catch {
        return '';
    }
}
