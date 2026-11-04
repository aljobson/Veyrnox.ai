import { AI_ENVIRONMENTS } from './environments.js';
import { WALLET_PROJECT_REFS } from './environmentIsolation.js';

export const PRODUCTION_FLAG = '--i-mean-production';

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
    const targets = [];
    if (supabaseUrl !== undefined) targets.push(targetOfSupabaseUrl(supabaseUrl));
    if (databaseUrl !== undefined) targets.push(targetOfDatabaseUrl(databaseUrl));
    const target = ['unknown', 'production', 'staging', 'local'].find((t) => targets.includes(t)) || 'unknown';
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

function isApprovedMigrationJob(env) {
    return env.GITHUB_ACTIONS === 'true'
        && env.GITHUB_WORKFLOW === 'apply-migrations'
        && env.GITHUB_REF === 'refs/heads/main'
        && env.GITHUB_JOB === 'apply';
}

function targetOfSupabaseUrl(url) {
    const ref = refOf(url);
    return targetOfRef(ref);
}

// Query parameters node-postgres lets override the host, user or database. Any of them makes the
// destination ambiguous, so they are refused rather than interpreted.
const HARMLESS_PARAMS = new Set(['sslmode', 'application_name', 'connect_timeout']);

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

function targetOfRef(ref) {
    if (!ref || WALLET_PROJECT_REFS.includes(ref)) return 'unknown';
    if (ref === productionRef) return 'production';
    if (ref === stagingRef) return 'staging';
    return 'unknown';
}

function refOf(url) {
    try {
        const ref = new URL(String(url)).hostname.toLowerCase().split('.')[0];
        return REF.test(ref) ? ref : '';
    } catch {
        return '';
    }
}

function hostOnly(connection) {
    try {
        return new URL(connection).hostname || 'local socket';
    } catch {
        return 'unparseable connection string';
    }
}
