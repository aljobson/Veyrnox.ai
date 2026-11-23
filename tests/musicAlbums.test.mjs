import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { musicAlbumsEnabled } from '../lib/musicBackend.js';
import { parseAlbumConversion, parseAlbumCreate, parseAlbumPatch, parseAlbumReport, parseAlbumReportResolve, publicMusicAlbum } from '../lib/musicAlbums.js';
import { missingAlbumExportReader } from '../lib/privacyExportCompatibility.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';

test('album rollout stays fail-closed behind its prerequisites', () => {
    const base = { MUSIC_UI_ENABLED: 'true', MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true',
        MUSIC_DISTRIBUTION_ENABLED: 'true', MUSIC_PUBLICATION_ENABLED: 'true', MUSIC_PLAYLISTS_ENABLED: 'true' };
    assert.equal(musicAlbumsEnabled(base), false);
    assert.equal(musicAlbumsEnabled({ ...base, MUSIC_RUNTIME_FLAGS: '{"albums":true}' }), true);
    assert.equal(musicAlbumsEnabled({ ...base, MUSIC_PUBLICATION_ENABLED: 'false', MUSIC_RUNTIME_FLAGS: '{"albums":true}' }), false);
});

test('pre-migration privacy exports treat only the missing album RPC as an empty section', () => {
    assert.equal(missingAlbumExportReader({ status: 404, body: { code: 'PGRST202' } }), true);
    assert.equal(missingAlbumExportReader({ status: 400, body: { code: '42883' } }), true);
    assert.equal(missingAlbumExportReader({ status: 503, body: { code: 'PGRST202' } }), false);
});

test('album create and conversion contracts are bounded and exact', () => {
    assert.deepEqual(parseAlbumCreate({ title: ' Debut ', album_type: 'ep', description: ' First release ', artwork_asset_id: null, idempotency_key: 'album.create' }),
        { ok: true, title: 'Debut', description: 'First release', albumType: 'ep', artworkAssetId: null, idempotencyKey: 'album.create' });
    assert.equal(parseAlbumCreate({ title: 'Debut', album_type: 'album', description: '', artwork_asset_id: null, idempotency_key: 'album.create', owner_id: uuid }).error, 'invalid_request');
    assert.equal(parseAlbumCreate({ title: 'Debut', album_type: 'mixtape', description: '', artwork_asset_id: null, idempotency_key: 'album.create' }).error, 'album_type_invalid');
    assert.equal(parseAlbumConversion({ playlist_id: uuid, title: 'Debut', album_type: 'single', description: '', artwork_asset_id: null, idempotency_key: 'album.convert' }).playlistId, uuid);
});

test('album patches preserve order, reject duplicates and bound reports', () => {
    const replace = parseAlbumPatch({ action: 'replace', expected_revision: 2, publication_ids: [uuid, uuid2], idempotency_key: 'album.replace' });
    assert.deepEqual(replace.publicationIds, [uuid, uuid2]);
    assert.equal(parseAlbumPatch({ action: 'replace', expected_revision: 2, publication_ids: [uuid, uuid], idempotency_key: 'album.replace' }).error, 'publication_ids_invalid');
    assert.equal(parseAlbumPatch({ action: 'publish', expected_revision: 2, idempotency_key: 'album.publish' }).action, 'publish');
    assert.equal(parseAlbumReport({ category: 'rights', details: 'Uses my protected artwork', idempotency_key: 'album.report' }).ok, true);
    assert.deepEqual(parseAlbumReportResolve({ action: 'resolve_album_report', id: uuid, decision: 'takedown', reason: 'Reviewed by moderator' }).payload,
        { action: 'resolve_album_report', id: uuid, decision: 'takedown', reason: 'Reviewed by moderator' });
    assert.equal(parseAlbumReportResolve({ action: 'resolve_album_report', id: uuid, reason: 'Reviewed by moderator' }).error, 'action_invalid');
});

