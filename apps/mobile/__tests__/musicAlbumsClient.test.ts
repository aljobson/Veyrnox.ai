import { ApiError, type ApiClient } from '../src/lib/api';
import { convertPlaylistToAlbum, createAlbum, discoverAlbums, getAlbumArtworkUrl, getPublicAlbum, getPublicAlbumPage, listAlbumArtwork, listAlbums, listAlbumWorkspace, patchAlbum, reportAlbum } from '../src/lib/music/albumsClient';

const id = '11111111-1111-4111-8111-111111111111';
const publicationId = '22222222-2222-4222-8222-222222222222';
const playlistId = '33333333-3333-4333-8333-333333333333';
const slug = 'a'.repeat(24), requestNonce = 'album.test-12345';
const track = { publication_id: publicationId, slug, title: 'First light', position: 1 };
const album = { id, title: 'Debut', album_type: 'album' as const, artwork_asset_id: null, description: '', has_artwork: false, slug: null, status: 'draft' as const, revision: 0, published_at: null, tracks: [track] };
const published = { ...album, slug, status: 'published' as const, revision: 1, published_at: '2026-11-23T12:34:56Z' };
const publicAlbum = { ...published, handle: 'artist_one', display_name: 'Artist One', creator_id: id,
    tracks: [{ ...track, audio_url: `/api/music/public/${slug}/asset` }] };
const trackOption = { publication_id: publicationId, song_id: id, slug, title: 'First light' };
const request = jest.fn(), api = { request } as unknown as ApiClient;
beforeEach(() => request.mockReset());

test('create, conversion and report send exact server bodies', async () => {
    request.mockResolvedValueOnce({ album }).mockResolvedValueOnce({ album, included_count: 1, excluded_count: 2 }).mockResolvedValueOnce({ status: 'reported' });
    await createAlbum(api, 'Debut', 'album', '', null, requestNonce);
    await convertPlaylistToAlbum(api, playlistId, 'Debut', 'album', '', null, requestNonce);
    await reportAlbum(api, slug, '  Rights issue  ', requestNonce);
    expect(request.mock.calls.map(([path, init]) => [path, JSON.parse(init.body)])).toEqual([
        ['/api/v1/music/albums', { title: 'Debut', album_type: 'album', description: '', artwork_asset_id: null, idempotency_key: requestNonce }],
        ['/api/v1/music/albums/from-playlist', { playlist_id: playlistId, title: 'Debut', album_type: 'album', description: '', artwork_asset_id: null, idempotency_key: requestNonce }],
        ['/api/v1/music/album-reports', { slug, category: 'other', details: 'Rights issue', idempotency_key: requestNonce }],
    ]);
});

test('every patch action sends the exact immutable revision and request nonce', async () => {
    request.mockResolvedValue({ album: published });
    const patches = [
        { action: 'update' as const, expected_revision: 0, title: 'New name', album_type: 'ep' as const, description: 'Description', artwork_asset_id: null },
        { action: 'replace' as const, expected_revision: 1, publication_ids: [publicationId] },
        { action: 'publish' as const, expected_revision: 2 }, { action: 'unpublish' as const, expected_revision: 3 },
    ];
    for (const patch of patches) await patchAlbum(api, id, patch, requestNonce);
    request.mockResolvedValueOnce({ deleted: true }); await patchAlbum(api, id, { action: 'delete', expected_revision: 4 }, requestNonce);
    expect(request.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
        ...patches.map(patch => ({ ...patch, idempotency_key: requestNonce })),
        { action: 'delete', expected_revision: 4, idempotency_key: requestNonce },
    ]);
});

test('a redacted retry after deletion resolves as a removed album', async () => {
    request.mockRejectedValueOnce(new ApiError(410, 'album_deleted', { redacted: true, idempotent: true }));
    await expect(patchAlbum(api, id, { action: 'update', expected_revision: 2, title: 'Private title', album_type: 'single', description: 'Private description', artwork_asset_id: null }, requestNonce)).resolves.toBeNull();
});

test('lists, discovery and public reads fail closed on malformed or duplicate data', async () => {
    request.mockResolvedValueOnce({ albums: [album] }); expect(await listAlbums(api)).toEqual([album]);
    request.mockResolvedValueOnce({ albums: [album], available_tracks: [trackOption] });
    expect(await listAlbumWorkspace(api)).toEqual({ albums: [album], availableTracks: [trackOption] });
    request.mockResolvedValueOnce({ albums: [publicAlbum] }); expect(await discoverAlbums(api)).toEqual([publicAlbum]);
    request.mockResolvedValueOnce({ album: publicAlbum }); expect(await getPublicAlbum(api, slug)).toEqual(publicAlbum);
    const blocked={blocked:{creator_id:id,display_name:'Artist One'}};
    request.mockResolvedValueOnce(blocked);expect(await getPublicAlbumPage(api,slug)).toEqual(blocked);
    for (const value of [{ albums: [album, album] }, { albums: [{ ...publicAlbum, tracks: [] }] }, { album: { ...publicAlbum, published_at: 'today' } }]) {
        request.mockResolvedValueOnce(value);
        const call = 'album' in value ? getPublicAlbum(api, slug) : value.albums[0] === album ? listAlbums(api) : discoverAlbums(api);
        await expect(call).rejects.toMatchObject({ code: 'bad_response' });
    }
    request.mockResolvedValueOnce({ albums: [album], available_tracks: [trackOption, trackOption] });
    await expect(listAlbumWorkspace(api)).rejects.toMatchObject({ code: 'bad_response' });
});

test('artwork choices require exact safe asset and job references', async () => {
    const art={asset_id:publicationId,job_id:playlistId,created_at:'2026-11-23T12:34:56Z',image_url:`/api/v1/jobs/${playlistId}/asset`};
    request.mockResolvedValueOnce({images:[art],covers:[]});expect(await listAlbumArtwork(api)).toEqual([art]);
    request.mockResolvedValueOnce({images:[{...art,image_url:'https://private.test/image'}],covers:[]});
    await expect(listAlbumArtwork(api)).rejects.toMatchObject({code:'bad_response'});
});

test('public album artwork uses the authenticated viewer-filtered endpoint', async () => {
    request.mockResolvedValueOnce({url:'https://signed.test/album-art'});
    await expect(getAlbumArtworkUrl(api,slug)).resolves.toBe('https://signed.test/album-art');
    expect(request).toHaveBeenCalledWith(`/api/v1/music/explore/albums/${slug}/artwork`);
    request.mockResolvedValueOnce({url:'/api/music/albums/public-art'});
    await expect(getAlbumArtworkUrl(api,slug)).rejects.toMatchObject({code:'bad_response'});
});

test('invalid local inputs never reach the network', async () => {
    await expect(createAlbum(api, '', 'album', '', null, requestNonce)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(patchAlbum(api, id, { action: 'replace', expected_revision: 0, publication_ids: [publicationId, publicationId] }, requestNonce)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(reportAlbum(api, slug, 'no', requestNonce)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
});

test.each([
    {}, { album: {} }, { album, included_count: -1, excluded_count: 0 }, { album, included_count: 1, excluded_count: -1 },
])('malformed conversion response %p fails closed', async value => {
    request.mockResolvedValueOnce(value);
    await expect(convertPlaylistToAlbum(api, playlistId, 'Debut', 'album', '', null, requestNonce)).rejects.toMatchObject({ code: 'bad_response' });
});
