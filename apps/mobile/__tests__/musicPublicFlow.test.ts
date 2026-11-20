import { ApiError, type ApiClient } from '../src/lib/api';
import { createPublicFlow } from '../src/lib/music/publicFlow';
import { createPublicSession } from '../src/lib/music/publicSession';
import { actor, commenter, commentId, nextId, slug, track, best, social, comments, clone, deferred } from './fixtures/musicPublic';
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
const request = jest.fn(), api = { request } as unknown as ApiClient;
let session = createPublicSession();
const flows: ReturnType<typeof createPublicFlow>[] = [];
const flowFor = (kind: 'track' | 'explore' = 'track') => { const f = createPublicFlow(api, session, kind === 'track' ? { kind, slug } : { kind }); flows.push(f); return f; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
    session = createPublicSession(); request.mockReset();
    request.mockImplementation(async (path: string) => path.includes('/social?') ? { social } : path.includes('best-of') ? best : track);
});
afterEach(() => { flows.splice(0).forEach(f => f.dispose()); });
test('explore loading, empty, error, retry, gone and off states', async () => {
    const f = flowFor('explore'); expect(f.snapshot().status).toBe('loading');
    request.mockRejectedValueOnce(new ApiError(0, 'network')); await f.load(); expect(f.snapshot().status).toBe('error');
    request.mockResolvedValueOnce({ playlists: [] }); await f.load(); expect(f.snapshot()).toMatchObject({ status: 'on', data: { playlists: [] } });
    request.mockRejectedValueOnce(new ApiError(404, 'not_found')); await f.load(); expect(f.snapshot().status).toBe('gone');
    request.mockRejectedValueOnce(new ApiError(404, 'blocks_unavailable')); await f.load(); expect(f.snapshot()).toMatchObject({ status: 'off', data: null });
});
test('ownership stays unknown until social succeeds; social off keeps listening', async () => {
    request.mockImplementation(async path => path.includes('/social?') ? Promise.reject(new ApiError(404, 'not_found')) : track);
    const f = flowFor(); await f.load(); expect(f.snapshot()).toMatchObject({ status: 'on', social: null, data: track });
});
test('acknowledged creator block immediately replaces track and filters all explore rows; stale track cannot return', async () => {
    const f = flowFor(), explore = flowFor('explore'); await f.load(); await explore.load();
    const late = deferred<unknown>(); request.mockReturnValueOnce(late.promise); const load = f.load();
    session.acknowledge(actor, true, 'Creator');
    expect(f.snapshot().data).toEqual({ blocked: { creator_id: actor, display_name: 'Creator One' } });
    expect(explore.snapshot().data).toEqual({ playlists: [{ genre: 'pop', tracks: [] }] });
    late.resolve(track); await load; expect(f.snapshot().data).toHaveProperty('blocked');
});
test('all loaded pages remove non-creator commenter and clear reply synchronously; unblock revalidates', async () => {
    const f = flowFor(); await f.load();
    request.mockImplementation(async path => path.includes('/social?') ? { social } : path.includes('/comments?')
        ? { comments: { ...comments, comments: [{ ...comments.comments[0], id: nextId }], next_cursor: null } } : track);
    await f.more();
    const before = f.snapshot().data; expect(before && 'track' in before && before.comments?.comments).toHaveLength(2);
    f.reply(comments.comments[0]); session.acknowledge(commenter, true, 'Listener');
    const after = f.snapshot().data;
    expect(after && 'track' in after && after.comments?.comments).toHaveLength(0);
    expect(f.snapshot()).toMatchObject({ reply: null, notice: 'replyRemoved' });
    f.focus(); await flush(); session.acknowledge(commenter, false); await flush();
    const restored = f.snapshot().data; expect(restored && 'track' in restored && restored.comments?.comments[0].author_id).toBe(commenter);
    expect(restored && 'track' in restored && restored.comments?.comments).toHaveLength(2);
});
test('block-from-comment uses opaque author id and immediately removes it', async () => {
    const f = flowFor(); await f.load();
    request.mockImplementation(async (path, init) => init?.method === 'POST' ? { actor_id: commenter, blocked: true, already: false }
        : path.endsWith('/blocks') ? { blocks: [{ actor_id: commenter, display_name: 'Listener', created_at: '2026-11-20T00:00:00Z' }] } : track);
    await f.block(commenter, true, 'Listener');
    const data = f.snapshot().data; expect(data && 'track' in data && data.comments?.comments).toEqual([]);
    expect(JSON.parse(request.mock.calls.find(([, init]) => init?.method === 'POST')[1].body)).toEqual({ actor_id: commenter });
});
test('late page after block never appends removed comments', async () => {
    const f = flowFor(); await f.load(); const late = deferred<unknown>();
    request.mockImplementation(path => path.includes('/comments?') ? late.promise : Promise.resolve(track));
    const more = f.more(); await flush(); session.acknowledge(commenter, true); late.resolve({ comments }); await more;
    const data = f.snapshot().data; expect(data && 'track' in data && data.comments?.comments).toHaveLength(0);
});
test('switch off while paging clears track, rails, comments, reply and every open surface', async () => {
    const f = flowFor(), other = flowFor('explore'); await f.load(); await other.load(); f.reply(comments.comments[0]);
    const invalid = clone(comments) as any; delete invalid.comments[0].author_id;
    request.mockResolvedValueOnce(track).mockResolvedValueOnce({ comments: invalid }).mockRejectedValueOnce(new ApiError(404, 'blocks_unavailable'));
    await f.more(); expect(f.snapshot()).toMatchObject({ status: 'off', data: null, social: null, reply: null });
    expect(other.snapshot()).toMatchObject({ status: 'off', data: null });
});
test('pending submit survives blur, replay submits one payload and shows pending; withdraw own', async () => {
    const f = flowFor(); await f.load(); request.mockRejectedValueOnce(new ApiError(0, 'network'));
    const write = { kind: 'submit' as const, slug, body: 'Hello', parent_id: commentId };
    await f.write(write); const pending = f.attempts.snapshot(); f.blur(); expect(f.attempts.snapshot()).toBe(pending);
    request.mockResolvedValueOnce({ id: commentId, status: 'pending', idempotent: true }); await f.write(pending!.write);
    expect(f.snapshot().notice).toBe('pending'); expect(f.attempts.snapshot()).toBeNull();
    request.mockResolvedValueOnce({ id: commentId, status: 'withdrawn', idempotent: false }); await f.write({ kind: 'withdraw', comment_id: commentId });
    expect(f.snapshot().notice).toBe('saved');
});
test('429 report retains payload and blocks retry until Retry-After; own_song clears it', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
        const f = flowFor(); await f.load(); request.mockRejectedValueOnce(new ApiError(429, 'rate_limited', { retryAfterSeconds: 3 }));
        const w = { kind: 'report_song' as const, slug, category: 'other' as const, details: 'Reason' };
        await f.write(w); expect(f.snapshot().retryAt).toBe(4000); const calls = request.mock.calls.length; await f.write(w); expect(request).toHaveBeenCalledTimes(calls);
        jest.spyOn(Date, 'now').mockReturnValue(4001); request.mockRejectedValueOnce(new ApiError(409, 'own_song')); await f.write(w); expect(f.attempts.snapshot()).toBeNull();
    } finally { jest.restoreAllMocks(); }
});
test('reaction clear and follow/unfollow reuse ambiguous attempt; account change clears all', async () => {
    const f = flowFor(); await f.load(); request.mockResolvedValueOnce({ social: { ...social, my_reaction: 'fire' }, idempotent: false });
    await f.write({ kind: 'reaction', slug, reaction: 'fire' }); expect(f.snapshot().social?.my_reaction).toBe('fire');
    request.mockResolvedValueOnce({ social, idempotent: false }); await f.write({ kind: 'reaction', slug, reaction: null }); expect(f.snapshot().social?.my_reaction).toBeNull();
    request.mockRejectedValueOnce(new ApiError(503, 'temporarily_unavailable')); await f.write({ kind: 'follow', handle: 'creator_one', following: true });
    const pending = f.attempts.snapshot()!; request.mockResolvedValueOnce({ social: { ...social, following: true }, idempotent: true });
    await f.write(pending.write); expect(f.snapshot().social?.following).toBe(true);
    request.mockResolvedValueOnce({ social, idempotent: false }); await f.write({ kind: 'follow', handle: 'creator_one', following: false }); expect(f.snapshot().social?.following).toBe(false);
    session.reset(); expect(f.snapshot()).toMatchObject({ data: null, social: null, reply: null }); expect(f.attempts.snapshot()).toBeNull();
});

