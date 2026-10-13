import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishRuntimeFeatureEnabled } from '../lib/social/runtimeFlags.js';
import { freeSocialAccountLimit } from '../lib/social/accountAllowance.js';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const grouped = (plans = 'false', videoDestinations = 'false') => ({
    PUBLISH_RUNTIME_FLAGS: JSON.stringify({ plans, videoDestinations }),
});

test('grouped Publish controls resolve independently and retain legacy rollback overrides', () => {
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', grouped('true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', grouped('false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', { ...grouped('true'), PUBLISH_PLANS_ENABLED: 'false' }), false);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', { PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'true' }), true);
});

test('malformed, incomplete and unknown grouped Publish controls fail closed', () => {
    for (const value of [undefined, 'broken', 'null', '[]', 'true', '{}', '{"plans":true}', '{"other":"true"}', ' '.repeat(1025)]) {
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
    }
    assert.equal(publishRuntimeFeatureEnabled('UNKNOWN', grouped('true', 'true')), false);
});

test('remote environments enable plans while native video destinations remain off', () => {
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    for (const vars of [config.vars, config.env.staging.vars]) {
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', vars), true);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', vars), false);
        assert.equal(freeSocialAccountLimit(vars), 5);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_PLANS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_VIDEO_DESTINATIONS_ENABLED'), false);
    }
});
