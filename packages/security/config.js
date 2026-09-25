import { AI_ENVIRONMENTS } from './environments.js';
import { ApiError } from './errors.js';
const ENVIRONMENTS = new Set(['development', 'staging', 'production']);
// Public production identifiers, used only to prevent accidental non-production access.
const PRODUCTION_SUPABASE = AI_ENVIRONMENTS.production.supabaseUrl;
/** @param {string | undefined} value @param {boolean} local */
function origin(value, local) {
    if (!value) throw new Error('missing origin');
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:'))) throw new Error('invalid origin');
    return url.origin;
}

/** Validate public identity configuration without ever returning service credentials.
 * @param {Record<string, string | undefined>} env
 */
export function readConfig(env) {
    try {
        const appEnv = env.APP_ENV;
        if (!appEnv || !ENVIRONMENTS.has(appEnv)) throw new Error('invalid environment');
        const local = appEnv === 'development';
        const supabaseUrl = origin(env.SUPABASE_URL, local);
        if (origin(env.NEXT_PUBLIC_SUPABASE_URL, local) !== supabaseUrl) throw new Error('issuer mismatch');
        const publishableKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!publishableKey || publishableKey.startsWith('sb_secret_')) throw new Error('invalid publishable key');
        if (!publishableKey.startsWith('sb_publishable_')) {
            const payload = JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload.role !== 'anon') throw new Error('invalid legacy public key');
        }
        if (!local) {
            const expected = AI_ENVIRONMENTS[appEnv === 'production' ? 'production' : 'staging'];
            if (supabaseUrl !== expected.supabaseUrl || publishableKey !== expected.publishableKey) throw new Error('wrong project');
        } else if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(supabaseUrl).hostname)) {
            throw new Error('development requires local identity');
        }
        const publicOrigin = origin(env.PUBLIC_HOST, local);
        if (appEnv !== 'production' && (supabaseUrl === PRODUCTION_SUPABASE ||
            ['veyrnox.ai', 'www.veyrnox.ai', 'app.veyrnox.ai'].includes(new URL(publicOrigin).hostname))) throw new Error('production resource in non-production');
        return Object.freeze({ appEnv, supabaseUrl, publishableKey, publicOrigin });
    } catch {
        throw new ApiError(503, 'CONFIGURATION_UNAVAILABLE', 'The service is not configured.');
    }
}

/** Public build settings. Default builds target local development, never a remote database.
 * @param {Record<string, string | undefined>} env
 */
export function buildConfig(env) {
    const appEnv = env.APP_ENV || 'development';
    if (appEnv === 'production' || appEnv === 'staging') {
        const identity = AI_ENVIRONMENTS[appEnv];
        return readConfig({ APP_ENV: appEnv, SUPABASE_URL: identity.supabaseUrl,
            NEXT_PUBLIC_SUPABASE_URL: identity.supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: identity.publishableKey,
            PUBLIC_HOST: env.PUBLIC_HOST || (appEnv === 'production' ? 'https://veyrnox.ai' : undefined) });
    }
    return readConfig({ ...env, APP_ENV: appEnv, SUPABASE_URL: env.SUPABASE_URL || 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_local_development_unconfigured',
        PUBLIC_HOST: env.PUBLIC_HOST || 'http://localhost:3000' });
}
