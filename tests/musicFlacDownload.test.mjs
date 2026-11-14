import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMusicExportQuote } from '../lib/musicBackend.js';
import { assetDownloadName } from '../lib/assetDownloadName.js';

// fal-ai/ace-step-1.5 returns FLAC with no way to ask for another format. Before
// 0506 such a song answered FORMAT_UNAVAILABLE for MP3 and for WAV, so it could
// not be downloaded at all. FLAC is offered only when the stored asset is FLAC.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('../packages/db/schema/supabase/0506_music_flac_download.sql');
const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
const VERSION_ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

test('the export quote parser accepts flac and still refuses unknown formats', () => {
  assert.deepEqual(parseMusicExportQuote({ version_id: VERSION_ID, format: 'flac' }), { ok: true, versionId: VERSION_ID, format: 'flac' });
  assert.equal(parseMusicExportQuote({ version_id: VERSION_ID, format: 'mp3' }).ok, true);
  assert.equal(parseMusicExportQuote({ version_id: VERSION_ID, format: 'wav' }).ok, true);
  for (const format of ['ogg', 'FLAC', 'audio/flac', '', undefined]) {
    assert.equal(parseMusicExportQuote({ version_id: VERSION_ID, format }).error, 'format_not_supported');
  }
});

test('0506 allows flac in the quote table and only for an asset stored as FLAC', () => {
  const drop = code.indexOf('DROP CONSTRAINT IF EXISTS music_export_quotes_format_check;');
  const add = code.indexOf("CHECK (format IN ('mp3','wav','flac'));");
  assert.ok(drop >= 0 && add > drop, 'the format check must be dropped, then re-added with flac');
  assert.match(code, /p_format NOT IN \('mp3','wav','flac'\)/);
  assert.match(code, /p_format = 'flac' AND lower\(v_asset\.mime_type\) NOT IN \('audio\/flac','audio\/x-flac'\)/);
  // The MP3 and WAV rules are unchanged: each format still requires its own stored type.
  assert.match(code, /p_format = 'mp3' AND lower\(v_asset\.mime_type\) NOT IN \('audio\/mpeg','audio\/mp3'\)/);
  assert.match(code, /p_format = 'wav' AND lower\(v_asset\.mime_type\) NOT IN \('audio\/wav','audio\/x-wav','audio\/wave'\)/);
});

test('0506 keeps the 0505 allowance rule and the function privileges', () => {
  assert.doesNotMatch(code, /PLAN_UNAVAILABLE/);
  assert.match(code, /WHEN 'starter-yearly' THEN 20/);
  assert.match(code, /ELSE 7/);
  assert.match(code, /SECURITY DEFINER SET search_path = ''/);
  assert.ok(code.includes('REVOKE ALL ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;'));
  assert.ok(code.includes('GRANT EXECUTE ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) TO service_role;'));
});

test('the download route serves a FLAC export as audio/flac with a .flac name', () => {
  const route = read('../app/api/v1/music/exports/[id]/route.js');
  assert.match(route, /flac: new Set\(\['audio\/flac', 'audio\/x-flac'\]\)/);
  assert.match(route, /CANONICAL_MIME_TYPES = Object\.freeze\(\{[^}]*flac: 'audio\/flac'[^}]*\}\)/);
  assert.equal(assetDownloadName('1a2b3c4d-0000-4000-8000-000000000000', 'audio/flac'), 'veyrnox-1a2b3c4d.flac');
});

test('the download dialog offers FLAC beside MP3 and WAV', () => {
  const dialog = read('../app/veyrnox/_components/music/MusicDistributionDialog.jsx');
  for (const value of ['mp3', 'wav', 'flac']) assert.ok(dialog.includes(`<option value="${value}">${value.toUpperCase()}</option>`));
});
