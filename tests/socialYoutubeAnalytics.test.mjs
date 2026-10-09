import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAnalytics } from '../packages/adapters/social/youtube.js';

const channelId = 'UC_fixture_channel';
const videoId = 'abcdefghijk';
const channel = { id: channelId, statistics: { subscriberCount: '1200', viewCount: '54321', videoCount: '9' }, contentDetails: { relatedPlaylists: { uploads: 'UU_uploads' } } };
const video = { id: videoId, snippet: { channelId, publishedAt: '2026-10-01T12:00:00Z', title: 'My video' }, statistics: { viewCount: '30', likeCount: '2', commentCount: '0' } };
function responses(overrides = {}, calls = []) {
    const data = { channels: { items: [channel] }, playlistItems: { items: [{ contentDetails: { videoId } }] }, videos: { items: [video] }, ...overrides };
    return async (url, init) => {
        const u = new URL(url);
        calls.push({ url: u, init });
        const value = data[u.pathname.split('/').pop()];
        return value instanceof Response ? value : Response.json(value);
    };
}

test('YouTube analytics normalizes channel and video counters in three bounded authorized reads', async () => {
    const calls = [];
    const result = await fetchAnalytics('test-token', { externalAccountId: channelId }, responses({}, calls));
    assert.deepEqual(result, {
        metrics: { followers: 1200, views: 54321, posts_count: 9 },
        posts: [{ id: videoId, published_at: '2026-10-01T12:00:00.000Z', type: 'video', permalink: `https://www.youtube.com/watch?v=${videoId}`, caption: 'My video', metrics: { views: 30, likes: 2, comments: 0 } }],
    });
    assert.equal(calls.length, 3);
    for (const { url, init } of calls) {
        assert.equal(url.origin, 'https://www.googleapis.com');
        assert.equal(url.searchParams.has('access_token'), false);
        assert.equal(init.headers.Authorization, 'Bearer test-token');
        assert.ok(init.signal instanceof AbortSignal);
    }
    assert.equal(calls[0].url.searchParams.get('mine'), 'true');
    assert.equal(calls[0].url.searchParams.get('part'), 'statistics,contentDetails');
    assert.equal(calls[1].url.searchParams.get('playlistId'), 'UU_uploads');
    assert.equal(calls[1].url.searchParams.get('maxResults'), '50');
    assert.equal(calls[2].url.searchParams.get('id'), videoId);
});

test('hidden subscribers and unavailable counters are omitted, not invented as zero', async () => {
    const result = await fetchAnalytics('token', { externalAccountId: channelId }, responses({
        channels: { items: [{ ...channel, statistics: { hiddenSubscriberCount: true, subscriberCount: '1200', viewCount: '', videoCount: '0' } }] },
        videos: { items: [{ ...video, statistics: { viewCount: '0', likeCount: '-1', commentCount: null } }] },
    }));
    assert.deepEqual(result.metrics, { posts_count: 0 });
    assert.deepEqual(result.posts[0].metrics, { views: 0 });
});

test('rejects unsafe or malformed counters', async () => {
    const result = await fetchAnalytics('token', { externalAccountId: channelId }, responses({ channels: { items: [{ ...channel, statistics: { subscriberCount: '9007199254740992', viewCount: 'NaN', videoCount: '2.5' } }] } }));
    assert.deepEqual(result.metrics, {});
});

test('empty upload playlists make no videos request', async () => {
    const calls = [];
    const result = await fetchAnalytics('token', { externalAccountId: channelId }, responses({ playlistItems: { items: [] } }, calls));
    assert.deepEqual(result.posts, []);
    assert.equal(calls.length, 2);
});

test('a different connected channel is refused before any playlist lookup', async () => {
    const calls = [];
    await assert.rejects(fetchAnalytics('token', { externalAccountId: 'other-channel' }, responses({}, calls)), /youtube_channel_not_found/);
    assert.equal(calls.length, 1);
});

test('filters missing/deleted videos, foreign channels, malformed IDs and invalid publication dates', async () => {
    const calls = [];
    const result = await fetchAnalytics('token', { externalAccountId: channelId }, responses({
        playlistItems: { items: [{ contentDetails: { videoId } }, { contentDetails: { videoId } }, { contentDetails: { videoId: 'bad&id' } }, {}] },
        videos: { items: [{ ...video, snippet: { ...video.snippet, channelId: 'foreign' } }, { ...video, snippet: { ...video.snippet, publishedAt: 'bad' } }, { ...video, id: 'notrequested' }, video] },
    }, calls));
    assert.equal(result.posts.length, 1);
    assert.equal(calls[2].url.searchParams.get('id'), videoId);
});

test('never follows nextPageToken or makes more than one 50-ID video lookup', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => String(i).padStart(11, '0'));
    const calls = [];
    await fetchAnalytics('token', { externalAccountId: channelId }, responses({ playlistItems: { items: ids.map((id) => ({ contentDetails: { videoId: id } })), nextPageToken: 'next' }, videos: { items: [] } }, calls));
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url.searchParams.get('id').split(',').length, 50);
});

for (const resource of ['channels', 'playlistItems', 'videos']) {
    test(`${resource} failure is typed without copying upstream error text`, async () => {
        await assert.rejects(fetchAnalytics('token', { externalAccountId: channelId }, responses({ [resource]: Response.json({ error: { message: 'private upstream detail' } }, { status: 403 }) })), /^Error: youtube_analytics_failed_403$/);
    });
    test(`${resource} malformed response fails the round instead of recording false success`, async () => {
        await assert.rejects(fetchAnalytics('token', { externalAccountId: channelId }, responses({ [resource]: {} })), /youtube_analytics_invalid_response/);
    });
}
