import { isPlaylist, isPlaylistList, isPlaylistCreate, isPlaylistReceipt, isPlaylistSong } from '../src/lib/music/validatePlaylists';
import { playlist, created, songId } from './fixtures/musicPlaylists';
test('complete list, create without created_at, and patch receipts validate', () => {
    expect(isPlaylistList({ playlists: [playlist] })).toBe(true);
    expect(isPlaylistCreate({ playlist: created })).toBe(true);
    for (const idempotent of [true, false]) expect(isPlaylistReceipt({ revision: 0, idempotent })).toBe(true);
});
test.each([
    ['id', 'bad'], ['title', ''], ['title', 'x'.repeat(81)], ['title', '\n'], ['pinned', 1],
    ['revision', -1], ['revision', 0.5], ['revision', Number.MAX_SAFE_INTEGER + 1],
    ['created_at', 'today'], ['created_at', '2026-02-30T00:00:00Z'], ['created_at', '2026-11-19T24:00:00Z'], ['created_at', '2026-11-19T12:60:00Z'],
    ['created_at', '2026-11-19T12:00:00+25:00'], ['created_at', '2026-11-19T12:00:00Z\n'], ['created_at', null], ['songs', undefined],
])('rejects playlist %s = %p', (key, value) => expect(isPlaylist({ ...playlist, [key]: value })).toBe(false));
test('list must include created_at; create may omit it', () => {
    expect(isPlaylist(created)).toBe(true); expect(isPlaylistList({ playlists: [created] })).toBe(false);
});
test.each([
    ['id', 'bad'], ['version_id', 'bad'], ['title', null], ['audio_url', 'https://example.test/asset'],
    ['audio_url', '/api/v1/jobs/bad/asset'], ['audio_url', `${playlist.songs[0].audio_url}?x=1`],
    ['audio_url', `${playlist.songs[0].audio_url}\n`], ['position', 0], ['position', -1], ['position', 1.1],
])('rejects song %s = %p', (key, value) => expect(isPlaylistSong({ ...playlist.songs[0], [key]: value })).toBe(false));
test('duplicates, unsorted positions, and over 100 rows fail the whole read', () => {
    const [one, two] = playlist.songs;
    for (const songs of [[one, { ...two, id: one.id }], [one, { ...two, position: 1 }], [two, one],
        Array.from({ length: 101 }, (_, i) => ({ ...one, id: `${String(i).padStart(8, '0')}${songId.slice(8)}`, position: i + 1 }))]) {
        expect(isPlaylistList({ playlists: [{ ...playlist, songs }] })).toBe(false);
    }
    expect(isPlaylistList({ playlists: [playlist, { ...playlist, id: 'bad' }] })).toBe(false);
});
test.each([{ revision: 1 }, { revision: -1, idempotent: true }, { revision: 0.2, idempotent: false }, { revision: 1, idempotent: 1 }])('rejects incomplete receipt %p', v => expect(isPlaylistReceipt(v)).toBe(false));
test.each(['id', 'title', 'pinned', 'revision', 'songs'])('missing promised playlist field %s fails', key => {
    const row: Record<string, unknown> = { ...playlist }; delete row[key]; expect(isPlaylist(row)).toBe(false);
});
test.each(['id', 'title', 'version_id', 'audio_url', 'position'])('missing promised song field %s fails', key => {
    const row: Record<string, unknown> = { ...playlist.songs[0] }; delete row[key]; expect(isPlaylistSong(row)).toBe(false);
});

test('Postgres microsecond timestamps validate without Date.parse (including on Hermes)', () => {
    const parse = jest.spyOn(Date, 'parse').mockReturnValue(NaN);
    try {
        expect(isPlaylistList({ playlists: [{ ...playlist, created_at: '2026-11-19T12:34:56.123456+00:00' }] })).toBe(true);
        expect(isPlaylist({ ...playlist, created_at: '2024-02-29T12:34:56.123456Z' })).toBe(true);
        expect(isPlaylist({ ...playlist, created_at: '2026-02-29T12:34:56.123456Z' })).toBe(false);
        expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
});
