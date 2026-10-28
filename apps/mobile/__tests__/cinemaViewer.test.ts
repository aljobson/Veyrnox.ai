declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { resolve } = require('path');
import { API_BASE, ApiError, type ApiClient } from '../src/lib/api';
import { parseTitle, parseTitleDetail, posterUrl } from '../src/lib/cinema';
import { parseEpisodeLocks } from '../src/lib/cinemaSeries';
import { parseStoryPolls } from '../src/lib/cinemaSocial';
import { CURATED_POSTERS, posterSources, discoveryTarget, nextCandidate, commentsPreview, creatorAnalyticsOpen, ownPublishedTitles, accessLabel, typeLabel } from '../src/lib/cinemaViewer';

const root = '11111111-1111-4111-8111-111111111111';
const one = '22222222-2222-4222-8222-222222222222';
const two = '33333333-3333-4333-8333-333333333333';
const three = '44444444-4444-4444-8444-444444444444';
const row = { id: one, title: 'Episode', content_type: 'EPISODE', root_id: root, series_title: 'Series' };
const body = { title: { id: root, title: 'Series', content_type: 'SERIES', language: 'en-GB', ai_disclosures: ['generated_video', 'unknown', 'generated_video', 'generated_music'], seasons: [
    { id: 's2', position: 2, title: 'Second season', episodes: [{ id: three, position: 1, title: 'Three', access: 'free' }] },
    { id: 's1', position: 1, title: 'First season', episodes: [
        { id: one, position: 1, title: 'One', synopsis: 'First synopsis', access: 'free' },
        { id: two, position: 2, title: 'Two', synopsis: 'Second synopsis', access: 'locked', reason: 'pass_ceiling' },
    ] },
] } };
const api = (request: jest.Mock) => ({ request }) as unknown as ApiClient;

