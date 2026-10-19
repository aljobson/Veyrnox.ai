import { ApiError, type ApiClient } from '../src/lib/api';
import { blockMember, blocksErrorKey, fetchBlocks, isUsername, parseBlocks, unblockMember } from '../src/lib/cinemaBlocks';

const apiWith = (impl: (path: string, init?: RequestInit) => unknown) => {
    const request = jest.fn(async (p: string, i?: RequestInit) => {
        const r = impl(p, i);
        if (r instanceof Error) throw r;
        return r;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('isUsername', () => {
    test('matches the server rule: a lowercase letter, then 2 to 29 of a-z 0-9 _', () => {
        for (const ok of ['abc', 'a_1', 'studio_9', `a${'b'.repeat(29)}`]) expect(isUsername(ok)).toBe(true);
        for (const bad of ['', 'ab', '1abc', 'Abc', 'a-b', 'a b', `a${'b'.repeat(30)}`, '../x', null, 7]) expect(isUsername(bad)).toBe(false);
    });
});

describe('parseBlocks', () => {
    test('keeps username, display name and date; drops rows without a valid username', () => {
        const rows = parseBlocks({ blocks: [{ username: 'sam_1', display_name: 'Sam', created_at: '2026-10-18T10:00:00Z' }, { username: 'Bad Name', display_name: 'x' }, { display_name: 'none' }, 'junk', { username: 'lee' }] });
        expect(rows).toEqual([
            { username: 'sam_1', displayName: 'Sam', createdAt: '2026-10-18T10:00:00Z' },
            { username: 'lee', displayName: 'lee', createdAt: null },
        ]);
    });
    test('a long display name is bounded', () => {
        expect(parseBlocks({ blocks: [{ username: 'sam', display_name: 'x'.repeat(500) }] })[0]?.displayName.length).toBeLessThanOrEqual(60);
    });
    test.each([[null], [{}], [{ blocks: 'x' }], [[]]])('%p is empty', (b) => {
        expect(parseBlocks(b)).toEqual([]);
    });
});

describe('the calls', () => {
    test('fetchBlocks reads the list', async () => {
        const { api, request } = apiWith(() => ({ blocks: [{ username: 'sam' }] }));
        expect((await fetchBlocks(api)).map((b) => b.username)).toEqual(['sam']);
        expect(request.mock.calls[0][0]).toBe('/api/v1/cinema/blocks');
    });
    test('blockMember posts the username as JSON and reports whether it was already blocked', async () => {
        const { api, request } = apiWith(() => ({ username: 'sam', blocked: true, already: true }));
        expect(await blockMember(api, 'sam')).toEqual({ already: true });
        expect(request.mock.calls[0][0]).toBe('/api/v1/cinema/blocks');
        expect(JSON.parse(String((request.mock.calls[0][1] as RequestInit).body))).toEqual({ username: 'sam' });
        expect((request.mock.calls[0][1] as RequestInit).method).toBe('POST');
    });
    test('blockMember refuses a username that is not valid without calling the server', async () => {
        const { api, request } = apiWith(() => ({}));
        await expect(blockMember(api, '../x')).rejects.toMatchObject({ status: 400, code: 'invalid_username' });
        expect(request).not.toHaveBeenCalled();
    });
    test('unblockMember is a DELETE on the encoded username', async () => {
        const { api, request } = apiWith(() => ({ username: 'sam', blocked: false, already: false }));
        expect(await unblockMember(api, 'sam')).toEqual({ already: false });
        expect(request.mock.calls[0][0]).toBe('/api/v1/cinema/blocks/sam');
        expect((request.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
    });
    test('a block with no reply body still counts as done', async () => {
        const { api } = apiWith(() => ({}));
        expect(await blockMember(api, 'sam')).toEqual({ already: false });
    });
});

describe('blocksErrorKey', () => {
    const k = (s: number, c: string) => blocksErrorKey(new ApiError(s, c, { error: c }));
    test('maps the typed answers to plain keys', () => {
        expect(k(400, 'cannot_block_self')).toBe('blocks.err.self');
        expect(k(404, 'user_not_found')).toBe('blocks.err.notFound');
        expect(k(409, 'block_limit')).toBe('blocks.err.limit');
        expect(k(403, 'account_not_found')).toBe('blocks.err.account');
        expect(k(429, 'rate_limited')).toBe('blocks.err.rate');
        expect(k(503, 'viewing_not_open')).toBe('blocks.err.notOpen');
        expect(k(503, 'temporarily_unavailable')).toBe('blocks.err.later');
        expect(k(0, 'network')).toBe('blocks.err.network');
        expect(k(400, 'invalid_username')).toBe('common.error');
        expect(blocksErrorKey(new Error('x'))).toBe('common.error');
    });
});
