import test from 'node:test';
import assert from 'node:assert/strict';
import { publishScopeFeatureEnabled } from '../lib/social/scopeFlags.js';

const grouped = (overrides = {}) => ({
    PUBLISH_SCOPE_FLAGS: JSON.stringify({
        instagramInsights: 'false',
        instagramEngagement: 'false',
        facebookEngagement: 'false',
        tiktokAnalytics: 'false',
        ...overrides,
    }),
});

test('provider consent scopes read their grouped switches', () => {
    assert.equal(publishScopeFeatureEnabled('INSTAGRAM_INSIGHTS_SCOPE_ENABLED', grouped({ instagramInsights: 'true' })), true);
    assert.equal(publishScopeFeatureEnabled('INSTAGRAM_ENGAGEMENT_SCOPE_ENABLED', grouped({ instagramEngagement: 'true' })), true);
    assert.equal(publishScopeFeatureEnabled('FACEBOOK_ENGAGEMENT_SCOPE_ENABLED', grouped({ facebookEngagement: 'true' })), true);
    assert.equal(publishScopeFeatureEnabled('TIKTOK_ANALYTICS_SCOPE_ENABLED', grouped({ tiktokAnalytics: 'true' })), true);
});

test('an explicit individual switch takes precedence for rollback', () => {
    assert.equal(publishScopeFeatureEnabled('INSTAGRAM_INSIGHTS_SCOPE_ENABLED', {
        ...grouped({ instagramInsights: 'true' }),
        INSTAGRAM_INSIGHTS_SCOPE_ENABLED: 'false',
    }), false);
    assert.equal(publishScopeFeatureEnabled('TIKTOK_ANALYTICS_SCOPE_ENABLED', {
        ...grouped(),
        TIKTOK_ANALYTICS_SCOPE_ENABLED: 'true',
    }), true);
});

test('provider consent switches fail closed for malformed groups', () => {
    for (const value of [undefined, 'broken', 'null', '[]', 'true', '{}', '{"instagramInsights":true}', '{"other":"true"}', ' '.repeat(513)]) {
        assert.equal(publishScopeFeatureEnabled('INSTAGRAM_INSIGHTS_SCOPE_ENABLED', { PUBLISH_SCOPE_FLAGS: value }), false);
    }
    assert.equal(publishScopeFeatureEnabled('UNKNOWN', grouped({ instagramInsights: 'true' })), false);
});
