import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFor, checkInputs, checkSource, shapePayload } from '../lib/modelCapabilities.js';
import { resolveGenerationSources } from '../lib/generationSources.js';
const record = capabilityFor('bytedance/seedance-2.0/reference-to-video');
const refs = n => Array.from({ length: n }, (_, i) => ({ slot: 'image', origin: 'upload', key: `photo-${i + 1}` }));
const source = key => ({ ok: true, url: `https://owned.invalid/${key}`, contentType: 'image/png', sizeBytes: 1024, dimensions: { width: 512, height: 512 } });
for (const n of [4, 9]) test(`${n} verified reference images resolve and shape in supplied order`, async t => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  process.env.MULTI_REFERENCE_ENABLED = 'true';
  t.after(() => { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; });
  const result = await resolveGenerationSources({ references: refs(n), record }, { upload: async (_owner, key) => source(key) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.references, refs(n));
  const inputs = { prompt: 'Bound scene', duration_seconds: 5, ...result.inputs };
  assert.equal(checkInputs(record, inputs).ok, true); assert.equal(checkSource(record, result.sources).ok, true);
  const payload = shapePayload(record, inputs, result.sources);
  assert.deepEqual(payload.image_urls, refs(n).map(r => source(r.key).url));
  assert.equal(payload.generate_audio, true); assert.equal(payload.resolution, '720p');
});
test('ten images, wrong kind, oversize and flag-off requests fail before provider shaping', async t => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  process.env.MULTI_REFERENCE_ENABLED = 'true';
  t.after(() => { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; });
  let calls = 0;
  const deps = { upload: async (_owner, key) => { calls++; return source(key); } };
  assert.equal((await resolveGenerationSources({ references: refs(10), record }, deps)).error, 'source_count_exceeded');
  assert.equal(calls, 0);
  assert.equal((await resolveGenerationSources({ references: [{ ...refs(1)[0], slot: 'video' }], record }, deps)).error, 'source_slot_invalid');
  assert.equal((await resolveGenerationSources({ references: refs(4), record }, { upload: async () => ({ ...source('x'), contentType: 'video/mp4' }) })).error, 'source_type_unsupported');
  assert.equal((await resolveGenerationSources({ references: refs(4), record }, { upload: async () => ({ ...source('x'), sizeBytes: 500 * 1024 * 1024 }) })).error, 'sources_too_large');
  process.env.MULTI_REFERENCE_ENABLED = 'false';
  assert.equal((await resolveGenerationSources({ references: refs(4), record }, deps)).error, 'source_count_exceeded');
});

for (const widenedSlots of [false, true]) test(`Kling end-frame still rejects a fourth image (three-per-slot fixture=${widenedSlots})`, async t => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  process.env.MULTI_REFERENCE_ENABLED = 'true';
  t.after(() => { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; });
  const kling = capabilityFor('fal-ai/kling-video/v3/pro/image-to-video');
  assert.ok(kling?.media.endImage);
  const verified = { ...record.media.image, max: 3 };
  const multi = widenedSlots ? { ...kling, media: { image: { ...kling.media.image, ...verified }, endImage: { ...kling.media.endImage, ...verified } } } : kling;
  const references = refs(4).map((ref, i) => ({ ...ref, slot: i < 2 ? 'image' : 'endImage' }));
  let reads = 0;
  assert.equal((await resolveGenerationSources({ record: multi, references }, { upload: async () => { reads++; return source('x'); } })).error, 'source_count_exceeded');
  assert.equal(reads, 0);
  if (widenedSlots) assert.equal((await resolveGenerationSources({ record: multi, references: references.slice(0, 3) }, { upload: async (_, key) => source(key) })).ok, true);
});
