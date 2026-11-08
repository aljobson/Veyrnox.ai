import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityFor, REGISTRY, checkSource, checkInputs, publicCapabilities, declaredInputs } from '../lib/modelCapabilities.js';
import { buildRequest, parseEndpoint } from '../packages/adapters/kie.js';
import { loadTemplateClip } from '../lib/templateClipGate.js';
import { TEMPLATE_CLIP_MODELS, resolveTemplateClipVideo, checkTemplateClipVideoSource } from '../lib/templateClipGeneration.js';
import { TEMPLATE_CLIP_PROMPT } from '../lib/templateClipPrompt.mjs';
import { checkCatalogUpdates } from '../scripts/check-catalog-update-guards.mjs';
import { id, catalog, kieCatalog, kieSource } from './fixtures/templateClips.mjs';
const record = capabilityFor(kieCatalog.provider_endpoint);
const video = { dimensions: { width: 1280, height: 720 }, seconds: 5, videoSeconds: 5, sizeBytes: 1000, frameRate: 30 };
const image = { dimensions: { width: 640, height: 640 }, sizeBytes: 1000 };

test('kie contract is one photo, one private clip, integer durations, fixed audio and resolution', () => {
  assert.ok(Object.isFrozen(TEMPLATE_CLIP_MODELS));
  assert.equal(record.provider, 'kie'); assert.equal(record.kind, 'video');
  assert.deepEqual(record.lengths, { field: 'duration', map: { 5: 5, 10: 10 } });
  assert.deepEqual(record.fixed, { resolution: '720p', generate_audio: true });
  assert.deepEqual(record.inputs.aspect_ratio.values, ['1:1','4:3','3:4','16:9','9:16','21:9']);
  assert.equal(record.inputs.prompt.max, 20000);
  assert.equal(record.media.image.max, 1); assert.equal(record.media.image.verifiedAt, undefined);
  assert.equal(publicCapabilities(record).media.image.maxFiles, 1);
  assert.deepEqual(Object.keys(publicCapabilities(record).media), ['image']);
  // New validation is opt-in. No other record acquires these bounds.
  assert.deepEqual(Object.entries(REGISTRY).filter(([, r]) => Object.values(r.media).some(s => s.minAspect || s.minPixels || s.maxBytesExclusive || s.minFrameRate)).map(([ep]) => ep), [kieCatalog.provider_endpoint]);
  assert.equal(checkSource(record, { video_url: video, image_url: image }).ok, true);
});

test('kie shared payload shaper supports image-only jobs and never accepts frame fields or tier overrides', () => {
  const target = parseEndpoint(kieCatalog.provider_endpoint);
  const inputs = { prompt: TEMPLATE_CLIP_PROMPT, image_url: ['photo'], video_url: ['clip'], duration_seconds: 5, aspect_ratio: '9:16' };
  assert.deepEqual(buildRequest(target, inputs), { ok: true, body: { model: 'bytedance/seedance-2', input: {
    prompt: TEMPLATE_CLIP_PROMPT, reference_image_urls: ['photo'], reference_video_urls: ['clip'], duration: 5, aspect_ratio: '9:16', resolution: '720p', generate_audio: true,
  } } });
  const ordinary = declaredInputs(record, inputs);
  assert.equal(Object.hasOwn(ordinary, 'video_url'), false);
  assert.equal(Object.hasOwn(buildRequest(target, ordinary).body.input, 'reference_video_urls'), false);
  for (const key of ['first_frame_url', 'last_frame_url', 'resolution', 'generate_audio']) assert.equal(buildRequest(target, { ...inputs, [key]: 'override' }).error, `inputs_key_not_allowed:${key}`);
  for (const prompt of ['xx', 'x'.repeat(20001)]) assert.equal(buildRequest(target, { ...inputs, prompt }).error, 'inputs_invalid:prompt');
  assert.equal(checkInputs(record, { ...inputs, image_url: ['one', 'two'] }).error, 'source_count_exceeded');
  assert.equal(buildRequest(target, { ...inputs, duration_seconds: 5.1 }).error, 'duration_not_supported');
});

