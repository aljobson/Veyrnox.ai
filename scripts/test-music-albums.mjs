#!/usr/bin/env node
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const db = new pg.Client({ connectionString: url });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const call = async (name, ...args) => (await one(`SELECT public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) AS value`, args)).value;

const owner = '10000000-0000-4000-8000-000000000001';
const viewer = '20000000-0000-4000-8000-000000000002';
const viewer2 = '21000000-0000-4000-8000-000000000012';
const admin = '30000000-0000-4000-8000-000000000003';
const actor = '40000000-0000-4000-8000-000000000004';
const song = 'a0000000-0000-4000-8000-00000000000a';
const publication = 'd0000000-0000-4000-8000-00000000000d';
const album = 'e0000000-0000-4000-8000-00000000000e';

await db.query('BEGIN');
try {
  // The production Supabase auth schema owns this table. Vanilla PostgreSQL
  // verification databases need only the columns referenced by export policy.
  await db.query(`CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.mfa_factors(
    user_id UUID NOT NULL, factor_type TEXT NOT NULL, status TEXT NOT NULL
  )`);
  await db.query(`
    INSERT INTO public.users(id,auth_id,email,is_admin) VALUES
      ('${owner}','${owner}','album-owner@example.test',false),
      ('${viewer}','${viewer}','album-viewer@example.test',false),
      ('${viewer2}','${viewer2}','album-viewer-2@example.test',false),
      ('${admin}','${admin}','album-admin@example.test',true);
    INSERT INTO public.music_actors(user_id,public_id) VALUES ('${owner}','${actor}');
    INSERT INTO public.music_creator_profiles(user_id,handle,display_name) VALUES ('${owner}','album_owner','Album Owner');
    INSERT INTO public.music_workspaces(id,user_id,name,is_default,idempotency_key) VALUES
      ('50000000-0000-4000-8000-000000000005','${owner}','Default',true,'album.workspace.fixture');
    INSERT INTO public.jobs(id,user_id,idempotency_key,model_id,credits,state,provider,inputs) VALUES
      ('60000000-0000-4000-8000-000000000006','${owner}','album.audio.fixture','elevenlabs-sfx-v2',1,'STORED','fal','{}'),
      ('80000000-0000-4000-8000-000000000008','${owner}','album.image.fixture','elevenlabs-sfx-v2',1,'STORED','fal','{}');
    INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes) VALUES
      ('70000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000006','fixture/audio.mp3','audio/mpeg',1000),
      ('90000000-0000-4000-8000-000000000009','80000000-0000-4000-8000-000000000008','fixture/cover.png','image/png',1000);
    INSERT INTO public.content_scans(job_id,asset_id,r2_key,status,decided_at) VALUES
      ('80000000-0000-4000-8000-000000000008','90000000-0000-4000-8000-000000000009','fixture/cover.png','clean',now())
      ON CONFLICT(asset_id) DO UPDATE SET status='clean',decided_at=now();
    INSERT INTO public.music_songs(id,user_id,title,workspace_id) VALUES
      ('${song}','${owner}','First Light','50000000-0000-4000-8000-000000000005');
    INSERT INTO public.music_song_versions(id,user_id,song_id,job_id,audio_asset_id,operation) VALUES
      ('b0000000-0000-4000-8000-00000000000b','${owner}','${song}','60000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000007','studio_mixdown');
    UPDATE public.music_songs SET current_version_id='b0000000-0000-4000-8000-00000000000b' WHERE id='${song}';
    INSERT INTO public.music_publication_attestations(id,user_id,statement_version,claims) VALUES
      ('c0000000-0000-4000-8000-00000000000c','${owner}','music-publication-rights-v1','{"terms_acknowledged":true,"publication_permission":true}');
    INSERT INTO public.music_publications(id,user_id,song_id,song_version_id,attestation_id,slug,policy_version,commercial_status,idempotency_key) VALUES
      ('${publication}','${owner}','${song}','b0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000c','bbbbbbbbbbbbbbbbbbbbbbbb','music-publication-v1','personal_use_only','album.publish.fixture');
  `);

  const artwork = await call('music_list_album_artwork', owner);
  assert.equal(artwork.images[0].asset_id, '90000000-0000-4000-8000-000000000009');
  let result = await call('music_create_album', owner, album, 'Debut', 'ep', 'First release', '90000000-0000-4000-8000-000000000009', 'album.create.fixture');
  assert.equal(result.album.album_type, 'ep');
  result = await call('music_patch_album', owner, album, 0, 'replace', null, null, null, null, [publication], 'album.replace.fixture');
  assert.equal(result.album.tracks.length, 1);
  result = await call('music_patch_album', owner, album, 1, 'publish', null, null, null, null, null, 'album.release.fixture');
  assert.equal(result.album.status, 'published');
  const albumSlug = result.album.slug;
  assert.equal((await call('music_patch_album', owner, album, 1, 'publish', null, null, null, null, null, 'album.release.fixture')).idempotent, true);
  assert.equal((await call('music_read_public_album', albumSlug)).album.tracks.length, 1);

  await db.query(`INSERT INTO public.music_user_blocks(blocker_id,blocked_id) VALUES($1,$2)`, [viewer, owner]);
  assert.ok((await call('music_read_public_album_for_viewer', viewer, albumSlug)).blocked);
  await db.query(`DELETE FROM public.music_user_blocks WHERE blocker_id=$1 AND blocked_id=$2`, [viewer, owner]);

  await db.query(`UPDATE public.music_songs SET status='trashed' WHERE id=$1`, [song]);
  assert.equal((await call('music_read_public_album', albumSlug)).code, 'NOT_FOUND');
  await db.query(`UPDATE public.music_songs SET status='active' WHERE id=$1`, [song]);
  await db.query(`UPDATE public.music_publications SET status='blocked' WHERE id=$1`, [publication]);
  assert.equal((await call('music_read_public_album', albumSlug)).code, 'NOT_FOUND');
  await db.query(`UPDATE public.music_publications SET status='published' WHERE id=$1`, [publication]);

  await db.query(`UPDATE public.music_publications SET status='unpublished',unpublished_at=now() WHERE id=$1`, [publication]);
  await db.query(`
    INSERT INTO public.music_publication_attestations(id,user_id,statement_version,claims) VALUES
      ('c1000000-0000-4000-8000-00000000001c','${owner}','music-publication-rights-v1','{"terms_acknowledged":true,"publication_permission":true}');
    INSERT INTO public.music_publications(id,user_id,song_id,song_version_id,attestation_id,slug,policy_version,commercial_status,idempotency_key) VALUES
      ('d1000000-0000-4000-8000-00000000001d','${owner}','${song}','b0000000-0000-4000-8000-00000000000b','c1000000-0000-4000-8000-00000000001c','cccccccccccccccccccccccc','music-publication-v1','personal_use_only','album.republish.fixture');
  `);
  const ownerList = await call('music_list_albums', owner);
  assert.equal(ownerList.albums[0].tracks[0].publication_id, 'd1000000-0000-4000-8000-00000000001d');
  result = await call('music_patch_album', owner, album, 2, 'unpublish', null, null, null, null, null, 'album.unpublish.fixture');
  assert.equal(result.album.status, 'unpublished');
  result = await call('music_patch_album', owner, album, 3, 'publish', null, null, null, null, null, 'album.republish-release.fixture');
  assert.equal(result.album.status, 'published');

  const secondSong='a1000000-0000-4000-8000-00000000001a',secondVersion='b1000000-0000-4000-8000-00000000001b',secondAttestation='c2000000-0000-4000-8000-00000000002c',secondPublication='d2000000-0000-4000-8000-00000000002d';
  await db.query(`INSERT INTO public.music_songs(id,user_id,title,workspace_id) VALUES ($1,$2,'Second Light','50000000-0000-4000-8000-000000000005')`,[secondSong,owner]);
  await db.query(`INSERT INTO public.music_song_versions(id,user_id,song_id,job_id,audio_asset_id,operation) VALUES ($1,$2,$3,'60000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000007','studio_mixdown')`,[secondVersion,owner,secondSong]);
  await db.query(`UPDATE public.music_songs SET current_version_id=$1 WHERE id=$2`,[secondVersion,secondSong]);
  await db.query(`INSERT INTO public.music_publication_attestations(id,user_id,statement_version,claims) VALUES ($1,$2,'music-publication-rights-v1','{"terms_acknowledged":true,"publication_permission":true}')`,[secondAttestation,owner]);
  await db.query(`INSERT INTO public.music_publications(id,user_id,song_id,song_version_id,attestation_id,slug,policy_version,commercial_status,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,'dddddddddddddddddddddddd','music-publication-v1','personal_use_only','album.second.publish')`,[secondPublication,owner,secondSong,secondVersion,secondAttestation]);
  result=await call('music_patch_album',owner,album,4,'replace',null,null,null,null,['d1000000-0000-4000-8000-00000000001d',secondPublication],'album.two.replace');
  result=await call('music_patch_album',owner,album,5,'unpublish',null,null,null,null,null,'album.two.unpublish');
  await db.query(`UPDATE public.music_publications SET status='unpublished',unpublished_at=now() WHERE id=$1`,[secondPublication]);
  result=await call('music_patch_album',owner,album,6,'publish',null,null,null,null,null,'album.live-subset.publish');
  assert.equal(result.album.tracks.length,1);
  assert.equal((await one(`SELECT count(*)::int AS n FROM public.music_album_items WHERE album_id=$1`,[album])).n,1);

  const moderatedAlbum = 'e1000000-0000-4000-8000-00000000001e';
  result = await call('music_create_album', owner, moderatedAlbum, 'Moderated', 'album', '', null, 'album.moderated.create');
  result = await call('music_patch_album', owner, moderatedAlbum, 0, 'replace', null, null, null, null, ['d1000000-0000-4000-8000-00000000001d'], 'album.moderated.replace');
  result = await call('music_patch_album', owner, moderatedAlbum, 1, 'publish', null, null, null, null, null, 'album.moderated.publish');
  const moderatedSlug = result.album.slug;
  await call('music_report_album', viewer, moderatedSlug, 'abuse', 'Moderation fixture', 'album.moderated.report');
  await call('music_report_album', viewer2, moderatedSlug, 'spam', 'Second moderation fixture', 'album.moderated.report.two');
  const report = await one(`SELECT id FROM public.music_album_reports WHERE album_id=$1`, [moderatedAlbum]);
  result = await call('music_album_report_resolve', admin, 'album.moderated.invalid', { action: 'resolve_album_report', id: report.id, reason: 'Missing decision' });
  assert.equal(result.code, 'INVALID_INPUTS');
  result = await call('music_album_report_resolve', admin, 'album.moderated.resolve', { action: 'resolve_album_report', id: report.id, decision: 'takedown', reason: 'Policy violation' });
  assert.equal(result.decision, 'takedown');
  assert.equal((await call('music_read_public_album', moderatedSlug)).code, 'NOT_FOUND');
  assert.equal((await one(`SELECT status FROM public.music_albums WHERE id=$1`, [moderatedAlbum])).status, 'blocked');
  assert.equal((await one(`SELECT count(*)::int AS n FROM public.music_album_reports WHERE album_id=$1 AND status='open'`,[moderatedAlbum])).n,0);
  result=await call('music_patch_album',owner,moderatedAlbum,3,'delete',null,null,null,null,null,'album.moderated.delete');
  assert.equal(result.deleted,true);
  assert.deepEqual(await one(`SELECT status,title,description,artwork_asset_id FROM public.music_albums WHERE id=$1`,[moderatedAlbum]),
    {status:'deleted',title:'Deleted album',description:'',artwork_asset_id:null});

  const deletedAlbum = 'e2000000-0000-4000-8000-00000000002e';
  result = await call('music_create_album', owner, deletedAlbum, 'Delete me', 'single', '', null, 'album.deleted.create');
  result = await call('music_patch_album', owner, deletedAlbum, 0, 'replace', null, null, null, null, ['d1000000-0000-4000-8000-00000000001d'], 'album.deleted.replace');
  result = await call('music_patch_album', owner, deletedAlbum, 1, 'publish', null, null, null, null, null, 'album.deleted.publish');
  await call('music_report_album', viewer, result.album.slug, 'rights', 'Retain this report', 'album.deleted.report');
  result = await call('music_patch_album', owner, deletedAlbum, 2, 'delete', null, null, null, null, null, 'album.deleted.delete');
  assert.equal(result.deleted, true);
  assert.equal((await one(`SELECT count(*)::int AS n FROM public.music_album_reports WHERE album_id=$1`, [deletedAlbum])).n, 1);
  assert.equal((await one(`SELECT status FROM public.music_albums WHERE id=$1`, [deletedAlbum])).status, 'deleted');

  const started = await call('start_privacy_export', owner, 'aal2');
  const page1 = await call('read_music_album_export_page', owner, 'aal2', started.export_id, null, null, 1);
  assert.equal(page1.rows.length, 1);
  assert.ok(page1.next);
  const page2 = await call('read_music_album_export_page', owner, 'aal2', started.export_id, page1.next.after, page1.next.key, 1);
  assert.equal(page2.rows.length, 1);

  console.log('Music albums: lifecycle, filtering, moderation, retention and export passed');
} finally {
  await db.query('ROLLBACK');
  await db.end();
}
