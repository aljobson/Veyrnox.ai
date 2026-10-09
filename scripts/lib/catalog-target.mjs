// Which Supabase project a catalog read is pointed at. The weekly fal watch
// takes SUPABASE_URL from a repository secret, which nobody can read back:
// on 2026-10-09 its rows were the staging catalog's, line for line. No
// network here (tests/falCatalogTarget.test.mjs).

import { parseJsonc } from '../check-migration-ledger.mjs';

/** Production's SUPABASE_URL: the top-level `vars` of wrangler.jsonc. `env.staging` has its own. */
export function productionUrl(wranglerText) {
    const url = parseJsonc(wranglerText).vars?.SUPABASE_URL;
    if (typeof url !== 'string' || !url) throw new Error('wrangler.jsonc has no top-level vars.SUPABASE_URL');
    return url;
}

// A URL with a user or password in it is nobody's project URL, and a failed
// fetch would print it whole.
const originOf = (url) => {
    try {
        const parsed = new URL(url);
        return parsed.username || parsed.password ? null : parsed.origin;
    } catch { return null; }
};

/** Whether `given` is the production project: the same origin. The read uses nothing else of it. */
export function readsProduction(given, production) {
    const origin = originOf(production);
    return origin !== null && originOf(given) === origin;
}

/**
 * The report's first line. It names the production host, which wrangler.jsonc
 * makes public, and never the value it was given: in the workflow that is a
 * secret.
 */
export function catalogLine(given, production) {
    const { host } = new URL(production);
    return readsProduction(given, production)
        ? `catalog: production (${host})`
        : `catalog: NOT production (SUPABASE_URL is not ${host}, the top-level vars in wrangler.jsonc)`;
}
