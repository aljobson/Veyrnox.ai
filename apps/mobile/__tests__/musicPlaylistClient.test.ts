import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, type ApiClient } from '../src/lib/api';
import { createPlaylist, listPlaylists, replacePlaylistSongs, setPlaylistPinned } from '../src/lib/music/playlistsClient';
import { probeMusic } from '../src/lib/music/probe';
import { playlist, created, playlistId, songId } from './fixtures/musicPlaylists';
const request = jest.fn(), api = { request } as unknown as ApiClient, key = 'playlist.test-12345';
const source = readFileSync(resolve(__dirname, '../../../lib/musicPlaylists.js'), 'utf8').replace(/^import .*;$/m, '').replace(/export /g, '');
const parsers = new Function('isUuid', `${source}; return {parsePlaylistCreate,parsePlaylistPatch};`)((s: string) => /^[0-9a-f-]{36}$/i.test(s));
beforeEach(() => request.mockReset());
test('exact create body matches server parser; 201 and 200 replay body are identical', async () => {
    for (const status of [201, 200]) {
        request.mockResolvedValueOnce({ playlist: created });
        expect(await createPlaylist(api, 'Evening', key)).toEqual(created);
        const [path, init] = request.mock.calls.at(-1)!;
        expect(path).toBe('/api/v1/music/playlists'); expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ title: 'Evening', idempotency_key: key });
        expect(parsers.parsePlaylistCreate(JSON.parse(init.body)).ok).toBe(true); void status;
    }
});
test('exact replace and pin bodies match server parsers, including empty replace', async () => {
    request.mockResolvedValue({ revision: 4, idempotent: false });
    await replacePlaylistSongs(api, playlistId, 3, [songId], key);
    await replacePlaylistSongs(api, playlistId, 4, [], key);
    await setPlaylistPinned(api, playlistId, 5, true, key);
    const bodies = request.mock.calls.map(([path, init]) => {
        expect(path).toBe(`/api/v1/music/playlists/${playlistId}`); expect(init.method).toBe('PATCH');
        const body = JSON.parse(init.body); expect(parsers.parsePlaylistPatch(body).ok).toBe(true); return body;
    });
    expect(bodies).toEqual([
        { action: 'replace', expected_revision: 3, song_ids: [songId], idempotency_key: key },
        { action: 'replace', expected_revision: 4, song_ids: [], idempotency_key: key },
        { action: 'pin', expected_revision: 5, pinned: true, idempotency_key: key },
    ]);
});
test('malformed 2xx replies fail with bad_response', async () => {
    request.mockResolvedValue({});
    for (const call of [() => listPlaylists(api), () => createPlaylist(api, 'Title', key), () => setPlaylistPinned(api, playlistId, 0, true, key)])
        await expect(call()).rejects.toMatchObject({ code: 'bad_response' });
    request.mockResolvedValue({ playlists: [playlist, {}] }); await expect(listPlaylists(api)).rejects.toMatchObject({ code: 'bad_response' });
});
test('conflict keeps current revision and off code is additive', async () => {
    request.mockRejectedValue(new ApiError(409, 'revision_conflict', { revision: 9 }));
    await expect(setPlaylistPinned(api, playlistId, 1, true, key)).rejects.toMatchObject({ status: 409, body: { revision: 9 } });
    request.mockRejectedValue(new ApiError(404, 'playlists_unavailable'));
    expect(await probeMusic(() => listPlaylists(api))).toEqual({ state: 'off', code: 'playlists_unavailable' });
    request.mockRejectedValue(new ApiError(404, 'not_found'));
    expect((await probeMusic(() => listPlaylists(api))).state).toBe('error');
});
