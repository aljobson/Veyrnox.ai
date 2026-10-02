#!/usr/bin/env node
/**
 * Does production's sign-in dialog still offer what we think it offers?
 *
 * The dialog shows the providers listed for production in
 * packages/security/environments.js, and hides one when Supabase's live
 * /auth/v1/settings says it is switched off. Those switches live outside this
 * repo, so a provider turned off there quietly disappears for everyone. This
 * reports that drift, and a live provider the app does not offer.
 *
 * It cannot see an expired Sign in with Apple client secret: Supabase still
 * reports apple:true and the failure only shows at token exchange (ADR-0030).
 * For that it reads the expiry date recorded in environments.js and warns 30
 * days ahead, so the calendar reminder cannot be missed silently.
 *
 * Reads public config only. Exit 0 = OK. Exit 1 = needs attention.
 * Exit 2 = could not tell (never a pass).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AI_ENVIRONMENTS } from '../packages/security/environments.js';
import { OAUTH_PROVIDERS } from '../app/lib/authProviders.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SECRET_WARNING_DAYS = 30;

/** Pure comparison, unit-tested in tests/authProviders.test.mjs. */
export function providerDrift(expected, settings) {
    const ext = (settings && settings.external) || {};
    const missing = expected.filter((p) => ext[p] !== true);
    const unlisted = OAUTH_PROVIDERS.filter((p) => ext[p] === true && !expected.includes(p));
    return { missing, unlisted };
}

/** Days until a YYYY-MM-DD expiry, or null when the date is missing or malformed. */
export function daysUntil(isoDate, nowMs) {
    if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
    const at = Date.parse(`${isoDate}T00:00:00Z`);
    return Number.isFinite(at) ? Math.floor((at - nowMs) / DAY_MS) : null;
}

/** @returns {Promise<0|1|2>} */
export async function main({ fetcher = fetch, nowMs = Date.now(), out = console.log, err = console.error } = {}) {
    try {
        const prod = AI_ENVIRONMENTS.production;
        let settings;
        try {
            const res = await fetcher(new URL('/auth/v1/settings', prod.supabaseUrl), {
                headers: { apikey: prod.publishableKey },
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) throw new Error(`/auth/v1/settings answered ${res.status}`);
            settings = await res.json();
        } catch (e) {
            err(`could not read production auth settings: ${e.message}`);
            return 2;
        }
        // A body without a provider map says nothing about the providers.
        if (!settings || typeof settings !== 'object' || !settings.external || typeof settings.external !== 'object') {
            err('could not read production auth settings: no `external` provider map in the response');
            return 2;
        }
        const ext = settings.external;
        const expected = [...prod.oauthProviders];
        const { missing, unlisted } = providerDrift(expected, settings);
        out(`expected: ${expected.join(', ') || 'none'}`);
        out(`live:     ${OAUTH_PROVIDERS.filter((p) => ext[p] === true).join(', ') || 'none'}`);

        const problems = [];
        for (const p of missing) {
            problems.push(`DRIFT: ${p} is switched off in Supabase Auth, so its "Continue with ..." button is hidden for everyone. Switch it back on, or remove it from environments.js on purpose.`);
        }
        for (const p of unlisted) {
            problems.push(`DRIFT: ${p} is on in Supabase Auth but the app does not offer it. Add it to environments.js and deploy, or switch it off.`);
        }
        if (expected.includes('apple')) {
            const days = daysUntil(prod.appleSecretExpiresOn, nowMs);
            if (days === null) {
                problems.push('APPLE SECRET: no valid appleSecretExpiresOn in environments.js, so its expiry cannot be watched.');
            } else if (days <= SECRET_WARNING_DAYS) {
                problems.push(`APPLE SECRET: the Sign in with Apple client secret expires on ${prod.appleSecretExpiresOn} (${days < 0 ? `${-days} days ago` : `in ${days} days`}). Every Apple sign-in fails at token exchange once it does. Mint a new one (ADR-0030), save it in Supabase Auth, then update appleSecretExpiresOn.`);
            } else {
                out(`apple secret: expires ${prod.appleSecretExpiresOn}, in ${days} days`);
            }
        }
        if (!problems.length) {
            out('OK: the sign-in dialog offers exactly the providers Supabase has on.');
            return 0;
        }
        for (const p of problems) out(p);
        return 1;
    } catch (e) {
        // An unexpected throw is "could not tell", never drift and never a pass.
        err(`auth provider check failed: ${e && e.message}`);
        return 2;
    }
}

function invokedDirectly() {
    try {
        return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
    } catch {
        return false;
    }
}

if (invokedDirectly()) process.exit(await main());
