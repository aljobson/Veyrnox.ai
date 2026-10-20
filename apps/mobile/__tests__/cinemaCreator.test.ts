import { ApiError } from '../src/lib/api';
import { bioOk, createProfile, creatorErrorKey, fetchAnalytics, nameOk, parseAnalytics, parseApplication, parseProfile, statementOk, submitApplication, usernameOk } from '../src/lib/cinemaCreator';
import { readOf } from '../src/lib/cinemaSocial';

const A = '11111111-1111-4111-8111-111111111111';
const K = '33333333-3333-4333-8333-333333333333';
const recorder = (reply: unknown = {}) => {
    const calls: { path: string; init?: RequestInit }[] = [];
    return { calls, api: { request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return reply as never; } } };
};

test('field rules mirror the route', () => {
    expect(usernameOk('studio_9')).toBe(true);
    for (const bad of ['ab', '9lives', 'Upper', 'has space', 'a'.repeat(31)]) expect(usernameOk(bad)).toBe(false);
    expect(nameOk('  ')).toBe(false);
    expect(nameOk('x'.repeat(80))).toBe(true);
    expect(nameOk('x'.repeat(81))).toBe(false);
    expect(bioOk('x'.repeat(500))).toBe(true);
    expect(bioOk('x'.repeat(501))).toBe(false);
    expect(statementOk('short')).toBe(false);
    expect(statementOk('x'.repeat(20))).toBe(true);
    expect(statementOk('x'.repeat(1001))).toBe(false);
});

test('parses a profile and an application, null when there is none', () => {
    expect(parseProfile({ profile: { username: 'st', display_name: 'Studio', bio: 'b', role: 'creator' } })).toEqual({ username: 'st', displayName: 'Studio', bio: 'b', role: 'creator' });
    expect(parseProfile({ profile: null })).toBeNull();
    expect(parseApplication({ application: { status: 'pending', statement: 's' } })).toEqual({ status: 'pending', statement: 's' });
    expect(parseApplication({ application: { status: 'weird' } })).toBeNull();
    expect(parseApplication({ application: null })).toBeNull();
});

describe('writes', () => {
    test('create a profile with the exact body and a key; refuse a bad form without a call', async () => {
        const { api, calls } = recorder({ profile_id: A });
        await createProfile(api, { username: 'studio_9', displayName: ' Studio ', bio: '' }, K);
        expect(calls[0].path).toBe('/api/v1/social-cinema/profile');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ username: 'studio_9', display_name: 'Studio', bio: '' });
        expect((calls[0].init?.headers as Record<string, string>)['Idempotency-Key']).toBe(K);
        await expect(createProfile(api, { username: 'No', displayName: 'x', bio: '' }, K)).rejects.toBeInstanceOf(ApiError);
        expect(calls).toHaveLength(1);
    });
    test('apply with a trimmed statement', async () => {
        const { api, calls } = recorder({});
        await submitApplication(api, `  ${'x'.repeat(25)}  `, K);
        expect(calls[0].path).toBe('/api/v1/creators/apply');
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ statement: 'x'.repeat(25) });
        await expect(submitApplication(api, 'short', K)).rejects.toBeInstanceOf(ApiError);
    });
});

test('closed switches read as closed, typed errors as catalog keys', async () => {
    for (const code of ['profiles_not_open', 'creators_not_open', 'analytics_not_open']) {
        expect(await readOf(async () => { throw new ApiError(503, code); })).toEqual({ kind: 'closed' });
    }
    expect(creatorErrorKey(new ApiError(409, 'username_unavailable'))).toBe('cinemaCreator.err.username');
    expect(creatorErrorKey(new ApiError(403, 'role_not_eligible'))).toBe('cinemaCreator.err.role');
    expect(creatorErrorKey(new ApiError(409, 'profile_required'))).toBe('cinemaCreator.err.needProfile');
    expect(creatorErrorKey(new ApiError(429, 'rate_limited'))).toBe('cinemaSocial.err.rate');
});

describe('analytics', () => {
    const body = { content_id: A, period_start: '2026-09-21T00:00:00Z', period_end: '2026-10-19T00:00:00Z', minimum_viewers: 5, suppressed: false, metrics: { viewers: 9, completions: 4, voters: 2, sharers: 1, commenters: 0 } };
    test('parses counts, and a suppressed answer has none', () => {
        expect(parseAnalytics(body)?.metrics).toEqual(body.metrics);
        expect(parseAnalytics({ ...body, suppressed: true, metrics: null })).toMatchObject({ metrics: null, minimumViewers: 5 });
        expect(parseAnalytics({ ...body, metrics: { viewers: 'x' } })).toBeNull();
        expect(parseAnalytics('x')).toBeNull();
    });
    test('reads with the id, refuses a bad id and an unreadable answer', async () => {
        const ok = recorder(body);
        expect((await fetchAnalytics(ok.api, A)).metrics?.viewers).toBe(9);
        expect(ok.calls[0].path).toBe(`/api/v1/cinema/creator-analytics?content_id=${A}`);
        await expect(fetchAnalytics(ok.api, 'bad')).rejects.toBeInstanceOf(ApiError);
        await expect(fetchAnalytics(recorder({}).api, A)).rejects.toMatchObject({ status: 503 });
    });
});

test('the web creator workspace address is the public https page with no account data', () => {
    const { CREATOR_WORKSPACE_URL } = jest.requireActual('../src/lib/cinemaCreator');
    expect(CREATOR_WORKSPACE_URL).toBe('https://veyrnox.ai/social-cinema/creator');
    expect(new URL(CREATOR_WORKSPACE_URL).search).toBe('');
});
