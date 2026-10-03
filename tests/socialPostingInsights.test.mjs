import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePostingInsights } from '../lib/social/postingInsights.js';
import { postingInsightsEnabled } from '../lib/social/publishFeature.js';
const cell = (hour, score, posts = 3) => ({ day: 2, hour, score, posts });
const enough = { measured_posts: 10, history_days: 14, heatmap: [cell(10, 50), cell(11, 20)], frequency: [] };

test('timing ranks observed averages, with deterministic ties and minimum samples', () => {
    const out = summarizePostingInsights({ ...enough, heatmap: [cell(11, 50), cell(10, 50, 4), cell(12, 999, 2), cell(13, null, 4), cell(14, 0)] });
    assert.deepEqual(out.topSlots.map((c) => c.hour), [10, 11]);
    assert.equal(out.maxScore, 50);
});

test('cold starts, narrowly spaced history and zero measured engagement produce no recommendation', () => {
    for (const changes of [{ measured_posts: 9 }, { history_days: 13 }, { heatmap: [cell(10, 0)] }, { heatmap: [cell(10, 99, 2)] }]) {
        assert.deepEqual(summarizePostingInsights({ ...enough, ...changes }).topSlots, []);
    }
    assert.deepEqual(summarizePostingInsights(null).frequency, []);
});

test('frequency scores weight measured posts rather than averaging weekly averages', () => {
    const out = summarizePostingInsights({ ...enough, frequency: [
        { posts: 4, measured_posts: 4, avg_interactions: 10 },
        { posts: 4, measured_posts: 1, avg_interactions: 100 },
        { posts: 4, measured_posts: 0, avg_interactions: null },
        { posts: 0, measured_posts: 0, avg_interactions: null },
    ] });
    assert.deepEqual(out.frequency, [
        { postsPerWeek: 0, weeks: 1, measuredPosts: 0, score: null },
        { postsPerWeek: 4, weeks: 3, measuredPosts: 5, score: 28 },
    ]);
});

test('invalid observations cannot rank a slot or turn a missing frequency score into zero', () => {
    const out = summarizePostingInsights({ ...enough, heatmap: [cell(10, NaN), { ...cell(11, 10), day: 9 }],
        frequency: [{ posts: 2, measured_posts: 3, avg_interactions: 10 }, { posts: 2, measured_posts: 1, avg_interactions: null }] });
    assert.deepEqual(out.topSlots, []);
    assert.deepEqual(out.frequency, [{ postsPerWeek: 2, weeks: 1, measuredPosts: 0, score: null }]);
});

test('only exact true enables the separate insights switch', () => {
    for (const value of [undefined, 'false', '1', 'TRUE']) assert.equal(postingInsightsEnabled({ PUBLISH_POSTING_INSIGHTS_ENABLED: value }), false);
    assert.equal(postingInsightsEnabled({ PUBLISH_POSTING_INSIGHTS_ENABLED: 'true' }), true);
});
