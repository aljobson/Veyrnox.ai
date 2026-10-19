import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('production keeps fail-closed fal rollout flags out of Worker bindings', () => {
    for (const name of [
        'FAL_SUBMIT_OUTCOME_ENABLED',
        'FAL_DISPATCH_SCHEMA_ENABLED',
        'FAL_DURABLE_DISPATCH_ENABLED',
        'FAL_DISPATCH_QUEUE_ENABLED',
    ]) {
        assert.equal(Object.hasOwn(config.vars, name), false, `${name} should be omitted while disabled`);
    }
});

test('production public variables retain Cloudflare text-binding headroom', () => {
    // The 2026-10-16 deploy had 81 public vars plus 48 secrets: 129 text
    // bindings against Cloudflare's 128 limit. Capping vars at 77 leaves three
    // free slots at that same secret footprint and forces future consolidation.
    // ADR-0145 moved nine Cinema switches into CINEMA_RUNTIME_FLAGS (66 vars to 58); the cap is now 60, so the next
    // Cinema flag goes into that JSON object, not into a new var.
    assert.ok(Object.keys(config.vars).length <= 60, 'production vars must stay at or below 60');
});
