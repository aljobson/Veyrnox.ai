import { AI_ENVIRONMENTS } from './environments.js';
import { normalizeOrigin } from './environmentLabel.js';

// Supabase projects of the separate wallet product live in the same
// organisation. They must never appear in this repo's configuration.
export const WALLET_PROJECT_REFS = Object.freeze(['jwstkrtslotnjyerzzsi', 'nszlbcmcysftwyudthjz']);

// Vars that must differ between production and staging, so one environment
// can never read or write the other's data or accept its sessions.
// Hostnames packages/security/config.js treats as production.
export const PRODUCTION_HOSTNAMES = Object.freeze(['veyrnox.ai', 'www.veyrnox.ai', 'app.veyrnox.ai']);

function hostnameOf(value) {
    try {
        return new URL(String(value)).hostname.toLowerCase();
    } catch {
        return '';
    }
}

const MUST_DIFFER = Object.freeze([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'ACCESS_AUD',
]);

/**
 * Check a parsed wrangler.jsonc for production/staging separation.
 * Secrets (service-role key, R2 keys, Stripe keys) are not in this file; the
 * live check of those is a separate, owner-run step (docs/infra).
 *
 * @param {{ vars?: Record<string, string>, env?: { staging?: { vars?: Record<string, string> } } }} config
 * @param {string} rawText the unparsed file, scanned for wallet project refs
 * @returns {string[]} problems; empty means isolated
 */
export function findIsolationProblems(config, rawText) {
    const problems = [];
    const prod = (config && config.vars) || {};
    const staging = (config && config.env && config.env.staging && config.env.staging.vars) || {};

    if (prod.APP_ENV !== 'production') problems.push(`vars.APP_ENV must be "production" (got ${JSON.stringify(prod.APP_ENV)})`);
    if (staging.APP_ENV !== 'staging') problems.push(`env.staging.vars.APP_ENV must be "staging" (got ${JSON.stringify(staging.APP_ENV)})`);

    // Production's PUBLIC_HOST is set outside this file (deploy variable), so host isolation can only be
    // checked against the known production hostnames (packages/security/config.js), not against a value here.
    if (!staging.PUBLIC_HOST) problems.push('env.staging.vars.PUBLIC_HOST is missing (vars are not inherited)');
    else {
        const stagingHost = hostnameOf(staging.PUBLIC_HOST);
        if (!stagingHost) problems.push('env.staging.vars.PUBLIC_HOST is not a URL');
        else if (PRODUCTION_HOSTNAMES.includes(stagingHost)) problems.push(`staging PUBLIC_HOST ${stagingHost} is a production hostname`);
        else if (prod.PUBLIC_HOST && normalizeOrigin(prod.PUBLIC_HOST) === normalizeOrigin(staging.PUBLIC_HOST)) problems.push('PUBLIC_HOST is identical in production and staging');
    }

    for (const key of MUST_DIFFER) {
        if (!prod[key]) problems.push(`vars.${key} is missing`);
        else if (!staging[key]) problems.push(`env.staging.vars.${key} is missing (vars are not inherited)`);
        else if (prod[key] === staging[key]) problems.push(`${key} is identical in production and staging`);
    }

    // The public (browser) URL must name the same project as the server URL and the canonical identity.
    for (const [name, vars, canonical] of [['production', prod, AI_ENVIRONMENTS.production.supabaseUrl], ['staging', staging, AI_ENVIRONMENTS.staging.supabaseUrl]]) {
        if (normalizeOrigin(vars.NEXT_PUBLIC_SUPABASE_URL) !== normalizeOrigin(canonical)) problems.push(`${name} NEXT_PUBLIC_SUPABASE_URL does not match its canonical project in packages/security/environments.js`);
        if (normalizeOrigin(vars.SUPABASE_URL) !== normalizeOrigin(canonical)) problems.push(`${name} SUPABASE_URL does not match its canonical project in packages/security/environments.js`);
    }
    if (prod.SUPABASE_URL !== AI_ENVIRONMENTS.production.supabaseUrl) problems.push('production SUPABASE_URL does not match packages/security/environments.js');
    if (staging.SUPABASE_URL !== AI_ENVIRONMENTS.staging.supabaseUrl) problems.push('staging SUPABASE_URL does not match packages/security/environments.js');
    if (prod.NEXT_PUBLIC_SUPABASE_ANON_KEY !== AI_ENVIRONMENTS.production.publishableKey) problems.push('production publishable key does not match packages/security/environments.js');
    if (staging.NEXT_PUBLIC_SUPABASE_ANON_KEY !== AI_ENVIRONMENTS.staging.publishableKey) problems.push('staging publishable key does not match packages/security/environments.js');

    for (const ref of WALLET_PROJECT_REFS) {
        if (rawText.includes(ref)) problems.push(`wallet project ref ${ref} appears in wrangler.jsonc`);
    }
    return problems;
}
