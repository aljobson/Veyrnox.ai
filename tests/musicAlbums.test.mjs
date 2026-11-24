import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { musicAlbumsEnabled } from '../lib/musicBackend.js';
import { musicAlbumArtworkHandler } from '../lib/musicAlbumArtwork.js';
import { parseAlbumConversion, parseAlbumCreate, parseAlbumPatch, parseAlbumReport, parseAlbumReportResolve, publicMusicAlbum } from '../lib/musicAlbums.js';
import { missingAlbumExportReader } from '../lib/privacyExportCompatibility.js';
import { resolveAlbumArtwork } from '../app/veyrnox/_components/music/resolveAlbumArtwork.js';

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
    assert.equal(publicMusicAlbum({ ...album, has_artwork: true }, { viewer: true }).artwork_url,
        `/api/v1/music/explore/albums/${album.slug}/artwork`);
});

test('signed-in web artwork resolves the viewer endpoint before rendering', async () => {
    const slug = 'a'.repeat(24); let requested = '';
    const album = { slug, artwork_url: `/api/v1/music/explore/albums/${slug}/artwork` };
    assert.equal(await resolveAlbumArtwork(async (path) => { requested = path; return { url: 'https://signed.test/cover?sig=1' }; }, album), 'https://signed.test/cover?sig=1');
    assert.equal(requested, `/music/explore/albums/${slug}/artwork`);
    assert.equal(await resolveAlbumArtwork(async () => ({ url: '/api/music/albums/public' }), album), null);
    assert.equal(await resolveAlbumArtwork(async () => ({ url: 'https://signed.test/cover' }), { ...album, artwork_url: `/api/music/albums/${slug}/artwork` }), null);
});

test('album migration enforces published active tracks, viewer blocks, moderation and privacy export', async () => {
    const [base, hardening] = await Promise.all([
        readFile(new URL('../packages/db/schema/supabase/0600_music_albums.sql', import.meta.url), 'utf8'),
        readFile(new URL('../packages/db/schema/supabase/0605_music_album_privacy_and_artwork.sql', import.meta.url), 'utf8'),
    ]);
    const sql = `${base}\n${hardening}`;
    assert.match(hardening, /0600_music_albums must be applied before 0605/);
    assert.match(sql, /music_album_items[\s\S]*song_id UUID NOT NULL/);
    assert.match(sql, /p\.status='published'[\s\S]*s\.status='active'/);
    assert.match(sql, /music_read_public_album_for_viewer[\s\S]*private\.music_actor_blocked/);
    assert.match(sql, /music_album_reports/);
    assert.match(sql, /read_music_album_export_page/);
    assert.match(sql, /private\.music_album_tracks_export/);
    assert.match(sql, /music_resolve_album_artwork/);
    assert.match(sql, /music_read_public_album\(album\.slug\)->>'ok'='true'/);
    assert.match(sql, /music_resolve_album_artwork_for_viewer[\s\S]*music_read_public_album_for_viewer[\s\S]*coalesce\(visible->>'ok',''\)<>\s*'true'[\s\S]*visible \? 'blocked'/);
    assert.match(sql, /music_list_album_artwork[\s\S]*'asset_id',x\.asset_id/);
    assert.match(sql, /music_album_report_list/);
    assert.match(sql, /music_album_report_resolve/);
    assert.match(sql, /INSERT INTO public\.music_album_mutations[\s\S]*status='deleted'/);
    assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(u::text\|\|':'\|\|p_key,0\)\)/);
    assert.match(sql, /IF p_action='delete'[\s\S]*jsonb_build_object\('action','delete','expected',p_expected\)/);
    assert.match(sql, /UPDATE public\.music_album_mutations[\s\S]*'redacted',true,'album_id',p_id/);
    assert.match(sql, /seen\.result->>'redacted'='true'[\s\S]*seen\.request->>'action' IS DISTINCT FROM p_action[\s\S]*seen\.request->>'expected' IS DISTINCT FROM p_expected::text[\s\S]*'IDEMPOTENCY_CONFLICT'[\s\S]*'idempotent',true/);
    assert.match(sql, /status='blocked'/);
    assert.match(sql, /title='Deleted album'/);
    assert.match(sql, /DELETE FROM public\.music_album_items i WHERE i\.album_id=p_id AND NOT EXISTS/);
    assert.match(sql, /WHERE album_id=report\.album_id AND status='open'/);
    assert.match(sql, /source_included_count/);
    assert.match(sql, /content_scans[\s\S]*status='clean'/);
    assert.match(sql, /ON DELETE CASCADE/);
});

test('authenticated album artwork route fails closed for a blocked viewer', async () => {
    let signed = false;
    const GET = musicAlbumArtworkHandler({
        enabled: () => true,
        databaseConfig: () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret' }),
        storageConfig: () => ({ endpoint: 'https://r2.test' }),
        storageReady: () => true,
        readLimit: async () => null,
        rpcCall: async (name, args) => {
            assert.equal(name, 'music_resolve_album_artwork_for_viewer');
            assert.equal(args.p_auth_id, uuid);
            return { ok: false, code: 'NOT_FOUND' };
        },
        presign: async () => { signed = true; return { url: 'https://signed.test/art' }; },
    });
    const response = await GET(new Request(`https://veyrnox.test/api/v1/music/explore/albums/${'a'.repeat(24)}/artwork`, {
        headers: { 'x-veyrnox-auth-id': uuid },
    }), { params: Promise.resolve({ slug: 'a'.repeat(24) }) });
    assert.equal(response.status, 404);
    assert.equal(signed, false);
});

test('authenticated album artwork follows publication gating and account read limiting', async () => {
    const request = new Request(`https://veyrnox.test/api/v1/music/explore/albums/${'a'.repeat(24)}/artwork`, {
        headers: { 'x-veyrnox-auth-id': uuid },
    });
    const context = { params: Promise.resolve({ slug: 'a'.repeat(24) }) };
    const common = {
        databaseConfig: () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret' }),
        storageConfig: () => ({ endpoint: 'https://r2.test' }), storageReady: () => true,
        rpcCall: async () => { throw new Error('resolver must not run'); },
        presign: async () => { throw new Error('presign must not run'); },
    };
    assert.equal((await musicAlbumArtworkHandler({ ...common, enabled: () => false })(request, context)).status, 404);
    const limited = musicAlbumArtworkHandler({ ...common, enabled: () => true,
        readLimit: async () => Response.json({ error: 'rate_limited' }, { status: 429 }) });
    assert.equal((await limited(request, context)).status, 429);
});

test('album APIs remain capability gated and privacy export exposes the classified section', async () => {
    const [owned, publicRead, reportRoute, adminRoute, exportRoute, exportLibrary, publicProfile, anonymousAlbum, anonymousArtwork, patchRoute] = await Promise.all([
        readFile(new URL('../app/api/v1/music/albums/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/music/explore/albums/[slug]/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/music/album-reports/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/admin/music-comments/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/account/export/[exportId]/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../lib/privacyExport.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/veyrnox/_components/music/MusicPublicProfile.jsx', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/music/albums/[slug]/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/music/albums/[slug]/artwork/route.js', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/v1/music/albums/[id]/route.js', import.meta.url), 'utf8'),
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
    assert.match(anonymousAlbum, /musicPublicationEnabled\(\)\|\|!musicAlbumsEnabled\(\)/);
    assert.match(anonymousArtwork, /musicPublicationEnabled\(\)\|\|!musicAlbumsEnabled\(\)/);
    assert.match(patchRoute, /result\?\.redacted===true[\s\S]*album_deleted[\s\S]*410/);
});
