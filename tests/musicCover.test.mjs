import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  musicCoverEnabled, parseMusicCoverQuote, MUSIC_COVER_DURATION_MAX,
} from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0479_music_source_cover.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/cover-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/covers/route.js', import.meta.url);

const VERSION_ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

test('Cover parser requires one exact owned-version attestation and bounded influence', () => {
  assert.equal(MUSIC_COVER_DURATION_MAX, 120);
  assert.deepEqual(parseMusicCoverQuote({
    version_id: VERSION_ID,
    prompt: '  warmer cinematic dream-pop  ',
    source_influence: 60,
    rights_confirmed: true,
  }), {
    ok: true,
    versionId: VERSION_ID,
    prompt: 'warmer cinematic dream-pop',
    sourceInfluence: 60,
    rightsConfirmed: true,
  });
  assert.equal(parseMusicCoverQuote({ version_id: VERSION_ID, prompt: 'x', source_influence: 60, rights_confirmed: false }).error, 'source_rights_required');
  assert.equal(parseMusicCoverQuote({ version_id: VERSION_ID, prompt: 'x', source_influence: 91, rights_confirmed: true }).error, 'source_influence_invalid');
  assert.equal(parseMusicCoverQuote({ version_id: VERSION_ID, prompt: 'x', source_influence: 60, rights_confirmed: true, audio_url: 'https://attacker.invalid/x' }).error, 'invalid_request');
});

test('Cover gate composes schema, generation, dispatch, library and its own rollout flag', () => {
  const ready = {
    MUSIC_SCHEMA_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true',
    FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_COVER_ENABLED: 'true',
  };
  assert.equal(musicCoverEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicCoverEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('Cover schema stages the priced provider, freezes lineage, and submits a safe two-job payload', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'stable-audio-3-cover'.*'fal-ai\/stable-audio-3\/small\/music\/audio-to-audio'[^;]*false,false/s);
  assert.match(sql, /0\.0248,'per_generation'/);
  assert.match(sql, /source_rights_version='music-cover-source-rights-v1'/);
  assert.match(sql, /s\.current_version_id=v_prompt\.source_version_id/);
  assert.match(sql, /'audio_url',p_source_audio_url/);
  assert.match(sql, /'init_noise_level',round\(1-v_prompt\.source_influence::numeric\/100,2\)/);
  assert.match(sql, /'output_format','mp3','bitrate',192/);
  assert.match(sql, /'cover',v_prompt\.source_version_id/);
  assert.match(sql, /'cover_source',1/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Cover routes measure and sign the server-owned asset without accepting a browser URL', async () => {
  const [quoteRoute, confirmRoute] = await Promise.all([
    readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8'),
  ]);
  assert.match(quoteRoute, /inspectStoredSource\(source\.r2_key/);
  assert.match(quoteRoute, /p_source_duration_seconds: inspected\.seconds/);
  assert.match(confirmRoute, /inspectStoredSource\(context\.r2_key/);
  assert.match(confirmRoute, /p_source_audio_url: inspected\.url/);
  assert.match(confirmRoute, /Math\.abs\(inspected\.seconds - Number\(context\.source_duration_seconds\)\) > 0\.1/);
});

test('0502 sends the Cover bitrate as the string the provider schema requires', async () => {
  // fal-ai/stable-audio-3/small/music/audio-to-audio: bitrate is a string, default '192k'.
  // 0479 sent the number 192 and every Cover job was refused with HTTP 422.
  const fix = await readFile(
    new URL('../packages/db/schema/supabase/0502_music_cover_bitrate_string.sql', import.meta.url), 'utf8');
  assert.match(fix, /^CREATE OR REPLACE FUNCTION public\.music_submit_cover_pair\(/m);
  assert.match(fix, /'output_format'\s*,\s*'mp3'\s*,\s*'bitrate'\s*,\s*'192k'\)/);
  assert.doesNotMatch(fix, /'bitrate'\s*,\s*\d/);
  assert.match(fix, /length\(p_source_audio_url\) > 2008/);
  assert.match(fix, /^REVOKE ALL ON FUNCTION public\.music_submit_cover_pair\(TEXT,UUID,UUID,TEXT,TEXT\) FROM PUBLIC,anon,authenticated;/m);
  assert.match(fix, /^GRANT EXECUTE ON FUNCTION public\.music_submit_cover_pair\(TEXT,UUID,UUID,TEXT,TEXT\) TO service_role;/m);
});
