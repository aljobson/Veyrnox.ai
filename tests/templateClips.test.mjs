import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_CLIPS, publicTemplateClip } from '../app/veyrnox/_lib/templateClips.js';
import { TEMPLATE_CLIP_SOURCES } from '../lib/templateClipSources.js';
import { templateClipAvailable, loadTemplateClip } from '../lib/templateClipGate.js';
import { resolveTemplateClipVideo } from '../lib/templateClipGeneration.js';
import { TEMPLATE_CLIP_PROMPT } from '../lib/templateClipPrompt.mjs';
import { declaredInputs, capabilityFor, REGISTRY, publicCapabilities, shapePayload, checkInputs, checkSource } from '../lib/modelCapabilities.js';
import { resolveGenerationSources } from '../lib/generationSources.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { id, manifest, catalog } from './fixtures/templateClips.mjs';

const env = { TEMPLATE_CLIP_ENABLED: 'true' };
const record = capabilityFor(catalog[0].provider_endpoint);
test('one registered recast, frozen and unpublished; original community prompt remains exact', () => {
  assert.equal(TEMPLATE_CLIPS.length, 1); assert.equal(TEMPLATE_CLIPS[0].id, id);
  assert.ok(Object.isFrozen(TEMPLATE_CLIPS)); assert.ok(Object.isFrozen(TEMPLATE_CLIPS[0]));
  assert.deepEqual(TEMPLATE_CLIP_SOURCES, {});
  assert.equal(templateClipAvailable(id, { env, catalog }), false);
  assert.match(templateDetail(id).sourcePrompt, /Replace the green character in @video1/);
  assert.equal(templateDetail(id).clip.video, '/showcase/viral-medieval-runway-look.mp4');
  assert.equal(publicTemplateClip('__proto__'), null);
  assert.match(TEMPLATE_CLIP_PROMPT, /@Video1/); assert.match(TEMPLATE_CLIP_PROMPT, /@Image1/);
  assert.ok(TEMPLATE_CLIP_PROMPT.length < 2500);
});

test('publication requires exact flag, registered template, valid source and live ungated catalog', async () => {
  const options = { env, catalog, manifest };
  assert.equal(templateClipAvailable(id, options), true);
  for (const change of [{ env: {} }, { env: { TEMPLATE_CLIP_ENABLED: 'TRUE' } }, { clips: [] }, { manifest: {} },
    { catalog: null }, { catalog: [] }, ...[{ active: false }, { active: 1 }, { gated_flag: true }, { credits_5s: 0 }, { provider: 'kie' }, { provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video' }].map(overrides => ({ catalog: [{ ...catalog[0], ...overrides }] })),
    ...[{ key: 'uploads/fake.mp4' }, { sha256: 'bad' }, { contentType: 'video/webm' }, { version: '' }, { seconds: undefined }, { width: null }].map(overrides => ({ manifest: { [id]: { ...manifest[id], ...overrides } } }))]) {
    assert.equal(templateClipAvailable(id, { ...options, ...change }), false, JSON.stringify(change));
  }
  let reads = 0;
  assert.equal(await loadTemplateClip(id, {}, { ...options, env: {}, read: () => { reads++; } }), null); assert.equal(reads, 0);
  assert.equal(await loadTemplateClip(id, {}, { ...options, read: async () => { throw Error('offline'); } }), null);
  const loaded = await loadTemplateClip(id, {}, { ...options, read: async () => catalog });
  assert.deepEqual(loaded.template, { id, model: catalog[0].id, credits: 85, durationSeconds: 5 });
});

test('server-only slot does not change public capabilities and no other record gains it', () => {
  const withoutVideo = { ...record, media: { image: record.media.image } };
  assert.deepEqual(publicCapabilities(record), publicCapabilities(withoutVideo));
  assert.deepEqual(Object.entries(REGISTRY).filter(([, r]) => Object.values(r.media).some(s => s.serverOnly)).map(([ep]) => ep), [catalog[0].provider_endpoint]);
  // Existing video-slot endpoints plus this single addition; other records cannot silently gain one.
  assert.deepEqual(Object.entries(REGISTRY).filter(([, r]) => r.media.video).map(([ep]) => ep).sort(), [
    'bytedance/seedance-2.0/reference-to-video', 'crun:wan/2-2-animate-replace',
    'fal-ai/kling-video/o1/video-to-video/reference', 'fal-ai/latentsync',
    'fal-ai/minimax-h3-max-recast', 'fal-ai/mmaudio-v2', 'fal-ai/topaz/upscale/video',
  ]);
  assert.deepEqual(record.media.video, { field: 'video_urls', required: false, list: true, max: 1, minSeconds: 2, maxSeconds: 10, minSide: 300, maxSide: 2160, serverOnly: true });
});

test('one image plus one server video works with multi-reference disabled; lists cannot exceed one clip', async () => {
  const inputs = { prompt: TEMPLATE_CLIP_PROMPT, image_url: 'https://photo.test/x.jpg', video_url: 'https://clip.test/x.mp4' };
  assert.equal(checkInputs(record, inputs).ok, true);
  assert.deepEqual(shapePayload(record, inputs).video_urls, [inputs.video_url]);
  assert.equal(checkInputs(record, { ...inputs, video_url: [inputs.video_url, inputs.video_url] }).error, 'source_count_exceeded');
  assert.equal(checkSource(record, { video_url: [{}, {}] }).error, 'source_count_exceeded');
  let signs = 0;
  const result = await resolveTemplateClipVideo({ template: { id }, source: manifest[id] }, record, {}, async (key, ttl) => {
    signs++; assert.equal(key, manifest[id].key); assert.equal(ttl, 900); return { url: inputs.video_url };
  });
  assert.equal(result.ok, true); assert.equal(signs, 1);
  const rejected = await resolveGenerationSources({ record, references: [{ slot: 'video', origin: 'asset', asset_id: 'test' }] }, { asset: () => { throw Error('must not inspect'); } });
  assert.equal(rejected.error, 'source_slot_invalid');
});


test('declared inputs require an explicit server opt-in for the private video slot', () => {
  const input = { prompt: 'test', image_url: 'photo', video_url: 'private', video_urls: ['client'], video: 'client' };
  assert.deepEqual(declaredInputs(record, input), { prompt: 'test', image_url: 'photo' });
  assert.deepEqual(declaredInputs(record, input, { serverMedia: true }), { prompt: 'test', image_url: 'photo', video_url: 'private' });
  assert.equal(checkSource(record, { video_url: { seconds: 10, videoSeconds: 10, dimensions: { width: 320, height: 480 } } }).ok, true);
});
