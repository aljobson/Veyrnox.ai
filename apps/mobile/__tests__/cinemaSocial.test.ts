import { ApiError } from '../src/lib/api';
import { withdrawComment } from '../src/lib/cinemaComments';
import { castChoice, castVote, competitionOpen, fetchWinners, isClosed, parseRetentionList, parseRetentionState, parseStoryPolls, parseVoting, parseWinners, readOf, setRetention, socialErrorKey } from '../src/lib/cinemaSocial';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const K = '33333333-3333-4333-8333-333333333333';
const res = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body }) as unknown as Response;
const recorder = (reply: unknown = {}) => {
    const calls: { path: string; init?: RequestInit }[] = [];
    return { calls, api: { request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return reply as never; } } };
};

describe('closed switches', () => {
    test('a 503 with a not-open code is closed, other failures are errors', async () => {
        expect(isClosed(new ApiError(503, 'retention_not_open'))).toBe(true);
        expect(isClosed(new ApiError(503, 'temporarily_unavailable'))).toBe(false);
        expect(isClosed(new ApiError(403, 'voting_not_open'))).toBe(false);
        expect(await readOf(async () => { throw new ApiError(503, 'story_polls_not_open'); })).toEqual({ kind: 'closed' });
        expect(await readOf(async () => { throw new ApiError(503, 'rankings_not_open'); })).toEqual({ kind: 'closed' });
        expect(await readOf(async () => { throw new ApiError(0, 'network'); })).toEqual({ kind: 'error', key: 'cinemaSocial.err.network' });
        expect(await readOf(async () => 5)).toEqual({ kind: 'ok', value: 5 });
    });
    test('typed errors map to catalog keys', () => {
        expect(socialErrorKey(new ApiError(403, 'profile_required'))).toBe('cinemaSocial.err.profile');
        expect(socialErrorKey(new ApiError(409, 'choice_already_recorded'))).toBe('cinemaSocial.err.already');
        expect(socialErrorKey(new ApiError(409, 'competition_closed'))).toBe('cinemaSocial.err.ended');
        expect(socialErrorKey(new ApiError(429, 'collection_limit'))).toBe('cinemaSocial.err.limit');
        expect(socialErrorKey(new ApiError(429, 'x'))).toBe('cinemaSocial.err.rate');
        expect(socialErrorKey(new ApiError(503, 'x'))).toBe('cinemaSocial.err.later');
        expect(socialErrorKey(new Error('x'))).toBe('common.error');
    });
});

describe('retention', () => {
    test('parses the state and the list, skipping bad rows', () => {
        expect(parseRetentionState({ saved: true, following_creator: false, following_series: true, own_creator: false, creator_id: A, series_id: null })).toEqual({ saved: true, followingCreator: false, followingSeries: true, ownCreator: false, creatorId: A, seriesId: null });
        expect(parseRetentionState(null).creatorId).toBeNull();
        const list = parseRetentionList({ items: [{ target_id: A, content_id: B, title: 'T', username: 'u', display_name: 'D' }, { target_id: 'x' }, null], next: B });
        expect(list.items).toEqual([{ targetId: A, contentId: B, title: 'T', creator: 'D' }]);
        expect(list.next).toBe(B);
    });
    test('writes with an idempotency key and the exact body', async () => {
        const { api, calls } = recorder({ active: true });
        expect(await setRetention(api, 'saved', A, true, K)).toBe(true);
        expect(calls[0].path).toBe('/api/v1/cinema/retention');
        expect(calls[0].init?.method).toBe('POST');
        expect((calls[0].init?.headers as Record<string, string>)['Idempotency-Key']).toBe(K);
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'saved', target_id: A, active: true });
        await expect(setRetention(api, 'saved', 'nope', true, K)).rejects.toBeInstanceOf(ApiError);
    });
});

