import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashMusicShareToken } from '../lib/musicDistribution.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0461_music_private_distribution.sql', import.meta.url);
const wavMigrationUrl = new URL('../packages/db/schema/supabase/0467_music_wav_exports.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/export-quotes/route.js', import.meta.url);
const startRouteUrl = new URL('../app/api/v1/music/songs/[id]/exports/route.js', import.meta.url);
const exportRouteUrl = new URL('../app/api/v1/music/exports/[id]/route.js', import.meta.url);
const sharedRouteUrl = new URL('../app/api/music/shared/[token]/route.js', import.meta.url);
const sharedAssetRouteUrl = new URL('../app/api/music/shared/[token]/asset/route.js', import.meta.url);

test('private distribution migration hashes links and claims MP3 allowance at most once', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_share_links/);
  assert.match(sql, /token_hash TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(sql, /raw_token|share_url/);
  assert.match(sql, /permissions = '\{"listen":true,"download":false\}'::jsonb/);
  assert.match(sql, /UNIQUE\(period_id, song_version_id\)/);
  assert.match(sql, /UNIQUE\(user_id, idempotency_key\)/);
  assert.match(sql, /DOWNLOAD_ALLOWANCE_EXHAUSTED/);
  assert.match(sql, /lower\(v_asset\.mime_type\) NOT IN \('audio\/mpeg','audio\/mp3'\)/);
  assert.match(sql, /music_start_mp3_export[\s\S]*FOR UPDATE[\s\S]*music_download_claims/);
  assert.match(sql, /music_resolve_shared_asset[\s\S]*v_asset\.r2_key/);
  const publicProjection = sql.match(/CREATE OR REPLACE FUNCTION public\.music_resolve_share_link[\s\S]*?END \$\$;/)?.[0] || '';
  assert.doesNotMatch(publicProjection, /'id'|'version_id'/);
  assert.match(publicProjection, /'title'[\s\S]*'version_number'/);
  assert.match(sql, /CASE v_sub\.plan_id[\s\S]*WHEN 'starter-monthly' THEN 20[\s\S]*WHEN 'plus-monthly' THEN 60[\s\S]*WHEN 'ultra-monthly' THEN 60[\s\S]*ELSE 0/);
  assert.match(sql, /CREATE TRIGGER music_download_claims_immutable[\s\S]*BEFORE UPDATE OR DELETE/);
  assert.match(sql, /music_share_links_version_owner_fk[\s\S]*FOREIGN KEY \(song_version_id, user_id, song_id\)[\s\S]*REFERENCES public\.music_song_versions\(id, user_id, song_id\)/);
  assert.match(sql, /music_quote_mp3_export[\s\S]*v\.user_id = v_user AND v\.song_id = p_song_id/);
  assert.match(sql, /music_start_mp3_export[\s\S]*SELECT id INTO v_user FROM public\.users WHERE auth_id = p_auth_id FOR UPDATE/);
  assert.match(sql, /music_start_mp3_export[\s\S]*music_download_periods WHERE id = v_quote\.period_id FOR UPDATE/);
  assert.match(sql, /music_start_mp3_export[\s\S]*v_period\.expires_at IS NOT NULL AND v_period\.expires_at <= now\(\)/);
  assert.match(sql, /music_get_export[\s\S]*e\.id = p_export_id AND e\.user_id = v_user/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/g);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_get_export\(TEXT,UUID\) TO service_role/);
});

test('public share routes strip internal identifiers and forbid cached redirects', async () => {
  const [route, assetRoute] = await Promise.all([
    readFile(sharedRouteUrl, 'utf8'), readFile(sharedAssetRouteUrl, 'utf8'),
  ]);
  assert.doesNotMatch(route, /\.\.\.result\.song/);
  assert.match(route, /title: result\.song\.title/);
  assert.match(assetRoute, /['"]Cache-Control['"]:\s*['"]no-store['"]/);
  assert.doesNotMatch(assetRoute, /Response\.redirect\(/);
});

test('exact-format WAV downloads reuse the locked allowance path without relabelling bytes', async () => {
  const [sql, quoteRoute, startRoute, exportRoute] = await Promise.all([
    readFile(wavMigrationUrl, 'utf8'), readFile(quoteRouteUrl, 'utf8'),
    readFile(startRouteUrl, 'utf8'), readFile(exportRouteUrl, 'utf8'),
  ]);
  assert.match(sql, /CHECK \(format IN \('mp3','wav'\)\)/);
  assert.match(sql, /p_format = 'wav'[\s\S]*'audio\/wav','audio\/x-wav','audio\/wave'/);
  assert.match(sql, /music_quote_audio_export[\s\S]*music_download_periods[\s\S]*FOR UPDATE/);
  assert.match(sql, /music_start_audio_export[\s\S]*music_download_periods WHERE id = v_quote\.period_id FOR UPDATE/);
  assert.match(sql, /v_attempt\.quote_id IS DISTINCT FROM p_quote_id[\s\S]*'idempotent', true[\s\S]*'remaining'/);
  assert.match(sql, /music_start_audio_export[\s\S]*INSERT INTO public\.music_download_claims/);
  assert.match(sql, /JOIN public\.music_export_quotes q[\s\S]*'format', v_row\.format/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_quote_audio_export\(TEXT,UUID,UUID,TEXT\) TO service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_start_audio_export\(TEXT,UUID,TEXT\) TO service_role/);
  assert.doesNotMatch(sql, /transcod(?:e|ing)\(/i);
  assert.match(quoteRoute, /music_quote_audio_export/);
  assert.match(quoteRoute, /p_format: input\.format/);
  assert.match(startRoute, /music_start_audio_export/);
  assert.match(exportRoute, /FORMAT_MIME_TYPES\[format\]\?\.has\(mimeType\)/);
  assert.match(exportRoute, /assetDownloadName\(item\.job_id, canonicalMimeType\)/);
});

test('share token hashing is deterministic and does not retain the raw token', async () => {
  const token = 'A'.repeat(43);
  const first = await hashMusicShareToken(token);
  assert.equal(first, await hashMusicShareToken(token));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(first, /A{8}/);
});
