import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';
import { cinemaFeatures } from '../lib/cinema/features.js';
import { uploadSafetyHold } from '../lib/cinema/uploadPolicy.js';

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

// Cloudflare refuses a Worker version with more than 128 text bindings (plain vars plus secrets): error 10055. On 2026-10-17 a staging
// deploy failed at 132, and production sat at 126. Secrets are not in the repo, so their counts are recorded here; refresh them when
// they change (`wrangler versions view <id> --json`, count `secret_text`).
const TEXT_BINDING_LIMIT = 128, HEADROOM = 4;
const SECRETS = { production: 49, staging: 46 };
test('plain vars leave headroom under the 128 text-binding limit, so a deploy is not refused', () => {
    const production = Object.keys(config.vars).length + SECRETS.production;
    const staging = Object.keys(config.env.staging.vars).length + SECRETS.staging;
    assert.ok(production <= TEXT_BINDING_LIMIT - HEADROOM, `production would use ${production} of ${TEXT_BINDING_LIMIT} text bindings; group or remove vars (see EDITOR_RUNTIME_FLAGS) before adding more`);
    assert.ok(staging <= TEXT_BINDING_LIMIT - HEADROOM, `staging would use ${staging} of ${TEXT_BINDING_LIMIT} text bindings; group or remove vars before adding more`);
});

// 2026-10-17: these 14 vars were set to "false" and nothing else. Every reader treats only the exact string "true" as on, so deleting a
// "false" var changes nothing. They are listed so that re-adding one as "true" is a deliberate edit, and so this equivalence stays proven.
const REMOVED_FALSE_FLAGS = [
    'ADMIN_CREDIT_GRANTS_ENABLED', 'CINEMA_AUDIENCE_ENABLED', 'CINEMA_CREATOR_ANALYTICS_ENABLED', 'CINEMA_PROXY_UPLOADS_ENABLED',
    'CINEMA_RANKINGS_ENABLED', 'CINEMA_RETENTION_ENABLED', 'COMMENTS_ENABLED', 'STORY_POLLS_ENABLED', 'VOTING_ENABLED',
    'CREATOR_MONETISATION_ENABLED', 'PPV_ENABLED', 'FAL_DISPATCH_QUEUE_ENABLED', 'FAL_DURABLE_DISPATCH_ENABLED', 'FAL_SUBMIT_OUTCOME_ENABLED',
];
for (const [name, vars] of [['production', config.vars], ['staging', config.env.staging.vars]]) {
    test(`${name}: removing the explicit "false" vars changes no feature switch`, () => {
        // Comments are packed on in staging on purpose (owner, 2026-10-19; see tests/cinemaRuntimeFlags.test.mjs), so staging's "false" copy leaves it alone.
        const removed = name === 'staging' ? REMOVED_FALSE_FLAGS.filter((flag) => flag !== 'COMMENTS_ENABLED') : REMOVED_FALSE_FLAGS;
        const withFalse = { ...vars, ...Object.fromEntries(removed.map((flag) => [flag, 'false'])) };
        for (const flag of REMOVED_FALSE_FLAGS) assert.notEqual(vars[flag], 'true', `${flag} is on in ${name}; it was off before this change`);
        assert.deepEqual(cinemaFeatures(vars), cinemaFeatures(withFalse), 'Cinema switches are identical with or without the "false" vars');
        assert.equal(uploadSafetyHold(vars), uploadSafetyHold(withFalse));
        assert.equal(uploadSafetyHold(vars), true, 'the Cinema upload safety hold stays on');
        for (const flag of ['ADMIN_CREDIT_GRANTS_ENABLED', 'FAL_DISPATCH_QUEUE_ENABLED', 'FAL_DURABLE_DISPATCH_ENABLED']) {
            assert.equal(vars[flag] === 'true', withFalse[flag] === 'true', flag);
        }
    });
}
