import { isAlbum, isAlbumTrack, isPublicAlbum } from '../src/lib/music/validateAlbums';

const id = '11111111-1111-4111-8111-111111111111';
const publicationId = '22222222-2222-4222-8222-222222222222';
const slug = 'a'.repeat(24);
const date = '2026-11-23T12:34:56.123456+00:00';
const track = { publication_id: publicationId, slug, title: 'First light', position: 1 };
const album = { id, title: 'Debut', album_type: 'album' as const, artwork_asset_id: null, description: '', has_artwork: false, slug: null, status: 'draft' as const, revision: 0, published_at: null, tracks: [track] };
const publicAlbum = { ...album, slug, status: 'published' as const, published_at: date, handle: 'artist_one', display_name: 'Artist One', creator_id: id,
    tracks: [{ ...track, audio_url: `/api/music/public/${slug}/asset` }] };

test('validates complete owner and public album shapes without Date.parse', () => {
    const parse = jest.spyOn(Date, 'parse').mockReturnValue(NaN);
    try { expect(isAlbum(album)).toBe(true); expect(isPublicAlbum(publicAlbum)).toBe(true); expect(parse).not.toHaveBeenCalled(); }
    finally { parse.mockRestore(); }
});

test('public artwork is bound to the album slug and presence bit', () => {
    const artwork=`/api/music/albums/${slug}/artwork`;
    expect(isPublicAlbum({...publicAlbum,has_artwork:true,artwork_url:artwork})).toBe(true);
    expect(isPublicAlbum({...publicAlbum,has_artwork:true})).toBe(false);
    expect(isPublicAlbum({...publicAlbum,artwork_url:artwork})).toBe(false);
});

test('owner album lifecycle accepts unpublished and blocked releases with durable public identity', () => {
    const released = { ...album, slug, published_at: date, revision: 2 };
    expect(isAlbum({ ...released, status: 'published' })).toBe(true);
    expect(isAlbum({ ...released, status: 'unpublished' })).toBe(true);
    expect(isAlbum({ ...released, status: 'blocked' })).toBe(true);
    expect(isAlbum({ ...album, status: 'unpublished' })).toBe(false);
});

test.each([
    ['id', 'bad'], ['title', ''], ['album_type', 'mixtape'], ['artwork_asset_id', 'bad'], ['description', 'x'.repeat(501)], ['has_artwork', 1], ['revision', -1],
    ['status', 'published'], ['slug', slug], ['published_at', date], ['tracks', [{ ...track, position: 0 }]],
])('owner albums reject malformed %s', (field, value) => expect(isAlbum({ ...album, [field]: value })).toBe(false));

test.each([
    ['published_at', '2026-02-30T00:00:00Z'], ['handle', 'Bad Handle'], ['creator_id', 'bad'],
    ['display_name', 'x'.repeat(81)], ['tracks', []], ['tracks', [{ ...track, audio_url: 'https://secret.test/asset' }]],
    ['tracks', [track]],
    ['tracks', [{ ...track, audio_url: `/api/music/public/${slug}/asset?token=secret` }]],
])('public albums reject malformed %s = %p', (field, value) => expect(isPublicAlbum({ ...publicAlbum, [field]: value })).toBe(false));

test('tracks are ordered, unique, bounded and reject control characters', () => {
    const first = { ...track, audio_url: `/api/music/public/${track.slug}/asset` };
    const second = { ...track, publication_id: '33333333-3333-4333-8333-333333333333', slug: 'b'.repeat(24), position: 2,
        audio_url: `/api/music/public/${'b'.repeat(24)}/asset` };
    expect(isPublicAlbum({ ...publicAlbum, tracks: [first, second] })).toBe(true);
    expect(isPublicAlbum({ ...publicAlbum, tracks: [second, first] })).toBe(false);
    expect(isPublicAlbum({ ...publicAlbum, tracks: [first, { ...second, publication_id: publicationId }] })).toBe(false);
    expect(isAlbumTrack({ ...track, title: 'bad\nname' })).toBe(false);
});
