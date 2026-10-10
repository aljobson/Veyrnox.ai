// Staging must carry every production control that is a var, because
// wrangler does not inherit `vars` into an environment (audit 2026-10-09,
// S-02). A control missing from env.staging.vars is simply off there, so a
// Top-up, account-read or upload limit that is "true" in production was
// never exercised on staging before this test existed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const production = config.vars || {};
const staging = (config.env && config.env.staging && config.env.staging.vars) || {};

// Controls that must be named in both blocks. Feature flags are not listed:
// staging turns those on ahead of production on purpose.
const CONTROLS = [
    'TOP_UP_RETURN_RATE_LIMIT_ENABLED',
    'TOP_UP_READ_RATE_LIMIT_ENABLED',
    'TOP_UP_CHECKOUT_RATE_LIMIT_ENABLED',
    'ACCOUNT_READ_RATE_LIMIT_ENABLED',
    'UPLOAD_REQUEST_RATE_LIMIT_ENABLED',
    'ASSET_LINK_RATE_LIMIT_ENABLED',
    'ADMIN_REQUIRE_AAL2',
    'UPLOAD_INTEGRITY_ENABLED',
];

for (const name of CONTROLS) {
    test(`${name} is set in both the production and the staging block`, () => {
        assert.equal(typeof production[name], 'string', `${name} is missing from the production vars`);
        assert.equal(typeof staging[name], 'string', `${name} is missing from env.staging.vars (vars are not inherited)`);
    });
}

test('every *_RATE_LIMIT_ENABLED control is on in staging as well as production', () => {
    for (const name of CONTROLS.filter(n => n.endsWith('_RATE_LIMIT_ENABLED'))) {
        assert.equal(production[name], 'true', `${name} should be "true" in production`);
        assert.equal(staging[name], 'true', `${name} should be "true" in staging`);
    }
});

test('the admin second-factor gate is on in staging as well as production', () => {
    assert.equal(production.ADMIN_REQUIRE_AAL2, 'true');
    assert.equal(staging.ADMIN_REQUIRE_AAL2, 'true');
});