test.each([
    [{ kind: 'reaction', slug, reaction: 'fire' }, 'not_found', 'public_social_unavailable'],
    [{ kind: 'follow', handle: 'creator_one', following: true }, 'not_found', 'public_social_unavailable'],
    [{ kind: 'withdraw', comment_id: commentId }, 'not_found', 'public_comment_gone'],
    [{ kind: 'report_song', slug, category: 'other', details: 'Reason' }, 'music_song_reports_unavailable', 'public_reporting_unavailable'],
] as const)('definitive $1 unlocks the attempt and refreshes controls', async (write, code, message) => {
    const f = flowFor(); await f.load(); request.mockClear();
    request.mockRejectedValueOnce(new ApiError(404, code));
    expect(await f.write(write)).toBe(false);
    expect(f.attempts.snapshot()).toBeNull(); expect(f.snapshot()).toMatchObject({ busy: false, error: { code: message } });
    expect(request.mock.calls.map(([p]) => p)).toEqual([
        `/api/v1/music/${write.kind === 'reaction' || write.kind === 'follow' ? 'social' : 'comments'}`,
        `/api/v1/music/explore/tracks/${slug}`, `/api/v1/music/social?slug=${slug}`,
    ]);
});
test('block filters discovery locally and only revalidates an affected comment thread, without social fan-out', async () => {
    const f = flowFor(), explore = flowFor('explore'); f.focus(); explore.focus(); await flush(); request.mockClear();
    session.acknowledge(commenter, true); await flush();
    expect(request.mock.calls.map(([p]) => p)).toEqual([`/api/v1/music/explore/tracks/${slug}`]);
    request.mockClear(); session.acknowledge('99999999-9999-4999-8999-999999999999', true); await flush();
    expect(request).not.toHaveBeenCalled();
    session.acknowledge(actor, true); await flush(); expect(request).not.toHaveBeenCalled();
    expect(f.snapshot().data).toHaveProperty('blocked');
    expect(explore.snapshot().data).toEqual({ playlists: [{ genre: 'pop', tracks: [] }] });
    session.acknowledge(actor, false); await flush();
    expect(request.mock.calls.map(([p]) => p).sort()).toEqual([
        '/api/v1/music/explore/best-of', `/api/v1/music/explore/tracks/${slug}`, `/api/v1/music/social?slug=${slug}`,
    ].sort());
});
test('paged comment retains its exact cursor for the report route', async () => {
    const f = flowFor(); await f.load();
    request.mockResolvedValueOnce(track).mockResolvedValueOnce({ comments: { ...comments, comments: [{ ...comments.comments[0], id: nextId }], next_cursor: null } });
    await f.more(); expect(f.commentCursor(commentId)).toBeUndefined(); expect(f.commentCursor(nextId)).toBe(comments.next_cursor);
});

test('unblock revalidates a mirror-blocked creator even if the block-list read never succeeded', async () => {
    request.mockResolvedValueOnce({ blocked: { creator_id: actor, display_name: 'Creator' } });
    const f = flowFor(); f.focus(); await flush();
    expect(f.snapshot().data).toHaveProperty('blocked'); expect(session.snapshot().blocks).toEqual([]);
    request.mockClear(); session.acknowledge(actor, false); await flush();
    expect(f.snapshot().data).toHaveProperty('track');
    expect(request.mock.calls.map(([p]) => p)).toEqual([`/api/v1/music/explore/tracks/${slug}`, `/api/v1/music/social?slug=${slug}`]);
});
