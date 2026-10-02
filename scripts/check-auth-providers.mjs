#!/usr/bin/env node
/**
 * Do production's live sign-in providers match what the app shows?
 *
 * The sign-in dialog shows the providers listed for production in
 * packages/security/environments.js, and hides one only when Supabase's live
 * /auth/v1/settings says it is off. Supabase Auth's provider switches live
 * outside this repo, so a provider switched off there (or an expired Apple
 * key) makes "Continue with Apple" quietly disappear for everyone. This
 * reports that drift, and a live provider the app does not offer.
 *
 * Reads public config only: the publishable key and /auth/v1/settings.
 * Exit 0 = match. Exit 1 = drift. Exit 2 = could not tell.
 */

import { AI_ENVIRONMENTS } from '../packages/security/environments.js';
import { OAUTH_PROVIDERS } from '../app/lib/authProviders.js';

/** Pure comparison, unit-tested in tests/authProviders.test.mjs. */
export function providerDrift(expected, settings) {
    const ext = (settings && settings.external) || {};
    const missing = expected.filter((p) => ext[p] !== true);
    const unlisted = OAUTH_PROVIDERS.filter((p) => ext[p] === true && !expected.includes(p));
    return { missing, unlisted };
}

async function main() {
    const prod = AI_ENVIRONMENTS.production;
    let settings;
    try {
        const res = await fetch(new URL('/auth/v1/settings', prod.supabaseUrl), {
            headers: { apikey: prod.publishableKey },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`/auth/v1/settings answered ${res.status}`);
        settings = await res.json();
    } catch (err) {
        console.error(`could not read production auth settings: ${err.message}`);
        return 2;
    }
    const expected = [...prod.oauthProviders];
    const { missing, unlisted } = providerDrift(expected, settings);
    console.log(`expected: ${expected.join(', ') || 'none'}`);
    console.log(`live:     ${OAUTH_PROVIDERS.filter((p) => settings.external?.[p] === true).join(', ') || 'none'}`);
    if (!missing.length && !unlisted.length) {
        console.log('OK: the sign-in dialog offers exactly the providers Supabase has on.');
        return 0;
    }
    for (const p of missing) {
        console.log(`DRIFT: ${p} is off in Supabase Auth, so "Continue with ${p[0].toUpperCase()}${p.slice(1)}" is hidden for everyone. Re-enable it (check its keys have not expired), or remove it from environments.js on purpose.`);
    }
    for (const p of unlisted) {
        console.log(`DRIFT: ${p} is on in Supabase Auth but the app does not offer it. Add it to environments.js, or switch it off.`);
    }
    return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
