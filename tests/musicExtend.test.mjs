import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_EXTEND_DURATION_MAX, MUSIC_EXTEND_SECONDS, musicExtendEnabled, parseMusicExtendQuote,
} from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0481_music_tail_extend.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/extend-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/extends/route.js', import.meta.url);
const dialogUrl = new URL('../app/veyrnox/_components/music/MusicExtendDialog.jsx', import.meta.url);
const VERSION_ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

test('Extend parser binds one exact current version, bounded direction and rights', () => {
  assert.equal(MUSIC_EXTEND_SECONDS, 30);
  assert.equal(MUSIC_EXTEND_DURATION_MAX, 120);
  assert.deepEqual(parseMusicExtendQuote({
    version_id: VERSION_ID,
    prompt: '  continue the restrained synth pulse  ',
    rights_confirmed: true,
  }), {
    ok: true,
    versionId: VERSION_ID,
    prompt: 'continue the restrained synth pulse',
    rightsConfirmed: true,
  });
  assert.equal(parseMusicExtendQuote({ version_id: VERSION_ID, prompt: 'x', rights_confirmed: false }).error, 'source_rights_required');
  assert.equal(parseMusicExtendQuote({ version_id: VERSION_ID, prompt: 'x', rights_confirmed: true, audio_url: 'https://attacker.invalid' }).error, 'invalid_request');
});

test('Extend rollout composes schema, generation, dispatch, library and its own gate', () => {
  const ready = {
    MUSIC_SCHEMA_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true',
    FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_EXTEND_ENABLED: 'true',
  };
  assert.equal(musicExtendEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicExtendEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('Extend schema freezes a priced tail-only pair and immutable source lineage', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'ace-step-extend'.*'fal-ai\/ace-step\/audio-outpaint'.*1,0\.0060/s);
  assert.match(sql, /'per_generation',NULL,false,false/);
  assert.match(sql, /source_rights_version='music-extend-source-rights-v1'/);
  assert.match(sql, /'extend_before_duration',0,'extend_after_duration',v_prompt\.extend_seconds_after/);
  assert.match(sql, /'tags',v_prompt\.prompt,'lyrics','\[instrumental\]'/);
  assert.match(sql, /v_operation:=CASE v_prompt\.mode WHEN 'cover' THEN 'cover' ELSE 'extend' END/);
  assert.match(sql, /v_relation:=CASE v_prompt\.mode WHEN 'cover' THEN 'cover_source' ELSE 'extend_source' END/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Extend routes measure and server-sign the immutable source without a browser URL', async () => {
  const [quoteRoute, confirmRoute] = await Promise.all([
    readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8'),
  ]);
  assert.match(quoteRoute, /inspectStoredSource\(source\.r2_key/);
  assert.match(quoteRoute, /p_source_duration_seconds: inspected\.seconds/);
  assert.match(confirmRoute, /inspectStoredSource\(context\.r2_key/);
  assert.match(confirmRoute, /p_source_audio_url: inspected\.url/);
  assert.match(confirmRoute, /Math\.abs\(inspected\.seconds - Number\(context\.source_duration_seconds\)\) > 0\.1/);
});

test('Extend UI discloses the narrow tail-only contract before the exact pair quote', async () => {
  const dialog = await readFile(dialogUrl, 'utf8');
  assert.match(dialog, /Append 30 instrumental seconds/);
  assert.match(dialog, /does not replace the ending, prepend audio, or promise a seamless transition/);
  assert.match(dialog, /Two 30-second continuations · \{quote\.total_credits\} Credits total/);
});
