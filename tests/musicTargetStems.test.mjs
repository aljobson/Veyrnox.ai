import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  musicTargetStemsEnabled, parseMusicTargetStemQuote,
} from '../lib/musicBackend.js';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0488_music_target_stem_pair.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/target-stem-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/target-stems/route.js', import.meta.url);
const assetRouteUrl = new URL('../app/api/v1/music/target-stem-requests/[id]/[kind]/route.js', import.meta.url);

test('target stem parser freezes one allowlisted sound and source-rights attestation', () => {
  const version = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseMusicTargetStemQuote({ version_id: version, instrument: 'guitar', rights_confirmed: true }), {
    ok: true, versionId: version, instrument: 'guitar', rightsConfirmed: true,
  });
  assert.equal(parseMusicTargetStemQuote({ version_id: version, instrument: 'lead guitar', rights_confirmed: true }).error, 'instrument_invalid');
  assert.equal(parseMusicTargetStemQuote({ version_id: version, instrument: 'guitar', rights_confirmed: false }).error, 'source_rights_required');
  assert.equal(parseMusicTargetStemQuote({ version_id: version, instrument: 'guitar', rights_confirmed: true, audio_url: 'https://attacker.test/a.wav' }).error, 'invalid_request');
});

test('target stem rollout composes durable generation and library gates', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true',
    FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_TARGET_STEMS_ENABLED: 'true' };
  assert.equal(musicTargetStemsEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicTargetStemsEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('migration prices measured 30-second tiers and dispatches exact SAM target/residual inputs', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'sam-audio-target-stem'.*'fal-ai\/sam-audio\/separate'/s);
  assert.match(sql, /CASE WHEN p_source_duration_seconds<=30 THEN 4 WHEN p_source_duration_seconds<=60 THEN 7/);
  assert.match(sql, /'debit:music_target_stem'/);
  assert.match(sql, /'prompt',v_quote\.provider_prompt/);
  assert.match(sql, /'predict_spans',true,'reranking_candidates',1,'acceleration','balanced'/);
  assert.match(sql, /'max_chunk_duration',60,'chunk_overlap',5,'output_format','wav'/);
  assert.match(sql, /music_store_target_stem_pair/);
  assert.match(sql, /target_asset_id UUID NOT NULL UNIQUE/);
  assert.match(sql, /residual_asset_id UUID NOT NULL UNIQUE/);
  assert.match(sql, /state='STORED'/);
});

test('target stem routes remeasure server-resolved bytes and expose only owner-signed target or residual assets', async () => {
  const [quote, confirm, asset] = await Promise.all([
    readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8'), readFile(assetRouteUrl, 'utf8'),
  ]);
  assert.match(quote, /music_get_target_stem_source_context/);
  assert.match(quote, /inspectStoredSource\(source\.r2_key/);
  assert.match(quote, /inspected\.seconds > MUSIC_TARGET_STEM_DURATION_MAX/);
  assert.doesNotMatch(quote, /decoded\.value\.audio_url/);
  assert.match(confirm, /music_get_target_stem_dispatch_context/);
  assert.match(confirm, /Math\.abs\(Number\(inspected\.seconds\) - Number\(context\.source_duration_seconds\)\) > 0\.05/);
  assert.match(confirm, /publishFalDispatchWakeup/);
  assert.match(asset, /\['target', 'residual'\]\.includes\(kind\)/);
  assert.match(asset, /music_get_target_stem_asset_context/);
  assert.match(asset, /presignGetUrl\(context\.r2_key, 300/);
});

test('fal callback copies and transactionally registers both target and residual outputs', async () => {
  const copied = []; const rpcNames = []; const storedArgs = [];
  const handler = createFalWebhookHandler({
    config: () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'service' }),
    storageConfig: () => ({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }),
    expectedTenant: () => 'tenant', verify: async () => true,
    fetchCall: async (url, init = {}) => {
      if (url.pathname === '/rest/v1/jobs') return Response.json([{ id: 'job', user_id: 'user', credits: 4,
        state: 'SUBMITTED', model_id: 'sam-audio-target-stem' }]);
      if (url.pathname === '/rest/v1/webhook_events' && init.method === 'POST') return Response.json([{ id: 'event' }], { status: 201 });
      if (url.pathname === '/rest/v1/webhook_events' && init.method === 'PATCH') return new Response(null, { status: 204 });
      throw new Error(`unexpected ${init.method || 'GET'} ${url.pathname}`);
    },
    copyAsset: async (url, key) => {
      copied.push({ url, key });
      return { ok: true, r2Key: key, mimeType: 'audio/wav', size: url.includes('target') ? 101 : 202,
        sha256: url.includes('target') ? 'a'.repeat(64) : 'b'.repeat(64) };
    },
    rpcCall: async (name, args) => {
      rpcNames.push(name);
      if (name === 'job_succeeded') return { ok: true };
      if (name === 'music_store_target_stem_pair') { storedArgs.push(args); return { ok: true }; }
      throw new Error(`unexpected rpc ${name}`);
    },
  });
  const response = await handler(new Request('https://app.test/api/webhook/fal', {
    method: 'POST', headers: {
      'x-fal-webhook-request-id': 'sam-request', 'x-fal-webhook-user-id': 'tenant',
    }, body: JSON.stringify({ request_id: 'sam-request', status: 'OK', payload: {
      target: { url: 'https://fal.media/target.wav', content_type: 'audio/wav' },
      residual: { url: 'https://fal.media/residual.wav', content_type: 'audio/wav' },
    } }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(rpcNames, ['job_succeeded', 'music_store_target_stem_pair']);
  assert.deepEqual(copied.map((entry) => entry.url), ['https://fal.media/target.wav', 'https://fal.media/residual.wav']);
  assert.notEqual(copied[0].key, copied[1].key);
  assert.equal(storedArgs[0].p_target_size_bytes, 101);
  assert.equal(storedArgs[0].p_residual_size_bytes, 202);
  assert.equal(storedArgs[0].p_target_sha256, 'a'.repeat(64));
  assert.equal(storedArgs[0].p_residual_sha256, 'b'.repeat(64));
});
