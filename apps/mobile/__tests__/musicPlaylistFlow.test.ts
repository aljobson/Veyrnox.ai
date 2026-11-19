import { ApiError, type ApiClient } from '../src/lib/api';
import { createPlaylistAttempts } from '../src/lib/music/playlistAttempts';
import { createPlaylistFlow } from '../src/lib/music/playlistFlow';
import { addPlaylistSongs, removePlaylistSong, movePlaylistSong, playlistReplace } from '../src/lib/music/playlistEdits';
import { playlist, created, playlistId, songId, secondId, deferred } from './fixtures/musicPlaylists';
import { song } from './fixtures/music';
const request = jest.fn(), api = { request } as unknown as ApiClient;
beforeEach(() => request.mockReset());
test.each([new Error('offline'), new ApiError(500, 'server_error'), new ApiError(408, 'timeout')])('ambiguous write replays the immutable key and payload: %p', async error => {
    let n = 0; const attempts = createPlaylistAttempts(api, () => `key-${++n}`), write = { kind: 'create' as const, title: 'Evening' };
    request.mockRejectedValueOnce(error).mockResolvedValueOnce({ playlist: created });
    await expect(attempts.run(write)).rejects.toBe(error);
    expect(attempts.snapshot()?.key).toMatch(/^[A-Za-z0-9._-]{8,120}$/);
    await expect(attempts.run({ ...write, title: 'Different' })).rejects.toMatchObject({ code: 'pending_result' });
    await attempts.run(write);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]); expect(attempts.snapshot()).toBeNull();
    request.mockResolvedValue({ playlist: created }); await attempts.run({ ...write, title: 'Different' });
    expect(JSON.parse(request.mock.calls[2][1].body).idempotency_key).not.toBe(JSON.parse(request.mock.calls[0][1].body).idempotency_key);
});
test('definitive reject clears key and a synchronous lock prevents double submission', async () => {
    const attempts = createPlaylistAttempts(api), wait = deferred<unknown>(), write = { kind: 'create' as const, title: 'Evening' };
    request.mockReturnValue(wait.promise); const first = attempts.run(write), second = attempts.run(write);
    expect(first).toBe(second); await Promise.resolve(); expect(request).toHaveBeenCalledTimes(1);
    wait.reject(new ApiError(400, 'title_invalid')); await expect(first).rejects.toMatchObject({ code: 'title_invalid' }); expect(attempts.snapshot()).toBeNull();
});
test('reset rejects late acceptance and clears pending data', async () => {
    const attempts = createPlaylistAttempts(api), wait = deferred<unknown>(); request.mockReturnValue(wait.promise);
    const first = attempts.run({ kind: 'create', title: 'Evening' }); await Promise.resolve(); attempts.reset(); wait.resolve({ playlist: created });
    await expect(first).rejects.toMatchObject({ code: 'account_changed' }); expect(attempts.snapshot()).toBeNull();
});
test('edit helpers append uniquely, cap, remove, move, and permit empty replace', () => {
    expect(addPlaylistSongs([songId], [songId, secondId])).toEqual([songId, secondId]);
    expect(addPlaylistSongs(Array.from({ length: 100 }, (_, i) => String(i)), [songId])).toHaveLength(100);
    expect(removePlaylistSong([songId, secondId], songId)).toEqual([secondId]);
    expect(movePlaylistSong([songId, secondId], songId, 1)).toEqual([secondId, songId]);
    expect(movePlaylistSong([songId, secondId], songId, -1)).toEqual([songId, secondId]);
    expect(playlistReplace(playlist, [])).toEqual({ action: 'replace', expected_revision: 3, song_ids: [] });
});
function setup() {
    let current = playlist;
    request.mockImplementation(async (path, init) => {
        if (init) return { revision: 4, idempotent: false };
        if (path === '/api/v1/music/playlists') return { playlists: [current] };
        return { ...song, id: path.split('/').at(-1) };
    });
    let key = 0;
    return { flow: createPlaylistFlow(api, playlistId, () => `test-key-${++key}`), setCurrent: (next: typeof playlist) => { current = next; } };
}
test('create and successful pin/replace always display authoritative GET state', async () => {
    const { flow, setCurrent } = setup(); await flow.load();
    setCurrent({ ...playlist, revision: 9, pinned: true, songs: [playlist.songs[1]] });
    await flow.edit({ action: 'pin', expected_revision: 3, pinned: true });
    expect(flow.selected()).toMatchObject({ revision: 9, songs: [playlist.songs[1]] });
    request.mockResolvedValueOnce({ playlist: created }).mockResolvedValueOnce({ playlists: [{ ...playlist, revision: 12 }] });
    await flow.create('Evening'); expect(flow.selected()?.revision).toBe(12);
});
test('lost acknowledgement replay reads newer cross-client membership, never receipt revision', async () => {
    const { flow, setCurrent } = setup(); await flow.load();
    request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable'));
    await flow.edit(playlistReplace(playlist, [])); const key = flow.attempts.snapshot()?.key;
    setCurrent({ ...playlist, revision: 10, songs: [playlist.songs[1]] });
    request.mockResolvedValueOnce({ revision: 4, idempotent: true }); await flow.retry();
    expect(flow.selected()).toMatchObject({ revision: 10, songs: [playlist.songs[1]] });
    const writes = request.mock.calls.filter(([, init]) => init).map(([, init]) => JSON.parse(init.body));
    expect(writes.map(w => w.idempotency_key)).toEqual([key, key]);
});
test('conflict reloads, clears key, never automatically merges; redo uses new revision and key', async () => {
    const { flow, setCurrent } = setup(); await flow.load(); setCurrent({ ...playlist, revision: 8 });
    request.mockRejectedValueOnce(new ApiError(409, 'revision_conflict', { revision: 8 }));
    await flow.edit(playlistReplace(playlist, [])); expect(flow.snapshot().error).toBe('revision_conflict'); expect(flow.attempts.snapshot()).toBeNull();
    await flow.edit(playlistReplace(flow.selected()!, []));
    const writes = request.mock.calls.filter(([, init]) => init).map(([, init]) => JSON.parse(init.body));
    expect(writes.map(w => w.expected_revision)).toEqual([3, 8]); expect(writes[0].idempotency_key).not.toBe(writes[1].idempotency_key);
});
test('two trashed members require a complete scan and one cleanup replacement, including repeated invalid_songs', async () => {
    const { flow } = setup(); await flow.load();
    for (let i = 0; i < 2; i++) { request.mockRejectedValueOnce(new ApiError(400, 'invalid_songs')); await flow.edit(playlistReplace(playlist, [songId])); }
    request.mockRejectedValueOnce(new ApiError(404, 'not_found')).mockResolvedValueOnce({ ...song, id: secondId, lifecycle_status: 'trashed' });
    await flow.scan(); expect([...(flow.snapshot().scan?.unavailable ?? [])].sort()).toEqual([songId, secondId].sort());
    request.mockResolvedValueOnce({ revision: 4, idempotent: false }).mockResolvedValueOnce({ playlists: [{ ...playlist, songs: [], revision: 4 }] });
    await flow.removeUnavailable();
    const writes = request.mock.calls.filter(([, init]) => init).map(([, init]) => JSON.parse(init.body));
    expect(writes).toHaveLength(3); expect(writes[2].song_ids).toEqual([]); expect(flow.selected()?.songs).toEqual([]);
});
test.each([new Error('offline'), new ApiError(500, 'error'), new ApiError(429, 'rate_limited'), new ApiError(200, 'bad_response'), new ApiError(404, 'music_unavailable'), new ApiError(404, 'other_unavailable')])('any inconclusive member aborts cleanup: %p', async error => {
    const { flow } = setup(); await flow.load();
    request.mockRejectedValueOnce(new ApiError(404, 'not_found')).mockRejectedValueOnce(error);
    await flow.scan(); expect(flow.snapshot().scan).toBeNull(); await flow.removeUnavailable();
    expect(request.mock.calls.filter(([, init]) => init)).toHaveLength(0);
    await flow.load(); expect(flow.selected()?.songs).toEqual(playlist.songs);
    await flow.scan(); expect(flow.snapshot().scan?.unavailable).toEqual([]);
});
test('scan invalidated by revision change and unmount; late reads cannot publish', async () => {
    const { flow, setCurrent } = setup(); await flow.load(); request.mockRejectedValueOnce(new ApiError(404, 'not_found'));
    await flow.scan(); expect(flow.snapshot().scan).not.toBeNull(); setCurrent({ ...playlist, revision: 5 }); await flow.load();
    await flow.removeUnavailable(); expect(flow.snapshot().error).toBe('scan_stale'); expect(request.mock.calls.filter(([, init]) => init)).toHaveLength(0);
    const wait = deferred<unknown>(); request.mockReturnValue(wait.promise); const loading = flow.load(), listener = jest.fn(); flow.subscribe(listener); flow.dispose();
    wait.resolve({ playlists: [] }); await loading; expect(listener).not.toHaveBeenCalled(); expect(flow.snapshot().scan).toBeNull();
});
test('revision changing during a scan discards its result rather than submitting a reduced list', async () => {
    const { flow, setCurrent } = setup(); await flow.load();
    const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise);
    const scanning = flow.scan(); setCurrent({ ...playlist, revision: 9 }); await flow.load();
    wait.reject(new ApiError(404, 'not_found')); await scanning; expect(flow.snapshot().scan).toBeNull();
    await flow.removeUnavailable(); expect(request.mock.calls.filter(([, init]) => init)).toHaveLength(0);
});
test('dispose during a write prevents late refetches and state notifications', async () => {
    const { flow } = setup(); await flow.load(); const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise);
    const write = flow.edit(playlistReplace(playlist, [])); await Promise.resolve();
    const notify = jest.fn(); flow.subscribe(notify); flow.dispose(); const calls = request.mock.calls.length;
    wait.resolve({ revision: 4, idempotent: false }); await write;
    expect(notify).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(calls);
});
test.each([new ApiError(401, 'not_authenticated'), new ApiError(403, 'account_frozen'), new ApiError(404, 'playlists_unavailable')])('auth/off rejection after an unknown write preserves the original attempt: %p', async error => {
    const attempts = createPlaylistAttempts(api, () => 'stable-uuid'), write = { kind: 'create' as const, title: 'Evening' };
    request.mockRejectedValueOnce(new Error('lost response')).mockRejectedValueOnce(error).mockResolvedValueOnce({ playlist: created });
    await expect(attempts.run(write)).rejects.toThrow(); const pending = attempts.snapshot();
    await expect(attempts.run(write)).rejects.toBe(error); expect(attempts.snapshot()).toEqual(pending);
    await attempts.run(write); expect(request.mock.calls.map(([, init]) => JSON.parse(init.body).idempotency_key)).toEqual(Array(3).fill(pending!.key));
});
test('leaving invalidates completed and in-flight cleanup scans without disposing the flow', async () => {
    const { flow } = setup(); await flow.load(); request.mockRejectedValueOnce(new ApiError(404, 'not_found'));
    await flow.scan(); expect(flow.snapshot().scan?.unavailable).toEqual([songId]);
    flow.invalidateScan(); await flow.removeUnavailable();
    expect(flow.snapshot().scan).toBeNull(); expect(flow.snapshot().error).toBe('scan_stale');
    const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise);
    const scanning = flow.scan(); flow.invalidateScan(); wait.reject(new ApiError(404, 'not_found')); await scanning;
    expect(flow.snapshot().scan).toBeNull(); await flow.removeUnavailable();
    expect(request.mock.calls.filter(([, init]) => init)).toHaveLength(0);
    await flow.load(); expect(flow.snapshot().status).toBe('on'); flow.dispose();
});
