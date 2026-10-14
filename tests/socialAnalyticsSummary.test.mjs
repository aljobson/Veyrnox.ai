import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsCsv, contentTypePerformance, hashtagPerformance, metricChange, postAnalyticsCsv, postInteractions, previousRange, rangeForDays, summarize, summarizePortfolio, topContent, totalPostMetric, totalViews } from '../lib/social/analyticsSummary.js';

test('rangeForDays is inclusive of today and counts in UTC', () => {
    assert.deepEqual(rangeForDays(30, new Date('2026-10-03T23:59:00Z')), { from: '2026-09-04', to: '2026-10-03' });
    assert.deepEqual(rangeForDays(1, new Date('2026-10-03T00:00:00Z')), { from: '2026-10-03', to: '2026-10-03' });
});

test('previousRange returns the adjacent inclusive period with equal length', () => {
    assert.deepEqual(previousRange({ from: '2026-10-01', to: '2026-10-07' }), { from: '2026-09-24', to: '2026-09-30' });
    assert.deepEqual(previousRange({ from: '2026-10-03', to: '2026-10-03' }), { from: '2026-10-02', to: '2026-10-02' });
    assert.equal(previousRange({ from: '2026-10-04', to: '2026-10-03' }), null);
});

test('metricChange only compares metrics supplied in both periods', () => {
    assert.equal(metricChange(12, 5), 7);
    assert.equal(metricChange(0, 5), -5);
    assert.equal(metricChange(null, 5), null);
    assert.equal(metricChange(12, undefined), null);
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
        interactionsPerPost: null, engagementPer1000: null, hasInsights: false, hasViews: false, hasImpressions: false, series: [],
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

test('totalPostMetric returns null rather than inventing unsupported zeroes', () => {
    assert.equal(totalPostMetric([{ metrics: { likes: 2 } }], 'reach'), null);
    assert.equal(totalPostMetric([{ metrics: { reach: 0 } }, { metrics: { reach: 12 } }], 'reach'), 12);
});

test('contentTypePerformance compares formats without converting unavailable metrics to zero', () => {
    assert.deepEqual(contentTypePerformance([
        { type: 'REEL', metrics: { likes: 8, comments: 2, reach: 100, views: 220 } },
        { type: 'reel', metrics: { likes: 2, reach: 50 } },
        { type: 'image', metrics: { likes: 4, impressions: 80 } },
    ]), [
        { type: 'reel', posts: 2, interactions: 12, interactionsPerPost: 6, reach: 150, impressions: null, views: 220 },
        { type: 'image', posts: 1, interactions: 4, interactionsPerPost: 4, reach: null, impressions: 80, views: null },
    ]);
});

test('topContent ranks only posts with the chosen metric', () => {
    const posts = [
        { id: 'a', published_at: '2026-10-01', metrics: { reach: 20, likes: 2 } },
        { id: 'b', published_at: '2026-10-02', metrics: { likes: 10 } },
        { id: 'c', published_at: '2026-10-03', metrics: { reach: 50, likes: 1 } },
    ];
    assert.deepEqual(topContent(posts, 'reach', 2).map(({ post, value }) => [post.id, value]), [['c', 50], ['a', 20]]);
    assert.deepEqual(topContent(posts, 'interactions', 2).map(({ post, value }) => [post.id, value]), [['b', 10], ['a', 2]]);
    assert.deepEqual(topContent(posts, 'unsupported'), []);
});

test('hashtagPerformance counts a hashtag once per post and ranks its average interactions', () => {
    const rows = hashtagPerformance([
        { caption: '#Launch #launch #AI', metrics: { likes: 6 } },
        { caption: 'More #launch', metrics: { likes: 2 } },
        { caption: 'Quiet #design', metrics: { likes: 5 } },
    ]);
    assert.deepEqual(rows, [
        { hashtag: '#ai', posts: 1, interactions: 6, interactionsPerPost: 6 },
        { hashtag: '#design', posts: 1, interactions: 5, interactionsPerPost: 5 },
        { hashtag: '#launch', posts: 2, interactions: 8, interactionsPerPost: 4 },
    ]);
});

test('summarizePortfolio combines only metrics supplied by each provider', () => {
    const out = summarizePortfolio([
        { account: { network: 'instagram' }, data: {
            sync: { last_ok_at: '2026-10-13T08:00:00Z', failing: false },
            evolution: [{ date: '2026-10-13', metrics: { followers: 40 } }],
            posts: [{ metrics: { likes: 3, reach: 20 } }],
        } },
        { account: { network: 'youtube' }, data: {
            sync: { last_ok_at: null, failing: false },
            evolution: [{ date: '2026-10-13', metrics: { followers: 60 } }],
            posts: [{ metrics: { likes: 2, views: 100, impressions: 150 } }],
        } },
    ]);
    assert.deepEqual({ accounts: out.accounts, followers: out.followers, posts: out.posts,
        interactions: out.interactions, reach: out.reach, impressions: out.impressions, views: out.views, staleAccounts: out.staleAccounts },
    { accounts: 2, followers: 100, posts: 2, interactions: 5, reach: 20, impressions: 150, views: 100, staleAccounts: 1 });
});

test('analyticsCsv escapes spreadsheet text and leaves unavailable metrics blank', () => {
    const csv = analyticsCsv([{ account: { network: 'youtube', display_name: 'Studio, "North"' },
        summary: { followers: 12, posts: 2, interactions: 3 }, reach: null, impressions: 120, views: 99,
        lastOkAt: '2026-10-13T08:00:00Z', failing: false }]);
    assert.match(csv, /^network,account,followers,posts,interactions,reach,impressions,views,last_updated,status\r\n/);
    assert.match(csv, /youtube,"Studio, ""North""",12,2,3,,120,99,2026-10-13T08:00:00Z,current$/);
});

test('postAnalyticsCsv exports provider metrics and computed interactions', () => {
    const csv = postAnalyticsCsv({ network: 'instagram', display_name: 'Studio' }, [{
        published_at: '2026-10-13T10:00:00Z', type: 'image', caption: 'Hello, world', permalink: 'https://example.test/post',
        metrics: { reach: 20, impressions: 30, likes: 3, comments: 1, saves: 2, shares: 4 },
    }]);
    assert.match(csv, /^network,account,published_at,type,caption,permalink,reach,impressions,views,likes,comments,saves,shares,interactions\r\n/);
    assert.match(csv, /instagram,Studio,2026-10-13T10:00:00Z,image,"Hello, world",https:\/\/example.test\/post,20,30,,3,1,2,4,10$/);
});

test('CSV exports neutralize spreadsheet formulas in provider text', () => {
    const csv = postAnalyticsCsv({ network: 'instagram', display_name: '=IMPORTXML("x")' }, [{
        published_at: '2026-10-13T10:00:00Z', caption: '+cmd', metrics: {},
    }]);
    assert.match(csv, /instagram,"'=IMPORTXML\(""x""\)"/);
    assert.match(csv, /,'\+cmd,/);
});