for (const [changes, error] of [
  [{ dimensions: { width: 1280, height: 320 } }, 'source_aspect_out_of_range'],
  [{ dimensions: { width: 640, height: 360 } }, 'source_too_small'],
  [{ dimensions: { width: 1200, height: 600 } }, 'source_resolution_out_of_range'],
  [{ frameRate: 12 }, 'source_frame_rate_out_of_range'], [{ frameRate: 61 }, 'source_frame_rate_out_of_range'],
  [{ frameRate: undefined }, 'source_frame_rate_unknown'], [{ sizeBytes: undefined }, 'source_size_unknown'],
  [{ sizeBytes: 50000000 }, 'source_too_large'], [{ seconds: 5.1, videoSeconds: 5.1 }, 'source_too_long'],
]) test(`kie video boundary ${JSON.stringify(changes)}`, () => {
  assert.equal(checkSource(record, { video_url: { ...video, ...changes } }).error, error);
});
for (const dimensions of [{ width: 8000, height: 1000 }, { width: 128, height: 128 }]) test(`kie image rejects ${JSON.stringify(dimensions)}`, () => {
  assert.equal(checkSource(record, { image_url: { ...image, dimensions } }).ok, false);
  assert.equal(checkSource(capabilityFor(catalog[0].provider_endpoint), { image_url: { ...image, dimensions } }).ok, true);
});
test('kie strict sizes and inclusive aspect/fps/duration bounds', () => {
  assert.equal(checkSource(record, { image_url: { ...image, sizeBytes: 30000000 } }).error, 'source_too_large');
  for (const frameRate of [24, 60]) assert.equal(checkSource(record, { video_url: { ...video, frameRate, seconds: 5.05, sizeBytes: 49999999 } }).ok, true);
  for (const dimensions of [{ width: 300, height: 750 }, { width: 750, height: 300 }, { width: 6000, height: 6000 }]) assert.equal(checkSource(record, { image_url: { ...image, dimensions, sizeBytes: 29999999 } }).ok, true);
});

test('kie selection fails closed on provider, endpoint, gating, price and active state', async () => {
  for (const changes of [{ provider: 'fal' }, { provider_endpoint: catalog[0].provider_endpoint }, { gated_flag: true }, { active: false }, { credits_5s: 0 }]) {
    assert.equal(await loadTemplateClip(id, {}, { env: { TEMPLATE_CLIP_ENABLED: 'true' }, manifest: { [id]: kieSource }, read: async () => [{ ...kieCatalog, ...changes }] }), null);
  }
});
test('kie resolver refuses incomplete legacy manifest before signing', async () => {
  for (const missing of ['frameRate', 'sizeBytes', 'width', 'height']) {
    const source = { ...kieSource }; delete source[missing];
    const result = await resolveTemplateClipVideo({ source, template: { id } }, record, {}, () => assert.fail('signed invalid source'));
    assert.equal(result.ok, false);
  }
});

test('0454 inserts inactive once and replay cannot overwrite a later real price or activation', () => {
  const file = '0454_seedance_reference_kie.sql', sql = readFileSync(`packages/db/schema/supabase/${file}`, 'utf8');
  assert.deepEqual(checkCatalogUpdates(sql, file), []);
  assert.match(sql, /'seedance-2\.0-reference-kie','Seedance 2\.0 · Reference · kie','kie','market:bytedance\/seedance-2'/);
  assert.match(sql, /'image-to-video',70,1\.2500,'per_second',5,false,false/);
  const statements = sql.replace(/--[^\n]*/g, '');
  assert.match(statements, /ON CONFLICT \(id\) DO NOTHING;\s*$/);
  assert.doesNotMatch(statements, /\bUPDATE\b|\bDELETE\b|model_routes/i);
  assert.equal((statements.match(/INSERT INTO/g) || []).length, 1);
  assert.match(sql, /Replay preserves any existing price\/cost and active state/);
  assert.match(sql, /@Video1\/@Image1 prompt tokens are UNVERIFIED for kie/);
  assert.equal(Math.ceil(1.25 / 0.01796), 70);
  assert.match(sql, /UNVERIFIED/);
});

test('projection and resolver share kie metadata validation, including malformed measured bounds', async () => {
  for (const changes of [{ frameRate: undefined }, { sizeBytes: undefined }, { frameRate: 12 },
    { width: 1280, height: 320 }, { seconds: 5.1 }, { width: 1200, height: 600 }]) {
    const source = { ...kieSource, ...changes };
    const checked = checkTemplateClipVideoSource(id, source, record);
    assert.equal(checked.ok, false);
    assert.deepEqual(await resolveTemplateClipVideo({ source, template: { id } }, record, {}, () => assert.fail('signed invalid source')), checked);
    assert.equal(await loadTemplateClip(id, {}, { env: { TEMPLATE_CLIP_ENABLED: 'true' }, manifest: { [id]: source }, read: async () => [kieCatalog] }), null);
  }
  assert.deepEqual(checkTemplateClipVideoSource(id, kieSource, record).metadata, {
    seconds: 5, videoSeconds: 5, dimensions: { width: 1280, height: 720 }, contentType: 'video/mp4',
    sizeBytes: kieSource.sizeBytes, frameRate: 30,
  });
});

test('unchanged short-side rule is not a blanket non-widescreen aspect ban', () => {
  assert.equal(checkSource(record, { video_url: { ...video, dimensions: { width: 720, height: 720 } } }).ok, true);
  assert.equal(checkSource(record, { video_url: { ...video, dimensions: { width: 1280, height: 960 } } }).error, 'source_resolution_out_of_range');
});
