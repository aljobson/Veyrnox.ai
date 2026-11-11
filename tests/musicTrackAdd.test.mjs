import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicTrackAddEnabled, parseMusicTrackAddQuote } from '../lib/musicBackend.js';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0489_music_track_add.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/track-add-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/track-adds/route.js', import.meta.url);
const assetRouteUrl = new URL('../app/api/v1/music/track-add-requests/[id]/audio/route.js', import.meta.url);

test('track-add parser freezes vocal lyrics and both rights attestations', () => {
  const version = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseMusicTrackAddQuote({ version_id: version, mode: 'vocals', prompt: 'Warm lead',
    lyrics: 'Stay with me', vocal_gender: 'female', rights_confirmed: true, lyrics_rights_confirmed: true }), {
    ok: true, versionId: version, mode: 'vocals', prompt: 'Warm lead', lyrics: 'Stay with me',
    vocalGender: 'female', rightsConfirmed: true, lyricsRightsConfirmed: true,
  });
  assert.equal(parseMusicTrackAddQuote({ version_id: version, mode: 'vocals', prompt: 'Warm lead', lyrics: 'Borrowed', rights_confirmed: true, lyrics_rights_confirmed: false }).error, 'lyrics_rights_required');
  assert.equal(parseMusicTrackAddQuote({ version_id: version, mode: 'vocals', prompt: 'Warm lead', lyrics: '', rights_confirmed: true, lyrics_rights_confirmed: true }).error, 'lyrics_invalid');
});

test('track-add parser keeps instrumental requests lyric-free', () => {
  const version = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseMusicTrackAddQuote({ version_id: version, mode: 'instrumental', prompt: 'Live drums',
    lyrics: '', rights_confirmed: true, lyrics_rights_confirmed: false }), {
    ok: true, versionId: version, mode: 'instrumental', prompt: 'Live drums', lyrics: null, vocalGender: 'auto',
    rightsConfirmed: true, lyricsRightsConfirmed: false,
  });
  assert.equal(parseMusicTrackAddQuote({ version_id: version, mode: 'instrumental', prompt: 'Live drums', lyrics: 'No', rights_confirmed: true, lyrics_rights_confirmed: false }).error, 'lyrics_not_applicable');
  assert.equal(parseMusicTrackAddQuote({ version_id: version, mode: 'instrumental', prompt: 'Live drums', lyrics: '', vocal_gender: 'male', rights_confirmed: true, lyrics_rights_confirmed: false }).error, 'lyrics_not_applicable');
  assert.equal(parseMusicTrackAddQuote({ version_id: version, mode: 'instrumental', prompt: 'Live drums', lyrics: '', rights_confirmed: false, lyrics_rights_confirmed: false }).error, 'source_rights_required');
});

test('track-add rollout composes durable generation and library gates', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true', FAL_DISPATCH_SCHEMA_ENABLED: 'true',
    MUSIC_LIBRARY_ENABLED: 'true', MUSIC_TRACK_ADD_ENABLED: 'true' };
  assert.equal(musicTrackAddEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicTrackAddEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('migration atomically debits upload and generation but dispatches only upload first', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'mureka-audio-upload'.*'mureka\/api\/files\/upload'/s);
  assert.match(sql, /'mureka-track-add-v8'.*'mureka\/v8\/generate\/track'/s);
  assert.match(sql, /p_idempotency_key\|\|'\.upload',1,'debit:music_track_upload'/);
  assert.match(sql, /p_idempotency_key\|\|'\.track',6,'debit:music_track_add'/);
  assert.match(sql, /jsonb_build_object\('file_url',p_source_audio_url,'purpose','audio'\)/);
  assert.match(sql, /music_advance_track_add_upload/);
  assert.match(sql, /'upload_audio_id',p_upload_audio_id/);
  assert.match(sql, /'generate_type',CASE WHEN v_quote\.mode='vocals' THEN 'Vocals' ELSE 'Instrumental' END/);
  assert.match(sql, /IF v_quote\.mode='vocals' THEN v_payload:=v_payload\|\|jsonb_build_object\('lyrics',v_quote\.lyrics\)/);
  assert.match(sql, /jsonb_build_object\('vocal_gender',v_quote\.vocal_gender\)/);
  assert.match(sql, /music_fail_track_add_upload/);
  assert.match(sql, /refund:music_track_upload_failed/);
});

