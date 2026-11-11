import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assetDownloadName } from '../lib/assetDownloadName.js';
import { musicStemsEnabled, parseMusicStemQuote } from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0480_music_stem_archives.sql', import.meta.url);
const webhookUrl = new URL('../lib/falWebhookHandler.js', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/stem-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/stems/route.js', import.meta.url);
const VERSION_ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

test('stem quote parser binds one exact current version and rights attestation', () => {
  assert.deepEqual(parseMusicStemQuote({ version_id: VERSION_ID, rights_confirmed: true }), {
    ok: true, versionId: VERSION_ID, rightsConfirmed: true,
  });
  assert.equal(parseMusicStemQuote({ version_id: VERSION_ID, rights_confirmed: false }).error, 'source_rights_required');
  assert.equal(parseMusicStemQuote({ version_id: VERSION_ID, rights_confirmed: true, audio_url: 'https://attacker.invalid' }).error, 'invalid_request');
});

test('stem rollout composes library, generation, durable dispatch and its own gate', () => {
  const ready = {
    MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true',
    FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_STEMS_ENABLED: 'true',
  };
  assert.equal(musicStemsEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicStemsEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('stems stage exact pricing, warn before one debit, and keep archive access owner-scoped', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'mureka-stems-v3'.*'mureka\/api\/song\/stem'.*13,0\.2000/s);
  assert.match(sql, /'per_generation',NULL,false,false/);
  assert.match(sql, /a\.mime_type IN \('audio\/mpeg','audio\/mp3'\).*a\.size_bytes<=10485760/s);
  assert.match(sql, /'debit:music_stems'/);
  assert.match(sql, /'audio_url',p_source_audio_url,'model','audio-separation-3'/);
  assert.match(sql, /a\.mime_type='application\/zip'/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('stem routes sign only a server-resolved MP3 and never accept a browser URL', async () => {
  const [quoteRoute, confirmRoute] = await Promise.all([
    readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8'),
  ]);
  assert.match(quoteRoute, /inspectStoredSource\(source\.r2_key/);
  assert.match(confirmRoute, /inspectStoredSource\(context\.r2_key/);
  assert.match(confirmRoute, /p_source_audio_url: inspected\.url/);
});

test('fal completion accepts the documented zip_url and ZIP downloads receive a fixed extension', async () => {
  const webhook = await readFile(webhookUrl, 'utf8');
  assert.match(webhook, /typeof p\.zip_url === 'string'/);
  assert.match(webhook, /typeof out\.zip_url === 'string'/);
  assert.equal(assetDownloadName('A5ED2D0D-8276-4FBB-9C4F-39F401A3158B', 'application/zip'), 'veyrnox-a5ed2d0d.zip');
});
