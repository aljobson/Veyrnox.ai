import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mashupSeconds, musicRemixEnabled, parseMusicRemixQuote, remixSourceKey } from '../lib/musicRemix.js';
import { renderPcmWavMix } from '../lib/musicWavRender.js';

const sqlUrl = new URL('../packages/db/schema/supabase/0522_music_mashup_sample.sql', import.meta.url);
const quoteUrl = new URL('../app/api/v1/music/songs/[id]/remix-quotes/route.js', import.meta.url);
const confirmUrl = new URL('../app/api/v1/music/songs/[id]/remixes/route.js', import.meta.url);
const V1 = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
const S2 = '7d2a3c1e-4b5f-4a6d-8e9f-0a1b2c3d4e5f';
const V2 = '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5';

function wav(samples, rate = 8000) {
  const data = new Int16Array(samples);
  const bytes = new Uint8Array(44 + data.byteLength);
  const view = new DataView(bytes.buffer);
  const ascii = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + data.byteLength, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, data.byteLength, true);
  bytes.set(new Uint8Array(data.buffer), 44);
  return bytes;
}

test('Mashup parser requires a second owned version, influence and attestation; refuses URLs', () => {
  const ok = parseMusicRemixQuote({ kind: 'mashup', version_id: V1, second_song_id: S2, second_version_id: V2, prompt: ' house ', source_influence: 50, rights_confirmed: true });
  assert.equal(ok.ok, true); assert.equal(ok.prompt, 'house'); assert.equal(ok.secondVersionId, V2);
  assert.equal(parseMusicRemixQuote({ kind: 'mashup', version_id: V1, second_song_id: S2, second_version_id: V2, prompt: 'x', source_influence: 50, rights_confirmed: false }).error, 'source_rights_required');
  assert.equal(parseMusicRemixQuote({ kind: 'mashup', version_id: V1, second_song_id: S2, second_version_id: V2, prompt: 'x', source_influence: 95, rights_confirmed: true }).error, 'source_influence_invalid');
  assert.equal(parseMusicRemixQuote({ kind: 'mashup', version_id: V1, second_song_id: S2, second_version_id: V2, prompt: 'x', source_influence: 50, rights_confirmed: true, audio_url: 'https://x.invalid' }).error, 'invalid_request');
  assert.equal(parseMusicRemixQuote({ kind: 'remix', version_id: V1 }).error, 'invalid_request');
});

test('Sample parser bounds the clip to 5-30 s and the new music to 10-90 s', () => {
  const base = { kind: 'sample', version_id: V1, prompt: 'x', rights_confirmed: true };
  assert.equal(parseMusicRemixQuote({ ...base, start_seconds: 2, end_seconds: 17, extend_seconds: 60 }).ok, true);
  assert.equal(parseMusicRemixQuote({ ...base, start_seconds: 0, end_seconds: 4, extend_seconds: 60 }).error, 'sample_range_invalid');
  assert.equal(parseMusicRemixQuote({ ...base, start_seconds: 0, end_seconds: 31, extend_seconds: 60 }).error, 'sample_range_invalid');
  assert.equal(parseMusicRemixQuote({ ...base, start_seconds: 0, end_seconds: 10, extend_seconds: 95 }).error, 'sample_extend_invalid');
  assert.equal(parseMusicRemixQuote({ ...base, start_seconds: 0, end_seconds: 10, extend_seconds: 60, second_song_id: S2 }).error, 'invalid_request');
});

test('Remix gate needs Cover gates plus its own switch, which ships false', async () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true', FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_COVER_ENABLED: 'true', MUSIC_REMIX_ENABLED: 'true' };
  assert.equal(musicRemixEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicRemixEnabled({ ...ready, [key]: 'false' }), false, key);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.equal((wrangler.match(/\\"remix\\":false/g) || []).length, 2);
});

test('WAV mix halves each input, keeps the shorter length and refuses mismatched formats', () => {
  const mixed = renderPcmWavMix(wav([1000, 2000, -4000, 30000]), wav([1000, 2000, 4000]), 120);
  assert.equal(mixed.ok, true);
  const view = new DataView(mixed.bytes.buffer, 44);
  assert.deepEqual([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)], [1000, 2000, 0]);
  assert.equal(mixed.seconds, 3 / 8000);
  assert.equal(renderPcmWavMix(wav([1, 2]), wav([1, 2], 16000)).error, 'mix_format_mismatch');
  assert.equal(mashupSeconds(200, 150), 120);
  assert.match(remixSourceKey(V1), /^music-remix-sources\/b6ed2d0d-8276-4fbb-9c4f-39f401a3158c\/[0-9a-f-]{36}\.wav$/);
});

test('0522 stages both rows inactive, prices from the catalog and sends schema-typed payloads', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  assert.match(sql, /'stable-audio-3-mashup'[\s\S]*?'fal-ai\/stable-audio-3\/small\/music\/audio-to-audio'[\s\S]*?2,0\.0248,'per_generation',NULL,false,false/);
  assert.match(sql, /'stable-audio-3-sample'[\s\S]*?'fal-ai\/stable-audio-3\/small\/music\/audio-outpainting'[\s\S]*?2,0\.0265,'per_generation',NULL,false,false/);
  assert.match(sql, /'extend_seconds_after',v_prompt\.sample_extend_seconds/);
  assert.match(sql, /'init_noise_level',round\(1-v_prompt\.source_influence::numeric\/100,2\)/);
  assert.match(sql, /split_part\(p_prepared_r2_key,'\/',2\)<>v_user::text/);
  assert.match(sql, /ALTER TABLE public\.music_remix_sources FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /INSERT INTO public\.asset_reap_queue\(r2_key\)/);
  assert.equal((sql.match(/public\.ledger_debit\(/g) || []).length, 2);
  assert.doesNotMatch(sql, /INSERT INTO public\.ledger_entries|UPDATE public\.credit_balances/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (authenticated|anon)/);
  assert.doesNotMatch(sql, /IF [^;]*CASE [^;]*THEN[^;]*END THEN/);
});

test('Remix routes measure stored audio and never accept a browser URL', async () => {
  const [quote, confirm] = await Promise.all([readFile(quoteUrl, 'utf8'), readFile(confirmUrl, 'utf8')]);
  assert.match(quote, /inspectStoredSource\(source\.r2_key/);
  assert.match(quote, /p_source_duration_seconds: duration/);
  assert.match(confirm, /renderPcmWavMix\(sources\[0\], sources\[1\]/);
  assert.match(confirm, /renderPcmWavCrop\(sources\[0\]/);
  assert.match(confirm, /p_prepared_audio_url: signed\.url/);
  assert.match(confirm, /await deleteObject\(preparedKey, r2cfg\)/);
});
