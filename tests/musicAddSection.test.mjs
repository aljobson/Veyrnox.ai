import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_ADD_SECTION_DURATION_MAX, MUSIC_ADD_SECTION_SOURCE_MAX,
  musicAddSectionEnabled, parseMusicAddSectionQuote,
} from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0487_music_add_section.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/add-section-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/sections/route.js', import.meta.url);
const dialogUrl = new URL('../app/veyrnox/_components/music/MusicAddSectionDialog.jsx', import.meta.url);
const VERSION = 'a6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

test('Add Section parser freezes edge, bounded seconds, optional lyrics, style and rights', () => {
  assert.equal(MUSIC_ADD_SECTION_DURATION_MAX, 30);
  assert.equal(MUSIC_ADD_SECTION_SOURCE_MAX, 120);
  assert.deepEqual(parseMusicAddSectionQuote({
    version_id: VERSION, position: 'end', duration_seconds: 20,
    lyrics: '  [Bridge]\nHold the light  ', styles: '  restrained synth bridge  ', rights_confirmed: true,
  }), {
    ok: true, versionId: VERSION, position: 'end', durationSeconds: 20,
    lyrics: '[Bridge]\nHold the light', styles: 'restrained synth bridge', rightsConfirmed: true,
  });
  assert.equal(parseMusicAddSectionQuote({ version_id: VERSION, position: 'middle', duration_seconds: 20, lyrics: '', styles: 'x', rights_confirmed: true }).error, 'section_position_invalid');
  assert.equal(parseMusicAddSectionQuote({ version_id: VERSION, position: 'end', duration_seconds: 15, lyrics: '', styles: 'x', rights_confirmed: true }).error, 'section_duration_invalid');
  assert.equal(parseMusicAddSectionQuote({ version_id: VERSION, position: 'end', duration_seconds: 20, lyrics: '', styles: 'x', rights_confirmed: true, audio_url: 'https://attacker.invalid' }).error, 'invalid_request');
});

test('Add Section rollout composes all durable gates and its independent switch', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true', FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_ADD_SECTION_ENABLED: 'true' };
  assert.equal(musicAddSectionEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicAddSectionEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('Add Section stages exact max pricing, lyrics/style payload and immutable lineage', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'ace-step-add-section'.*'fal-ai\/ace-step\/audio-outpaint'.*1,0\.0060/s);
  assert.match(sql, /section_position IN \('beginning','end'\)/);
  assert.match(sql, /section_duration_seconds IN \(10,20,30\)/);
  assert.match(sql, /'extend_before_duration',CASE WHEN v_prompt\.section_position='beginning'/);
  assert.match(sql, /'extend_after_duration',CASE WHEN v_prompt\.section_position='end'/);
  assert.match(sql, /'tags',v_prompt\.styles,'lyrics',COALESCE\(v_prompt\.lyrics,'\[instrumental\]'\)/);
  assert.match(sql, /ELSE 'add_section' END/);
  assert.match(sql, /'music-add-section-source-rights-v1'/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Add Section routes measure, remeasure and server-sign only the current owned source', async () => {
  const [quote, confirm] = await Promise.all([readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8')]);
  assert.match(quote, /inspectStoredSource\(source\.r2_key/);
  assert.match(quote, /p_source_duration_seconds: inspected\.seconds/);
  assert.match(confirm, /inspectStoredSource\(context\.r2_key/);
  assert.match(confirm, /p_source_audio_url: inspected\.url/);
  assert.match(confirm, /Math\.abs\(inspected\.seconds - Number\(context\.source_duration_seconds\)\) > 0\.1/);
});

test('Add Section UI discloses its edge-only provider boundary before spending', async () => {
  const dialog = await readFile(dialogUrl, 'utf8');
  assert.match(dialog, /Create two 10, 20, or 30 second alternatives at the beginning or end/);
  assert.match(dialog, /does not insert into the middle, count beats, replace an existing passage, or promise a seamless join/);
  assert.match(dialog, /Leave empty for an instrumental section/);
  assert.match(dialog, /Review exact Add Section quote/);
});