test('episodes require a UUID root and preserve bounded series metadata', () => {
    expect(parseTitle(row)).toMatchObject({ contentType: 'EPISODE', rootId: root, seriesTitle: 'Series' });
    for (const root_id of [null, undefined, 'bad', 42]) expect(parseTitle({ ...row, root_id })).toBeNull();
    expect(parseTitle({ ...row, series_title: 'x'.repeat(170) })?.seriesTitle).toHaveLength(160);
    expect(parseTitle({ ...row, content_type: 'FILM', root_id: 'bad' })?.rootId).toBeNull();
});
test('detail keeps server season and flat order, metadata, free-only eligibility and raw access', () => {
    const detail = parseTitleDetail(body)!;
    expect(detail.title.language).toBe('en-GB');
    expect(detail.title.aiDisclosures).toEqual(['generated_video', 'generated_music']);
    expect(detail.seasons.map(s => [s.id, s.position, s.title])).toEqual([['s2', 2, 'Second season'], ['s1', 1, 'First season']]);
    expect(detail.episodes.map(e => e.id)).toEqual([three, one, two]);
    expect(detail.seasons[1].episodes[0]).toMatchObject({ synopsis: 'First synopsis', access: 'free', reason: null, watchable: true });
    expect(detail.episodes[2]).toMatchObject({ synopsis: 'Second synopsis', access: 'locked', reason: 'pass_ceiling', watchable: false });
    for (const language of ['EN', 'en-gb', 'english', '', null]) expect(parseTitle({ ...row, language })?.language).toBeNull();
    expect(accessLabel(detail.episodes[1])).toBe('Free');
    expect(accessLabel(detail.episodes[2])).toBe('Cinema Pass limit reached this month');
    expect(accessLabel({ ...detail.episodes[2], reason: null })).toBeNull();
    expect(typeLabel('EPISODE')).toBe('Episode');
});
test('poster order and pinned curated map match the web source', () => {
    const source: string = readFileSync(resolve(__dirname, '../../../app/veyrnox/social-cinema/cinemaPosters.js'), 'utf8');
    const map = Object.fromEntries([...source.matchAll(/'([a-f0-9-]+)': '([^']+)'/g)].map(m => [m[1], m[2]]));
    expect(CURATED_POSTERS).toEqual(map);
    const curated = Object.keys(map)[0].toUpperCase();
    expect(posterSources(curated)).toEqual([API_BASE + map[curated.toLowerCase()], posterUrl(curated)]);
    expect(posterSources(one)).toEqual([posterUrl(one)]);
    expect(posterSources('constructor')).toEqual([posterUrl('constructor')]);
});
test('discovery routes episodes directly to Watch and roots to the title', () => {
    expect(discoveryTarget(parseTitle(row)!)).toEqual({ pathname: '/cinema/watch/[id]', params: { id: one, title: 'Episode', series: root } });
    expect(discoveryTarget(parseTitle({ ...row, content_type: 'FILM' })!)).toEqual({ pathname: '/cinema/[id]', params: { id: one } });
});
test('Next is immediate in season/position order, never skipping locks or a missing current episode', () => {
    const detail = parseTitleDetail(body)!;
    const locks = parseEpisodeLocks(body);
    expect(nextCandidate(detail, one, locks)).toBeNull();
    expect(nextCandidate(detail, two, locks)?.id).toBe(three);
    expect(nextCandidate(detail, three, locks)).toBeNull();
    expect(nextCandidate(detail, 'absent', locks)).toBeNull();
    expect(nextCandidate(detail, one, new Map([[two, null]]))?.id).toBe(two);
});
test('comments preview shows at most two resolved public comments', async () => {
    const request = jest.fn().mockResolvedValue({ comments: [one, two, three].map(id => ({ id, body: id, display_name: 'A' })) });
    expect(await commentsPreview(api(request), root)).toMatchObject({ kind: 'ok', comments: [{ id: one }, { id: two }] });
    request.mockResolvedValue({ comments: [] });
    expect(await commentsPreview(api(request), root)).toEqual({ kind: 'ok', comments: [] });
});
test.each([
    [new ApiError(503, 'comments_not_open'), { kind: 'hidden' }],
    [new ApiError(404, 'content_not_found'), { kind: 'hidden' }],
    [new ApiError(403, 'forbidden'), { kind: 'hidden' }],
    [new ApiError(0, 'network'), { kind: 'error', key: 'comments.err.network' }],
    [new ApiError(429, 'rate_limited'), { kind: 'error', key: 'comments.err.rate' }],
    [new ApiError(500, 'server'), { kind: 'error', key: 'common.error' }],
    [new Error('offline'), { kind: 'error', key: 'common.error' }],
])('comments preview maps thrown read %s', async (error, expected) => {
    expect(await commentsPreview(api(jest.fn().mockRejectedValue(error)), root)).toEqual(expected);
});
test.each([
    [new ApiError(400, 'invalid_query'), true], [new ApiError(400, 'other'), false],
    [new ApiError(503, 'analytics_not_open'), false], [new ApiError(403, 'forbidden'), false],
    [new ApiError(401, 'signin'), false], [new ApiError(0, 'network'), false], [new Error('network'), false],
])('analytics probe only accepts the expected pre-validation response %s', async (error, expected) => {
    const request = jest.fn().mockRejectedValue(error);
    expect(await creatorAnalyticsOpen(api(request))).toBe(expected);
    expect(request).toHaveBeenCalledWith('/api/v1/cinema/creator-analytics');
});
test('analytics probe rejects success and title picker preserves server order of own published public roots', async () => {
    expect(await creatorAnalyticsOpen(api(jest.fn().mockResolvedValue({})))).toBe(false);
    const title = { id: one, lifecycle_status: 'PUBLISHED', visibility: 'PUBLIC', parent_id: null };
    const request = jest.fn().mockResolvedValue({ content: [title, { ...title, id: two, parent_id: root }, { ...title, lifecycle_status: 'DRAFT' }, { ...title, visibility: 'PRIVATE' }, { ...title, id: three }] });
    expect((await ownPublishedTitles(api(request))).map(t => t.id)).toEqual([one, three]);
    expect(request).toHaveBeenCalledWith('/api/v1/cinema/content');
});
test.each(['qualified', 'under_review', 'rejected', 'unknown', null])('story poll choice status %s', status => {
    const polls = parseStoryPolls({ polls: [{ id: root, options: [{ id: one }, { id: two }], my_choice: { option_id: one, status } }] });
    expect(polls[0].myOptionId).toBe(one);
    expect(polls[0].myChoiceStatus).toBe(status === 'unknown' ? null : status);
});
