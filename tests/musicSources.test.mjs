import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_SOURCE_MAX_BYTES,
  parseMusicSourceDelete,
  parseMusicSourceMutation,
} from '../lib/musicSources.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0462_music_owned_sources.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/sources/route.js', import.meta.url);

test('owned source parser requires bounded audio and explicit rights', () => {
  const reserve = {
    action: 'reserve',
    content_type: 'audio/mpeg',
    filename: '  owned demo.mp3  ',
    idempotency_key: 'source.12345678',
    rights_confirmed: true,
    size_bytes: MUSIC_SOURCE_MAX_BYTES,
  };
  assert.deepEqual(parseMusicSourceMutation(reserve), {
    ok: true,
    action: 'reserve',
    filename: 'owned demo.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: MUSIC_SOURCE_MAX_BYTES,
    idempotencyKey: 'source.12345678',
  });
  assert.equal(parseMusicSourceMutation({ ...reserve, rights_confirmed: false }).error, 'rights_confirmation_required');
  assert.equal(parseMusicSourceMutation({ ...reserve, content_type: 'text/html' }).error, 'source_type_not_supported');
  assert.equal(parseMusicSourceMutation({ ...reserve, size_bytes: MUSIC_SOURCE_MAX_BYTES + 1 }).error, 'source_size_invalid');
  assert.equal(parseMusicSourceMutation({ ...reserve, owner_id: crypto.randomUUID() }).error, 'invalid_request');
  assert.deepEqual(parseMusicSourceDelete({ id: 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b' }), {
    ok: true, id: 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b',
  });
});

test('owned source migration keeps rights immutable and completion server-measured', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_source_assets/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_rights_attestations/);
  assert.match(sql, /claims = '\{"recording_use":true,"composition_use":true\}'::jsonb/);
  assert.match(sql, /CREATE TRIGGER music_rights_attestations_immutable[\s\S]*BEFORE UPDATE OR DELETE/);
  assert.match(sql, /music_complete_source[\s\S]*p_duration_seconds[\s\S]*WHEN v_paid THEN 1800 ELSE 480/);
  assert.match(sql, /music_source_assets_rights_owner_fk[\s\S]*FOREIGN KEY \(rights_attestation_id, user_id\)/);
  assert.match(sql, /UNIQUE\(user_id, idempotency_key\)/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);
});

test('owned source route inspects stored bytes before completion and never exposes an R2 key', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /inspectStoredSource\(source\.r2_key/);
  assert.match(route, /music_complete_source/);
  assert.match(route, /const \{ r2_key: key, \.\.\.safe \} = source/);
  assert.match(route, /['"]Cache-Control['"]:\s*['"]no-store['"]/);
});

test('owned source removal deletes private bytes before finalizing database deletion', async () => {
  const [sql, route] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(routeUrl, 'utf8'),
  ]);
  assert.match(sql, /music_remove_source[\s\S]*'r2_key',v_source\.r2_key/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.music_finalize_source_removal/);
  assert.match(route, /deleteObject\(result\.r2_key, ctx\.r2cfg\)/);
  assert.match(route, /music_finalize_source_removal/);
});

test('removed source reservations fail closed instead of minting a fresh upload URL', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /v_existing\.status IN \('deleting','deleted'\)[\s\S]*SOURCE_REMOVED/);
});
