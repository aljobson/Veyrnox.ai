import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMusicPublish, parseMusicUnpublish } from '../lib/musicPublication.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0463_music_publication.sql', import.meta.url);
const ownerRouteUrl = new URL('../app/api/v1/music/songs/[id]/publication/route.js', import.meta.url);
const publicRouteUrl = new URL('../app/api/v1/music/public/[slug]/route.js', import.meta.url);
const assetRouteUrl = new URL('../app/api/v1/music/public/[slug]/asset/route.js', import.meta.url);

test('publication parser requires exact permissions, rights and creator identity', () => {
  const body = {
    version_id: 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b',
    handle: 'night_signal', display_name: 'Night Signal',
    allow_comments: false, allow_remixes: true, rights_confirmed: true,
    idempotency_key: 'publish.12345678', // gitleaks:allow -- synthetic idempotency fixture
  };
  assert.deepEqual(parseMusicPublish(body), {
    ok: true, versionId: body.version_id, handle: 'night_signal', displayName: 'Night Signal',
    allowComments: false, allowRemixes: true, idempotencyKey: 'publish.12345678', // gitleaks:allow -- synthetic idempotency fixture
  });
  assert.equal(parseMusicPublish({ ...body, rights_confirmed: false }).error, 'rights_confirmation_required');
  assert.equal(parseMusicPublish({ ...body, handle: '../admin' }).error, 'handle_invalid');
  assert.equal(parseMusicPublish({ ...body, commercial: true }).error, 'invalid_request');
  assert.deepEqual(parseMusicUnpublish({ idempotency_key: 'publish.87654321' }), { ok: true, idempotencyKey: 'publish.87654321' }); // gitleaks:allow -- synthetic idempotency fixture
});

test('publication migration is owner-scoped, reversible and honest about commercial eligibility', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /music_publications_version_owner_fk[\s\S]*FOREIGN KEY \(song_version_id,user_id,song_id\)/);
  assert.match(sql, /music_publications_attestation_owner_fk[\s\S]*FOREIGN KEY \(attestation_id,user_id\)/);
  assert.match(sql, /music_publication_attestations_immutable[\s\S]*BEFORE UPDATE OR DELETE/);
  assert.match(sql, /commercial_status IN \('personal_use_only','plan_eligible_terms_apply'\)/);
  assert.match(sql, /plan_id IN \('starter-monthly','plus-monthly','ultra-monthly'\)/);
  assert.match(sql, /music_unpublish_song[\s\S]*status='unpublished'/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);
});

test('publication routes moderate first and strip storage and job identifiers', async () => {
  const [owner, publicRoute, asset] = await Promise.all([
    readFile(ownerRouteUrl, 'utf8'), readFile(publicRouteUrl, 'utf8'), readFile(assetRouteUrl, 'utf8'),
  ]);
  assert.match(owner, /music_get_publication_context[\s\S]*musicPromptPolicy[\s\S]*music_publish_song/);
  assert.match(publicRoute, /const \{ job_id: _jobId, \.\.\.safe \} = result\.track/);
  assert.match(asset, /music_resolve_publication_asset/);
  assert.match(asset, /status: 302[\s\S]*'Cache-Control': 'no-store'/);
  assert.doesNotMatch(publicRoute, /r2_key/);
});
