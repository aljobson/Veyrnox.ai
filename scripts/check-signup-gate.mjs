#!/usr/bin/env node
/**
 * Is the signup grant a faucet right now?
 *
 * `grant:signup` hands 50 credits to every confirmed email. Two independent
 * things decide whether "confirmed" means anything:
 *
 *   1. Supabase Auth's "Confirm email" setting. With autoconfirm ON,
 *      email_confirmed_at is set the instant the row is inserted, so anyone
 *      who can POST an email address gets a usable account with 50 credits.
 *      THIS IS THE LOAD-BEARING ONE — it is what stops provider spend.
 *   2. Migration 0071. It moves the grant from "on INSERT, unconditionally"
 *      (0010, which production still runs) onto the confirmation transition.
 *      On its own it changes NOTHING while autoconfirm is on: its INSERT
 *      branch sees a non-null email_confirmed_at and grants anyway.
 *
 * Both are needed for the clean state. Neither is visible from the codebase,
 * which is why this drifted unnoticed — the repo looked correct while
 * production was wide open.
 *
 * Reads only public config: the publishable key from wrangler.jsonc and the
 * anon-callable applied_migration_names() ledger. No secret.
 *
 * Exit 0 = gate closed. Exit 1 = faucet open. Exit 2 = could not tell.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function publicConfig() {
    const raw = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
    const url = (/https:\/\/[a-z0-9]+\.supabase\.co/.exec(raw) || [])[0];
    const key = (/sb_publishable_[A-Za-z0-9_-]+/.exec(raw) || [])[0];
    if (!url || !key) throw new Error('could not read SUPABASE_URL / publishable key from wrangler.jsonc');
    return { url, key };
}

async function authSettings({ url, key }) {
    const res = await fetch(new URL('/auth/v1/settings', url), {
        headers: { apikey: key },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`/auth/v1/settings answered ${res.status}`);
    return res.json();
}

async function appliedMigrations({ url, key }) {
    const res = await fetch(new URL('/rest/v1/rpc/applied_migration_names', url), {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`applied_migration_names answered ${res.status}`);
    const rows = await res.json();
    return new Set(rows.map((r) => (typeof r === 'string' ? r : r && r.name)).filter(Boolean));
}

let cfg;
try {
    cfg = publicConfig();
} catch (err) {
    console.error(`could not read public config: ${err.message}`);
    process.exit(2);
}

let settings;
let applied;
try {
    [settings, applied] = await Promise.all([authSettings(cfg), appliedMigrations(cfg)]);
} catch (err) {
    // "Could not check" is never a pass — same rule as the migration ledger.
    console.error(`could not check the signup gate: ${err.message}`);
    process.exit(2);
}

const autoconfirm = settings.mailer_autoconfirm === true;
const signupOpen = settings.disable_signup === false;
const has0071 = [...applied].some((n) => n.startsWith('0071'));

const problems = [];
if (autoconfirm && signupOpen) {
    problems.push(
        'mailer_autoconfirm is ON and signup is open: any address that can be POSTed becomes a\n' +
        '    usable account holding 50 credits. Turn "Confirm email" ON in Supabase Auth.\n' +
        '    This is the change that actually stops provider spend.'
    );
}
if (!has0071) {
    problems.push(
        'migration 0071 is not applied: production still runs the 0010 trigger, which grants on\n' +
        '    INSERT unconditionally. With Confirm email ON this mints credits for accounts nobody\n' +
        '    can log into — money is safe, the ledger is not. Apply via the apply-migrations workflow.'
    );
}

console.log('signup gate');
console.log(`  mailer_autoconfirm : ${autoconfirm ? 'ON  <- grants are instantly usable' : 'off'}`);
console.log(`  signup             : ${signupOpen ? 'open' : 'disabled'}`);
console.log(`  migration 0071     : ${has0071 ? 'applied' : 'NOT APPLIED  <- 0010 still grants on INSERT'}`);
console.log(`  providers          : ${Object.entries(settings.external || {}).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

if (!problems.length) {
    console.log('\nGate closed: the grant follows a real confirmation.');
    process.exit(0);
}

console.error('\nSIGNUP FAUCET OPEN');
for (const p of problems) console.error(`  - ${p}`);
console.error('\n  Both are needed for the clean state, and neither is visible from the repo.');
process.exit(1);