test('track-add routes remeasure owner-resolved MP3 bytes and expose only the stored generated part', async () => {
  const [quote, confirm, asset] = await Promise.all([readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8'), readFile(assetRouteUrl, 'utf8')]);
  assert.match(quote, /music_get_track_add_source_context/);
  assert.match(quote, /inspectStoredSource\(source\.r2_key/);
  assert.match(quote, /inspected\.sizeBytes > MAX_BYTES/);
  assert.match(quote, /inspected\.seconds > MUSIC_TRACK_ADD_SOURCE_MAX/);
  assert.doesNotMatch(quote, /decoded\.value\.audio_url/);
  assert.match(confirm, /Number\(inspected\.sizeBytes\) !== Number\(context\.source_size_bytes\)/);
  assert.match(confirm, /publishFalDispatchWakeup\(result\.upload_job_id\)/);
  assert.match(asset, /music_get_track_add_asset_context/);
  assert.match(asset, /presignGetUrl\(context\.r2_key, 300/);
});

function handlerFor({ model = 'mureka-audio-upload', rpcCall, dispatchWakeup = () => {} }) {
  return createFalWebhookHandler({
    config: () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'service' }),
    storageConfig: () => ({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }),
    expectedTenant: () => 'tenant', verify: async () => true, dispatchWakeup, rpcCall,
    fetchCall: async (url, init = {}) => {
      if (url.pathname === '/rest/v1/jobs') return Response.json([{ id: 'upload-job', user_id: 'user', credits: 1, state: 'SUBMITTED', model_id: model }]);
      if (url.pathname === '/rest/v1/webhook_events' && init.method === 'POST') return Response.json([{ id: 'event' }], { status: 201 });
      if (url.pathname === '/rest/v1/webhook_events' && init.method === 'PATCH') return new Response(null, { status: 204 });
      throw new Error(`unexpected ${init.method || 'GET'} ${url.pathname}`);
    },
  });
}

function falRequest(body) {
  return new Request('https://app.test/api/webhook/fal', { method: 'POST', headers: {
    'x-fal-webhook-request-id': 'upload-request', 'x-fal-webhook-user-id': 'tenant',
  }, body: JSON.stringify({ request_id: 'upload-request', ...body }) });
}

test('fal upload success advances the frozen track job and wakes only that dispatch', async () => {
  const calls = []; const wakes = [];
  const handler = handlerFor({ dispatchWakeup: (id) => wakes.push(id), rpcCall: async (name, args) => {
    calls.push({ name, args });
    if (name === 'job_succeeded') return { ok: true };
    if (name === 'music_advance_track_add_upload') return { ok: true, track_job_id: 'track-job' };
    throw new Error(`unexpected rpc ${name}`);
  } });
  const response = await handler(falRequest({ status: 'OK', payload: { id: 'mureka_upload_123' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.name), ['job_succeeded', 'music_advance_track_add_upload']);
  assert.equal(calls[1].args.p_upload_audio_id, 'mureka_upload_123');
  assert.deepEqual(wakes, ['track-job']);
});

test('fal upload failure couples both staged refunds without generic double-refund', async () => {
  const calls = [];
  const handler = handlerFor({ rpcCall: async (name, args) => { calls.push({ name, args });
    if (name === 'music_fail_track_add_upload') return { ok: true }; throw new Error(`unexpected rpc ${name}`); } });
  const response = await handler(falRequest({ status: 'failed', error: { code: 'upload_refused' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.name), ['music_fail_track_add_upload']);
  assert.equal(calls[0].args.p_error_code, 'upload_refused');
});

test('malformed successful upload is settled as a coupled staged failure', async () => {
  const calls = [];
  const handler = handlerFor({ rpcCall: async (name) => { calls.push(name);
    if (name === 'job_succeeded' || name === 'music_fail_track_add_upload') return { ok: true };
    throw new Error(`unexpected rpc ${name}`); } });
  const response = await handler(falRequest({ status: 'OK', payload: { id: 'contains spaces' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['job_succeeded', 'music_fail_track_add_upload']);
});
