#!/usr/bin/env node
/**
 * Are the prepaid provider balances above their floors?
 *
 * fal.ai, kie.ai and OpenRouter are paid from balances the owner tops up by
 * hand. An empty one refuses every submit; the customer is refunded, so no
 * money is lost, but every model on that provider is down until someone
 * notices. This reads each balance through the provider's own read-only
 * endpoint (scripts/lib/provider-balances.mjs) and compares it with a floor,
 * so .github/workflows/provider-balances.yml can open an issue first.
 *
 * Keys, from the environment (never printed):
 *   FAL_BILLING_KEY            a fal key on the BILLING or READONLY preset
 *   KIE_BALANCE_API_KEY        a kie API key (kie has one key type)
 *   OPENROUTER_MANAGEMENT_KEY  an OpenRouter Management key
 * Floors, optional: PROVIDER_BALANCE_FLOOR_FAL_USD,
 *   PROVIDER_BALANCE_FLOOR_KIE_CREDITS, PROVIDER_BALANCE_FLOOR_OPENROUTER_USD.
 *
 * Usage:
 *   node scripts/check-provider-balances.mjs [--show-figures]
 *
 * The report names the verdict and the floor, not the balance: the repo and
 * its Actions logs are public. --show-figures adds the figures for a run at
 * your own terminal.
 *
 * Exit 0 every balance is above its floor, 1 one is at or under it, 2 one
 * could not be read. A read that fails is never a pass.
 */

import { fileURLToPath } from 'node:url';

import { checkAll, exitCode, reportLines } from './lib/provider-balances.mjs';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const results = await checkAll(process.env);
    console.log('provider balances');
    for (const line of reportLines(results, { showFigures: process.argv.includes('--show-figures') })) console.log(`  ${line}`);
    const code = exitCode(results);
    if (code === 0) console.log('\nEvery balance is above its floor.');
    else if (code === 1) console.error('\nLOW BALANCE: top up before the provider refuses submits. docs/operations/provider-balances.md');
    else console.error('\nCOULD NOT READ a balance. This is not a pass: the balance may be low right now.');
    process.exit(code);
}