describe('winners', () => {
    test('orders titles by rank and drops bad rows', () => {
        const weeks = parseWinners({ weeks: [{ id: A, name: 'Week 1', ends_at: '2026-10-01T00:00:00Z', titles: [{ id: B, title: 'Two', rank: 2 }, { id: A, title: 'One', rank: 1 }, { id: 'x', rank: 3 }] }, { id: 'bad' }] });
        expect(weeks).toHaveLength(1);
        expect(weeks[0].titles.map((t) => t.rank)).toEqual([1, 2]);
        expect(parseWinners('x')).toEqual([]);
    });
    test('the closed answer throws a closed error, not a generic one', async () => {
        await expect(fetchWinners(async () => res(503, { error: 'rankings_not_open' }))).rejects.toMatchObject({ code: 'rankings_not_open' });
        expect(await readOf(() => fetchWinners(async () => res(503, { error: 'rankings_not_open' })))).toEqual({ kind: 'closed' });
        expect((await readOf(() => fetchWinners(async () => res(200, { weeks: [] })))).kind).toBe('ok');
    });
});

describe('voting', () => {
    const NOW = Date.parse('2026-10-10T00:00:00Z');
    test('parses competitions and my vote; open only between start and end', () => {
        const [c] = parseVoting({ competitions: [{ id: A, name: 'Autumn', starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-20T00:00:00Z', qualified_votes: 4, my_vote: { id: B, status: 'under_review' } }, { id: 'x' }] });
        expect(c).toMatchObject({ name: 'Autumn', qualifiedVotes: 4, myVote: 'under_review' });
        expect(competitionOpen(c, NOW)).toBe(true);
        expect(competitionOpen(c, Date.parse('2026-10-21T00:00:00Z'))).toBe(false);
        expect(competitionOpen(c, Date.parse('2026-09-30T00:00:00Z'))).toBe(false);
    });
    test('casts one vote with the key and returns the status', async () => {
        const { api, calls } = recorder({ id: A, status: 'qualified', idempotent: false });
        expect(await castVote(api, A, B, K)).toBe('qualified');
        expect(calls[0].path).toBe('/api/v1/cinema/votes');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ content_id: A, competition_id: B });
        await expect(castVote(api, A, 'bad', K)).rejects.toBeInstanceOf(ApiError);
        expect(calls).toHaveLength(1);
    });
});

describe('story polls', () => {
    test('parses options and my choice, dropping a poll with fewer than two options', () => {
        const polls = parseStoryPolls({ polls: [
            { id: A, question: 'Q', closes_at: '2026-10-20T00:00:00Z', is_open: true, options: [{ id: A, label: 'x', votes: 1 }, { id: B, label: 'y', votes: 2 }], my_choice: { option_id: B } },
            { id: B, question: 'Q2', options: [{ id: A, label: 'only', votes: 0 }] },
        ] });
        expect(polls).toHaveLength(1);
        expect(polls[0]).toMatchObject({ isOpen: true, myOptionId: B });
    });
    test('casts a choice', async () => {
        const { api, calls } = recorder({});
        await castChoice(api, A, B, K);
        expect(calls[0].path).toBe('/api/v1/cinema/story-choices');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ poll_id: A, option_id: B });
    });
});

test('withdraws a comment with the action body and a key', async () => {
    const { api, calls } = recorder({ idempotent: true });
    expect(await withdrawComment(api as never, A, K)).toEqual({ replayed: true });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ action: 'withdraw', comment_id: A });
    await expect(withdrawComment(api as never, 'bad', K)).rejects.toBeInstanceOf(ApiError);
});

describe('audience share signal', () => {
    test('sends the share action with a key', async () => {
        const { recordShare } = await import('../src/lib/cinemaSocial');
        const { api, calls } = recorder({ ok: true });
        expect(await recordShare(api, A, K)).toBe(true);
        expect(calls[0].path).toBe('/api/v1/cinema/audience');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ action: 'share', content_id: A, kind: 'share' });
        expect((calls[0].init?.headers as Record<string, string>)['Idempotency-Key']).toBe(K);
    });
    test('never throws: a closed switch, an offline phone or a bad id is just false', async () => {
        const { recordShare } = await import('../src/lib/cinemaSocial');
        const failing = { request: async () => { throw new ApiError(503, 'audience_not_open'); } };
        expect(await recordShare(failing, A, K)).toBe(false);
        expect(await recordShare(failing, 'bad', K)).toBe(false);
    });
});
