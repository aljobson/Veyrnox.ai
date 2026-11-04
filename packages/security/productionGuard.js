import { AI_ENVIRONMENTS } from './environments.js';
import { WALLET_PROJECT_REFS } from './environmentIsolation.js';
import { isLoopbackUrl } from './environmentLabel.js';

export const PRODUCTION_FLAG = '--i-mean-production';

/** @typedef {'production' | 'staging' | 'local' | 'unknown'} Target */

const REF = /^[a-z0-9]{20}$/;
const productionRef = refOf(AI_ENVIRONMENTS.production.supabaseUrl);
const stagingRef = refOf(AI_ENVIRONMENTS.staging.supabaseUrl);

/**
 * Hand-run scripts that WRITE to a database must say which one they will touch
 * and refuse production, an unknown remote or a wallet project unless the person
 * typed the flag. Pass a Supabase HTTPS URL, a Postgres connection string, or both.
 *
 * The one exemption is the protected apply job of the apply-migrations workflow on
 * main (it waits for the production-database reviewer, ADR-0023). Unrelated Actions
 * jobs are NOT exempt.
 *
 * Returns { ok, target, message }. Pure: the caller prints and exits.
 *
 * @param {{ supabaseUrl?: string, databaseUrl?: string, argv: string[], env: Record<string, string | undefined>, action: string }} input
 * @returns {{ ok: boolean, target: 'production' | 'staging' | 'local' | 'unknown', message: string }}
 */
export function checkProductionAck({ supabaseUrl, databaseUrl, argv, env, action }) {
    /** @type {Target[]} */
    const targets = [];
    if (supabaseUrl !== undefined) targets.push(targetOfSupabaseUrl(supabaseUrl));
    if (databaseUrl !== undefined) targets.push(targetOfDatabaseUrl(databaseUrl));
    /** @type {Target[]} */
    const worstFirst = ['unknown', 'production', 'staging', 'local'];
    const target = worstFirst.find((t) => targets.includes(t)) || 'unknown';
    const where = supabaseUrl || (databaseUrl ? hostOnly(databaseUrl) : 'no database target');
    const line = `${action}: target is ${target.toUpperCase()} (${where})`;
    if (target === 'staging' || target === 'local') return { ok: true, target, message: line };
    if (target === 'production' && isApprovedMigrationJob(env)) return { ok: true, target, message: line };
    if (argv.includes(PRODUCTION_FLAG)) return { ok: true, target, message: line };
    return {
        ok: false,
        target,
        message: `${line}\nRefusing: this writes to a ${target} database from a hand-run shell. `
            + `Re-run with ${PRODUCTION_FLAG} only if you mean it, and only with the owner's word (ADR-0023).`,
    };
}

/** @param {Record<string, string | undefined>} env @returns {boolean} */
function isApprovedMigrationJob(env) {
    return env.GITHUB_ACTIONS === 'true'
        && env.GITHUB_WORKFLOW === 'apply-migrations'
        && env.GITHUB_REF === 'refs/heads/main'
        && env.GITHUB_JOB === 'apply';
}

/**
 * A Supabase HTTPS URL is classified only when the WHOLE origin is exactly https://<ref>.supabase.co
 * (no other host, scheme, port, userinfo, path trickery); a loopback URL is local; the rest is unknown.
 * Checking only the first label would let https://<staging ref>.example.test pass as staging and
 * receive a service-role key.
 * @param {unknown} url
 * @returns {Target}
 */
function targetOfSupabaseUrl(url) {
    if (isLoopbackUrl(url)) return 'local';
    return targetOfRef(refOf(url));
}

// Query parameters node-postgres lets override the host, user or database. Any other than these
// makes the destination ambiguous, so it is refused rather than interpreted.
const HARMLESS_PARAMS = new Set(['sslmode', 'application_name', 'connect_timeout']);

/** @param {string} connection @returns {Target} */
function targetOfDatabaseUrl(connection) {
    let parsed;
    try {
        parsed = new URL(connection);
    } catch {
        return 'unknown';
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return 'unknown';
    for (const key of parsed.searchParams.keys()) {
        if (!HARMLESS_PARAMS.has(key)) return 'unknown';
    }
    const host = parsed.hostname.toLowerCase();
    // No host means the client falls back to PGHOST or a default socket: not knowable here.
    if (host === '') return 'unknown';
    if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return 'local';
    const user = decodeURIComponent(parsed.username);
    const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host);
    if (direct) return targetOfRef(direct[1]);
    // A pooler host is only trusted with a user of the form postgres.<ref>.
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
        const pooled = /^postgres\.([a-z0-9]{20})$/.exec(user);
        return pooled ? targetOfRef(pooled[1]) : 'unknown';
    }
    return 'unknown';
}

/** @param {string | undefined} ref @returns {Target} */
function targetOfRef(ref) {
    if (!ref || WALLET_PROJECT_REFS.includes(ref)) return 'unknown';
    if (ref === productionRef) return 'production';
    if (ref === stagingRef) return 'staging';
    return 'unknown';
}

/** @param {unknown} url @returns {string} the project ref, or '' unless the origin is exactly https://<ref>.supabase.co */
function refOf(url) {
    try {
        const parsed = new URL(String(url));
        if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return '';
        const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname.toLowerCase());
        return match ? match[1] : '';
    } catch {
        return '';
    }
}

/** @param {string} connection @returns {string} */
function hostOnly(connection) {
    try {
        return new URL(connection).hostname || 'local socket';
    } catch {
        return 'unparseable connection string';
    }
}
