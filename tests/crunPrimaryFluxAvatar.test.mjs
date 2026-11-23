import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildRequest, endpointKind, parseEndpoint, submitTask } from '../packages/adapters/crun.js';
import { capabilityFor, checkSource } from '../lib/modelCapabilities.js';
import { classifySubmitFailure } from '../lib/supplierRoutesFailover.js';

const flux = { model: 'flux-2-pro' };
const avatar = { model: 'kling/avatar' };
const image = 'https://r2.example/photo.png?sig=secret';
const audio = 'https://r2.example/voice.mp3?sig=secret';
const sql = readFileSync('packages/db/schema/supabase/0581_crun_first_flux_avatar.sql', 'utf8');
const CAP = 0.01796; // ADR-0037

test('Flux sends the proved request, keeps the seed and the 4:3 default', () => {
  assert.deepEqual(buildRequest(flux, { prompt: ' a bike ', seed: 0, aspect_ratio: '16:9', duration_seconds: 5 }), {
    ok: true,
    body: { model: 'flux-2-pro', input: { prompt: 'a bike', aspect_ratio: '16:9', resolution: '1K', output_format: 'png', seed: 0 } },
  });
  const plain = buildRequest(flux, { prompt: 'a bike' });
  assert.equal(plain.body.input.aspect_ratio, '4:3');
  assert.equal(Object.hasOwn(plain.body.input, 'seed'), false);
  assert.equal(endpointKind('crun:flux-2-pro'), 'image');
});

test('Flux refuses what Crun or the priced unit cannot take', () => {
  assert.equal(buildRequest(flux, { prompt: 'x'.repeat(5000) }).ok, true);
  assert.deepEqual(buildRequest(flux, { prompt: 'x'.repeat(5001) }), { ok: false, error: 'inputs_invalid:prompt' });
  assert.deepEqual(buildRequest(flux, { prompt: '  ' }), { ok: false, error: 'inputs_invalid:prompt' });
  assert.deepEqual(buildRequest(flux, { prompt: 'a', aspect_ratio: '21:9' }), { ok: false, error: 'inputs_invalid:aspect_ratio' });
  assert.deepEqual(buildRequest(flux, { prompt: 'a', seed: 1.5 }), { ok: false, error: 'inputs_invalid:seed' });
  assert.deepEqual(buildRequest(flux, { prompt: 'a', duration_seconds: 10 }), { ok: false, error: 'duration_not_supported' });
  assert.deepEqual(buildRequest(flux, { prompt: 'a', image_url: image }), { ok: false, error: 'inputs_key_not_allowed:image_url' });
});

test('Avatar sends std mode with both sources and an optional prompt', () => {
  assert.deepEqual(buildRequest(avatar, { image_url: image, audio_url: audio, prompt: ' speak ', duration_seconds: 5 }), {
    ok: true,
    body: { model: 'kling/avatar', input: { mode: 'std', image_url: image, audio_url: audio, prompt: 'speak' } },
  });
  assert.equal(Object.hasOwn(buildRequest(avatar, { image_url: image, audio_url: audio, prompt: '' }).body.input, 'prompt'), false);
  assert.equal(endpointKind('crun:kling/avatar'), 'video');
  assert.deepEqual(parseEndpoint('crun:kling/avatar'), avatar);
});

test('Avatar refuses missing or unsafe sources and an over-long prompt', () => {
  assert.deepEqual(buildRequest(avatar, { audio_url: audio }), { ok: false, error: 'inputs_invalid:image_url' });
  assert.deepEqual(buildRequest(avatar, { image_url: image }), { ok: false, error: 'inputs_invalid:audio_url' });
  assert.deepEqual(buildRequest(avatar, { image_url: 'http://x.test/a.png', audio_url: audio }), { ok: false, error: 'inputs_invalid:image_url' });
  assert.deepEqual(buildRequest(avatar, { image_url: image, audio_url: audio, prompt: 'x'.repeat(2501) }), { ok: false, error: 'inputs_invalid:prompt' });
  assert.deepEqual(buildRequest(avatar, { image_url: image, audio_url: audio, duration_seconds: 10 }), { ok: false, error: 'duration_not_supported' });
});

test('Avatar uploads outside Crun limits are refused before the debit', () => {
  const record = capabilityFor('crun:kling/avatar');
  const photo = { contentType: 'image/png', sizeBytes: 1000, dimensions: { width: 960, height: 960 }, seconds: null };
  const voice = { contentType: 'audio/mpeg', sizeBytes: 1000, seconds: 10, dimensions: null };
  const check = (image_url, audio_url) => checkSource(record, { image_url, audio_url });
  assert.deepEqual(check(photo, voice), { ok: true });
  assert.equal(check({ ...photo, contentType: 'image/webp' }, voice).error, 'source_type_unsupported');
  assert.equal(check({ ...photo, sizeBytes: 10_000_001 }, voice).error, 'source_too_large');
  assert.equal(check({ ...photo, dimensions: { width: 299, height: 600 } }, voice).error, 'source_resolution_out_of_range');
  assert.equal(check({ ...photo, dimensions: { width: 400, height: 1200 } }, voice).error, 'source_aspect_out_of_range');
  assert.equal(check(photo, { ...voice, seconds: 1.9 }).error, 'source_too_short');
  assert.equal(check(photo, { ...voice, seconds: 10.1 }).error, 'source_too_long');
  assert.equal(check(photo, { ...voice, seconds: null }).error, 'source_length_unknown');
  assert.equal(check(photo, { ...voice, sizeBytes: 5_000_001 }).error, 'source_too_large');
});

