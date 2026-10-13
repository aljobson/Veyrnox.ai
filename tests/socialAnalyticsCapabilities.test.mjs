import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsCapabilities, hasAnalytics } from '../lib/social/analyticsCapabilities.js';

test('analytics capability matrix names only metrics implemented for each provider', () => {
    assert.deepEqual(analyticsCapabilities('instagram'), ['Followers', 'Posts', 'Interactions', 'Reach', 'Views', 'Best time']);
    assert.deepEqual(analyticsCapabilities('twitch'), ['Videos', 'Views']);
    assert.deepEqual(analyticsCapabilities('linkedin'), []);
    assert.deepEqual(analyticsCapabilities('twitter'), ['Followers', 'Posts', 'Interactions', 'Impressions', 'Best time']);
    assert.equal(hasAnalytics('youtube'), true);
    assert.equal(hasAnalytics('twitter'), true);
});