test('public album projection drops unsafe and malformed track fields', () => {
    const album = publicMusicAlbum({ id: uuid, slug: 'a'.repeat(24), title: 'A'.repeat(90), album_type: 'ep', description: 'D', handle: 'creator',
        creator_id: uuid2, published_at: '2026-11-23T00:00:00Z', tracks: [
            { publication_id: uuid, slug: 'b'.repeat(24), title: 'Song', position: 1, job_id: uuid2 },
            { publication_id: 'bad', slug: 'no', title: 'Bad', position: 2 },
        ] });
    assert.equal(album.title.length, 80);
    assert.equal(album.album_type, 'ep');
    assert.equal(album.tracks.length, 1);
    assert.equal(album.tracks[0].audio_url, `/api/music/public/${album.tracks[0].slug}/asset`);
    assert.equal('job_id' in album.tracks[0], false);
    assert.equal(publicMusicAlbum({ ...album, album_type: 'mixtape' }), null);
    assert.equal(publicMusicAlbum({ ...album, has_artwork: true }).artwork_url, `/api/music/albums/${album.slug}/artwork`);
});

test('album migration enforces published active tracks, viewer blocks, moderation and privacy export', async () => {
    const sql = await readFile(new URL('../packages/db/schema/supabase/0600_music_albums.sql', import.meta.url), 'utf8');
    assert.match(sql, /music_album_items[\s\S]*song_id UUID NOT NULL/);
    assert.match(sql, /p\.status='published'[\s\S]*s\.status='active'/);
    assert.match(sql, /music_read_public_album_for_viewer[\s\S]*private\.music_actor_blocked/);
    assert.match(sql, /music_album_reports/);
    assert.match(sql, /read_music_album_export_page/);
    assert.match(sql, /private\.music_album_tracks_export/);
    assert.match(sql, /music_resolve_album_artwork/);
    assert.match(sql, /music_list_album_artwork[\s\S]*'asset_id',x\.asset_id/);
    assert.match(sql, /music_album_report_list/);
    assert.match(sql, /music_album_report_resolve/);
    assert.match(sql, /INSERT INTO public\.music_album_mutations[\s\S]*status='deleted'/);
    assert.match(sql, /status='blocked'/);
    assert.match(sql, /title='Deleted album'/);
    assert.match(sql, /DELETE FROM public\.music_album_items i WHERE i\.album_id=p_id AND NOT EXISTS/);
    assert.match(sql, /WHERE album_id=report\.album_id AND status='open'/);
    assert.match(sql, /source_included_count/);
    assert.match(sql, /content_scans[\s\S]*status='clean'/);
    assert.match(sql, /ON DELETE CASCADE/);
});

test('album APIs remain capability gated and privacy export exposes the classified section', async () => {
    const [owned, publicRead, reportRoute, adminRoute, exportRoute, exportLibrary, publicProfile] = await Promise.all([
        readFile(new URL('../app/api/v1/music/albums/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/music/explore/albums/[slug]/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/music/album-reports/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/admin/music-comments/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/account/export/[exportId]/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../lib/privacyExport.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/veyrnox/_components/music/MusicPublicProfile.jsx', import.meta.url), 'utf8'),
    ]);
    assert.match(owned, /musicAlbumsEnabled\(\)/);
    assert.match(publicRead, /musicExploreHandler\(\{ kind: 'album' \}\)/);
    assert.match(reportRoute, /Object\.keys\(body\.value\)/);
    assert.match(adminRoute, /music_album_report_list/);
    assert.match(adminRoute, /music_album_report_resolve/);
    assert.match(exportLibrary, /'music_albums'/);
    assert.match(exportRoute, /read_music_album_export_page/);
    assert.match(publicProfile, /getSession\(\)\?\.access_token/);
    assert.match(publicProfile, /music\/explore\/creators/);
    assert.match(publicProfile, /blocks_unavailable/);
});