test('an Avatar refusal keeps no Crun text and refunds; a Flux capacity refusal may hop to fal', async () => {
  const realFetch = globalThis.fetch;
  const reply = (status, code, message) => async () => new Response(JSON.stringify({ code, message }), { status });
  try {
    globalThis.fetch = reply(422, 422, `invalid parameter ${audio}`);
    const refused = await submitTask({ job_id: 'job-1', provider_endpoint: 'crun:kling/avatar', inputs: { image_url: image, audio_url: audio } }, { apiKey: 'test' });
    assert.deepEqual(refused, { ok: false, outcome: 'rejected', error: 'crun 422/422: invalid_input' });
    assert.equal(classifySubmitFailure(refused), 'stop');
    globalThis.fetch = reply(429, 429, 'busy');
    const busy = await submitTask({ job_id: 'job-2', provider_endpoint: 'crun:flux-2-pro', inputs: { prompt: 'a bike' } }, { apiKey: 'test' });
    assert.equal(busy.outcome, 'rejected');
    assert.equal(classifySubmitFailure(busy), 'failover');
    globalThis.fetch = async () => { throw new Error(`socket closed ${audio}`); };
    const unknown = await submitTask({ job_id: 'job-3', provider_endpoint: 'crun:kling/avatar', inputs: { image_url: image, audio_url: audio } }, { apiKey: 'test' });
    assert.deepEqual(unknown, { ok: false, outcome: 'unknown', error: 'transport' });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a null length means not set: both offers proceed and send no length', () => {
  for (const [target, inputs] of [[flux, { prompt: 'a bike' }], [avatar, { image_url: image, audio_url: audio }]]) {
    assert.deepEqual(buildRequest(target, { ...inputs, duration_seconds: null }), buildRequest(target, inputs));
    assert.equal(buildRequest(target, { ...inputs, duration_seconds: null }).ok, true);
    assert.deepEqual(buildRequest(target, { ...inputs, duration_seconds: 0 }), { ok: false, error: 'duration_not_supported' });
  }
});

test('costs sit inside the floor, Avatar at its longest allowed audio', () => {
  assert.equal((5 / 206).toFixed(4), '0.0243');
  assert.equal(((6.5 * 10) / 206).toFixed(4), '0.3155');
  assert.equal(capabilityFor('crun:kling/avatar').media.audio.maxSeconds, 10);
  assert.ok(0.0243 <= 2 * CAP);
  assert.ok(0.3155 <= 32 * CAP);
  assert.ok(0.03 <= 2 * CAP, 'fal, second on the Flux offer, needs no margin waiver');
});

test('the migration moves only the two offers, through the guarded reorder, with exact assertions', () => {
  assert.match(sql, /'flux-2-pro', 'crun:flux-2-pro', 0\.0243/);
  assert.match(sql, /'kling-avatar-v2', 'crun:kling\/avatar', 0\.3155/);
  for (const stayed of ['nano-banana-pro-edit', 'seedance-2.0-reference', "'kling-3.0-i2v'"]) assert.equal(sql.includes(stayed), false, stayed);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i, 'the catalog row is changed only by model_route_reorder');
  assert.doesNotMatch(sql, /credits_5s\s*=\s*\d/, 'no literal price is written');
  assert.ok(sql.indexOf("state = 'active'") < sql.indexOf('model_route_reorder('), 'proof comes before the reorder');
  assert.match(sql, /ON CONFLICT \(model_id, supplier, endpoint\) DO NOTHING/);
  assert.match(sql, /GET DIAGNOSTICS affected = ROW_COUNT;\s+IF affected <> 1/);
  assert.match(sql, /IF affected <> 2 THEN/);
});

test('the DB acceptance script expects both new routes', () => {
  const failover = readFileSync('scripts/test-supplier-route-failover.mjs', 'utf8');
  assert.match(failover, /'crun:bytedance\/seedream-4', 'crun:flux-2-pro', 'crun:google\/nano-banana'/);
  assert.match(failover, /'crun:google\/veo3-1-lite-t2v', 'crun:google\/veo3-1-t2v', 'crun:image-background-remove', 'crun:image-upscale', 'crun:kling\/avatar', 'crun:kling\/o1-r2v'/);
});
