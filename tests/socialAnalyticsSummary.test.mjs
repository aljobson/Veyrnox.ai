import test from 'node:test';
import assert from 'node:assert/strict';
import { postInteractions, rangeForDays, summarize, totalViews } from '../lib/social/analyticsSummary.js';

test('rangeForDays is inclusive of today and counts in UTC', () => {
    assert.deepEqual(rangeForDays(30, new Date('2026-10-03T23:59:00Z')), { from: '2026-09-04', to: '2026-10-03' });
    assert.deepEqual(rangeForDays(1, new Date('2026-10-03T00:00:00Z')), { from: '2026-10-03', to: '2026-10-03' });
});

test('postInteractions adds whatever the network reported and ignores the rest', () => {
    assert.equal(postInteractions({ metrics: { likes: 30, comments: 4, saves: 2, shares: 1 } }), 37);
    assert.equal(postInteractions({ metrics: { comments: 4, likes: 'many' } }), 4);
    assert.equal(postInteractions({}), 0);
});

test('summarize reports the latest followers, the change across the period and engagement', () => {
    const out = summarize({
        evolution: [
            { date: '2026-10-01', metrics: { followers: 1000 } },
            { date: '2026-10-02', metrics: { posts_count: 5 } },
            { date: '2026-10-03', metrics: { followers: 1040 } },
        ],
        posts: [{ metrics: { likes: 90, comments: 10 } }, { metrics: { likes: 4 } }],
    });
    assert.equal(out.followers, 1040);
    assert.equal(out.followersChange, 40);
    assert.equal(out.posts, 2);
    assert.equal(out.interactions, 104);
    assert.equal(out.interactionsPerPost, 52);
    assert.equal(out.engagementPer1000, 50);
    assert.deepEqual(out.series, [{ date: '2026-10-01', followers: 1000 }, { date: '2026-10-03', followers: 1040 }]);
});

test('summarize does not invent a change, an average or a rate it cannot compute', () => {
    assert.deepEqual(summarize({ evolution: [], posts: [] }), {
        followers: null, followersChange: null, posts: 0, interactions: 0,
        interactionsPerPost: null, engagementPer1000: null, hasInsights: false, hasViews: false, series: [],
    });
    assert.equal(summarize({ posts: [{ metrics: { likes: 1 } }, { metrics: { likes: 2, reach: 40 } }] }).hasInsights, true);
    const oneDay = summarize({ evolution: [{ date: '2026-10-03', metrics: { followers: 0 } }], posts: [{ metrics: { likes: 3 } }] });
    assert.equal(oneDay.followersChange, null);
    assert.equal(oneDay.engagementPer1000, null, 'no followers, no per-follower rate');
    assert.equal(oneDay.interactionsPerPost, 3);
});

test('YouTube video views are visible without Instagram reach or insights', () => {
    const out = summarize({ posts: [{ metrics: { views: 100, likes: 3, comments: 1 } }] });
    assert.equal(out.hasViews, true);
    assert.equal(out.hasInsights, false);
    assert.equal(out.interactions, 4, 'views do not count as interactions');
});

test('totalViews adds the views networks reported and ignores the rest', () => {
    assert.equal(totalViews([{ metrics: { views: 120 } }, { metrics: { views: 5 } }, { metrics: { likes: 9 } }, {}]), 125);
    assert.equal(totalViews([{ metrics: { views: 'many' } }]), 0);
    assert.equal(totalViews(undefined), 0);
});
