import { ApiError, type ApiClient } from '../src/lib/api';
import { getBestOf, getPublicTrack, getPublicProfile, getSocial, getComments, writePublic, countPlay } from '../src/lib/music/publicClient';
import { createPublicAttempts } from '../src/lib/music/publicAttempts';
import { changeBlock, getBlocks } from '../src/lib/music/blocksClient';
import { createPublicSession } from '../src/lib/music/publicSession';
import { isMusicOff } from '../src/lib/music/probe';
import type { PublicWrite } from '../src/lib/music/publicTypes';
import { actor, commenter, commentId, creator, date, slug, best, profile, track, social, comments, clone, deferred } from './fixtures/musicPublic';
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
const request = jest.fn(), api = { request } as unknown as ApiClient;
let session = createPublicSession();
beforeEach(() => { request.mockReset(); session = createPublicSession(); });
test('only authenticated mirrors carry content, and social has exact query', async () => {
    request.mockResolvedValueOnce(best).mockResolvedValueOnce(track).mockResolvedValueOnce(profile).mockResolvedValueOnce({ social });
    await getBestOf(api, session); await getPublicTrack(api, session, slug); await getPublicProfile(api, session, creator.handle); await getSocial(api, { slug });
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/v1/music/explore/best-of', `/api/v1/music/explore/tracks/${slug}`, `/api/v1/music/explore/creators/${creator.handle}`, `/api/v1/music/social?slug=${slug}`]);
});
test('not_found is gone for mirrors, never global Music off; blocks_unavailable clears the surface', async () => {
    const missing = new ApiError(404, 'not_found'); expect(isMusicOff(missing)).toBe(false);
    request.mockRejectedValueOnce(missing); expect(await getPublicTrack(api, session, slug)).toEqual({ state: 'gone' });
    request.mockRejectedValueOnce(new ApiError(404, 'blocks_unavailable')); expect(await getBestOf(api, session)).toEqual({ state: 'off' });
    expect(session.snapshot().availability).toBe('off'); expect(request).toHaveBeenCalledTimes(2);
    expect(isMusicOff(new ApiError(404, 'blocks_unavailable'))).toBe(true);
});
test('every page revalidates mirror both before and after and uses before cursor', async () => {
    request.mockResolvedValueOnce(track).mockResolvedValueOnce({ comments }).mockResolvedValueOnce(track);
    expect(await getComments(api, session, slug, commentId)).toEqual(comments);
    expect(request.mock.calls.map(([path]) => path)).toEqual([`/api/v1/music/explore/tracks/${slug}`, `/api/v1/music/comments?slug=${slug}&before=${commentId}`, `/api/v1/music/explore/tracks/${slug}`]);
});
test('switch off between paging and mirror revalidation rejects unfiltered 200', async () => {
    const unfiltered = clone(comments) as any; delete unfiltered.comments[0].author_id;
    request.mockResolvedValueOnce(track).mockResolvedValueOnce({ comments: unfiltered }).mockRejectedValueOnce(new ApiError(404, 'blocks_unavailable'));
    await expect(getComments(api, session, slug)).rejects.toMatchObject({ code: 'blocks_unavailable' });
    expect(session.snapshot().availability).toBe('off');
});
test('malformed first page revalidates, never accepts the page', async () => {
    const invalid = clone(track) as any; delete invalid.comments.comments[0].author_id;
    request.mockResolvedValueOnce(invalid).mockResolvedValueOnce(track);
    await expect(getPublicTrack(api, session, slug)).rejects.toMatchObject({ code: 'bad_response' }); expect(request).toHaveBeenCalledTimes(2);
});
const writes: PublicWrite[] = [
    { kind: 'reaction', slug, reaction: 'fire' }, { kind: 'reaction', slug, reaction: null }, { kind: 'follow', handle: creator.handle, following: true },
    { kind: 'follow', handle: creator.handle, following: false }, { kind: 'submit', slug, body: 'Hello', parent_id: commentId, at_seconds: 10 },
    { kind: 'withdraw', comment_id: commentId }, { kind: 'report', comment_id: commentId, category: 'abuse', details: 'Reason' },
    { kind: 'report_song', slug, category: 'rights', details: 'Reason' },
];
test.each(writes)('exact payload for $kind', async write => {
    const socialWrite = write.kind === 'follow' || write.kind === 'reaction';
    request.mockResolvedValue(socialWrite ? { social, idempotent: false } : write.kind === 'report_song' ? { status: 'reported' }
        : { id: commentId, status: write.kind === 'submit' ? 'pending' : write.kind === 'withdraw' ? 'withdrawn' : 'reported', idempotent: false });
    await writePublic(api, write, 'music.public.test-12345');
    const { kind, ...rest } = write;
    expect(request).toHaveBeenCalledWith(`/api/v1/music/${socialWrite ? 'social' : 'comments'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(socialWrite ? {} : { action: kind }), ...rest, idempotency_key: 'music.public.test-12345' }),
    });
});
test.each(['bad key', 'short', 'x'.repeat(121)])('invalid key %s never sends', async key => {
    await expect(writePublic(api, writes[0], key)).rejects.toMatchObject({ code: 'invalid_request' }); expect(request).not.toHaveBeenCalled();
});
test('count play has exactly action and slug, no key', async () => {
    request.mockResolvedValue({ counted: true }); expect(await countPlay(api, slug)).toBe(true);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ action: 'count_play', slug });
});
test.each([new ApiError(0, 'network'), new ApiError(503, 'temporarily_unavailable'), new ApiError(429, 'rate_limited')])('unknown outcome keeps exact immutable payload and key', async error => {
    const attempts = createPublicAttempts(api, () => 'minted-key'); const write = { ...writes[0] };
    request.mockRejectedValueOnce(error).mockResolvedValueOnce({ social, idempotent: true });
    await expect(attempts.run(write)).rejects.toBe(error); const pending = attempts.snapshot(); expect(pending).not.toBeNull();
    await expect(attempts.run({ kind: 'reaction', slug, reaction: 'love' })).rejects.toMatchObject({ code: 'pending_result' });
    await attempts.run(pending!.write); expect(request.mock.calls[1]).toEqual(request.mock.calls[0]); expect(attempts.snapshot()).toBeNull();
});
test('definitive own_song clears; account reset discards late acceptance', async () => {
    const attempts = createPublicAttempts(api); request.mockRejectedValueOnce(new ApiError(409, 'own_song'));
    await expect(attempts.run(writes[7])).rejects.toMatchObject({ code: 'own_song' }); expect(attempts.snapshot()).toBeNull();
    const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise); const flight = attempts.run(writes[0]); await Promise.resolve();
    attempts.reset(); wait.resolve({ social, idempotent: false }); await expect(flight).rejects.toMatchObject({ code: 'account_changed' });
});
test.each([true, false])('block=%s exact API shape and naturally idempotent replay', async blocked => {
    request.mockImplementation(async (path: string, init?: RequestInit) => init ? { actor_id: actor, blocked, already: true } : { blocks: blocked ? [{ actor_id: actor, display_name: creator.display_name, created_at: date }] : [] });
    const revision = session.snapshot().revision;
    await changeBlock(api, session, actor, blocked, creator.display_name);
    expect(session.snapshot().revision).toBeGreaterThan(revision);
    expect(request.mock.calls[0]).toEqual(blocked ? ['/api/v1/music/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor_id: actor }) }]
        : [`/api/v1/music/blocks/${actor}`, { method: 'DELETE' }]);
    expect(request.mock.calls[1][0]).toBe('/api/v1/music/blocks');
});
test('late pre-block and prior-account reads cannot overwrite acknowledged state', async () => {
    const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise);
    const read = getBestOf(api, session); session.acknowledge(actor, true); wait.resolve(best);
    await expect(read).rejects.toMatchObject({ code: 'stale_read' });
    const list = deferred<unknown>(); request.mockReturnValueOnce(list.promise); const readList = getBlocks(api, session);
    session.reset(); list.resolve({ blocks: [{ actor_id: commenter, display_name: 'Other', created_at: date }] });
    await expect(readList).rejects.toMatchObject({ code: 'stale_read' }); expect(session.snapshot().blocks).toEqual([]);
});

test('late blocks_unavailable still closes the same account, but never a different account', async () => {
    const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise);
    const read = getBestOf(api, session); session.acknowledge(actor, true); wait.reject(new ApiError(404, 'blocks_unavailable'));
    expect(await read).toEqual({ state: 'off' }); expect(session.snapshot().availability).toBe('off');
    session.reset(); const old = deferred<unknown>(); request.mockReturnValueOnce(old.promise); const prior = getBestOf(api, session);
    session.reset(); session.available(); old.reject(new ApiError(404, 'blocks_unavailable'));
    await expect(prior).rejects.toMatchObject({ code: 'stale_read' }); expect(session.snapshot().availability).toBe('on');
});
