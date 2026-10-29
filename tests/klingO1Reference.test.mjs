import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFor, checkInputs, checkSource, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { resolveUploadedSource } from '../lib/resolveSource.js';
import { uploadKeyFor } from '../lib/uploadSource.js';
import { lipSyncMp4 } from './fixtures/lipSyncMp4.mjs';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { developerOpenApi } from '../lib/developerOpenApi.js';

const record = capabilityFor('fal-ai/kling-video/o1/video-to-video/reference');
const video = { seconds: 5, videoSeconds: 5, dimensions: { width: 1280, height: 720 } };
const inputs = { prompt: 'Use @Image1 for texture and @Image2 for lighting.', video_url: 'https://owned.test/video.mp4', image_url: ['https://owned.test/a.png', 'https://owned.test/b.png'] };

test('a QuickTime source cannot satisfy the required proven visual duration', () => {
  assert.deepEqual(checkSource(record, { video_url: {
    contentType: 'video/quicktime', seconds: null, dimensions: null,
  } }), { ok: false, error: 'source_length_unknown' });
});

test('public and fallback capabilities expose source limits matching OpenAPI without provider fields', () => {
  const view = publicCapabilities(record);
  assert.deepEqual(view.media.video, { required: true, maxFiles: 1, minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160 });
  assert.deepEqual(fallbackCapabilitiesFor('kling-o1-reference'), view);
  for (const key of ['minSeconds', 'minSide', 'maxSide']) {
    assert.equal(developerOpenApi.components.schemas.MediaSlot.properties[key].type, key === 'minSeconds' ? 'number' : 'integer');
  }
  assert.doesNotMatch(JSON.stringify(view), /video_url|image_urls|keep_audio|elements|fal-ai/);
  assert.deepEqual(publicCapabilities(capabilityFor('fal-ai/latentsync')).media.video, { required: true, maxFiles: 1, maxSeconds: 40 });
});

test('Kling O1 shapes ordered pictures and priced durations without elements', () => {
  for (const duration_seconds of [5, 10]) {
    assert.deepEqual(shapePayload(record, { ...inputs, duration_seconds }), {
      prompt: inputs.prompt, video_url: inputs.video_url, image_urls: [...inputs.image_url],
      duration: String(duration_seconds), keep_audio: false, aspect_ratio: 'auto',
    });
  }
  assert.deepEqual(shapePayload(record, { ...inputs, image_url: inputs.image_url[0] }), {
    prompt: inputs.prompt, video_url: inputs.video_url, image_urls: [inputs.image_url[0]],
    duration: '5', keep_audio: false, aspect_ratio: 'auto',
  });
});

test('Kling O1 requires video and pictures and refuses unpriced durations', () => {
  const onePicture = { ...inputs, image_url: inputs.image_url[0] };
  for (const key of ['video_url', 'image_url']) {
    const missing = { ...onePicture }; delete missing[key];
    assert.deepEqual(checkInputs(record, missing), { ok: false, error: `inputs_invalid:${key}` });
  }
  assert.deepEqual(checkInputs(record, { ...onePicture, duration_seconds: 6 }), { ok: false, error: 'duration_not_supported' });
  assert.equal(checkInputs(record, { ...onePicture, prompt: 'x'.repeat(2001) }).ok, false);
});

test('Kling O1 bounds proven visual duration and both dimensions before debit', () => {
  const cases = [
    [{ videoSeconds: null, seconds: 5 }, 'source_length_unknown'],
    [{ videoSeconds: NaN }, 'source_length_unknown'],
    [{ videoSeconds: Infinity }, 'source_length_unknown'],
    [{ videoSeconds: 2, seconds: 2 }, 'source_too_short'],
    [{ videoSeconds: 2, seconds: 5 }, 'source_too_short'],
    [{ dimensions: { width: 640, height: 360 } }, 'source_resolution_out_of_range'],
    [{ dimensions: { width: 1280, height: 719 } }, 'source_resolution_out_of_range'],
    [{ dimensions: { width: 3000, height: 720 } }, 'source_resolution_out_of_range'],
    [{ dimensions: { width: 720, height: 3000 } }, 'source_resolution_out_of_range'],
    [{ dimensions: null }, 'source_size_unknown'],
    [{ dimensions: { width: 1280 } }, 'source_size_unknown'],
    [{ dimensions: { width: Infinity, height: 720 } }, 'source_size_unknown'],
    [{ seconds: 11, videoSeconds: 11 }, 'source_too_long'],
    [{ seconds: 11, videoSeconds: 5 }, 'source_too_long'],
    [{ seconds: null }, 'source_length_unknown'],
  ];
  for (const [override, error] of cases) {
    assert.deepEqual(checkSource(record, { video_url: { ...video, ...override } }), { ok: false, error }, JSON.stringify(override));
  }
  for (const source of [video, { ...video, seconds: 3, videoSeconds: 3 }, { ...video, seconds: 10, videoSeconds: 10, dimensions: { width: 2160, height: 720 } }, { ...video, dimensions: { width: 720, height: 2160 } }]) {
    assert.deepEqual(checkSource(record, { video_url: source }), { ok: true });
  }
});

test('existing LatentSync and image bounds retain their results', () => {
  const latent = capabilityFor('fal-ai/latentsync');
  const sources = { video_url: { seconds: 2, videoSeconds: 2, dimensions: null }, audio_url: { seconds: 2 } };
  assert.deepEqual(checkSource(latent, sources), { ok: true });
  assert.deepEqual(checkSource(latent, { ...sources, video_url: { seconds: 5, videoSeconds: null } }), { ok: false, error: 'lipsync_video_length_unknown' });
  assert.deepEqual(checkSource(latent, { ...sources, audio_url: { seconds: 3 } }), { ok: false, error: 'lipsync_audio_exceeds_video' });
  assert.deepEqual(checkSource(latent, { ...sources, video_url: { seconds: 41, videoSeconds: 41 } }), { ok: false, error: 'source_too_long' });
  const image = capabilityFor('fal-ai/topaz/upscale/image');
  for (const [dimensions, expected] of [
    [{ width: 640, height: 360 }, { ok: true }],
    [{ width: 3000, height: 2000 }, { ok: true }],
    [{ width: 3001, height: 2000 }, { ok: false, error: 'source_too_large' }],
    [null, { ok: false, error: 'source_size_unknown' }],
  ]) assert.deepEqual(checkSource(image, { image_url: { dimensions } }), expected);
});

test('Kling O1 uses the existing flag: one picture off, two on, never three', () => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  try {
    for (const flag of [undefined, 'false', 'true']) {
      if (flag === undefined) delete process.env.MULTI_REFERENCE_ENABLED;
      else process.env.MULTI_REFERENCE_ENABLED = flag;
      const max = flag === 'true' ? 2 : 1;
      assert.equal(publicCapabilities(record).media.image.maxFiles, max);
      assert.equal(publicCapabilities(record).media.image.label, 'Reference pictures');
      for (const count of [1, 2, 3]) {
        const urls = Array.from({ length: count }, (_, i) => `https://owned.test/${i}.png`);
        const expected = count <= max ? { ok: true } : { ok: false, error: 'source_count_exceeded' };
        assert.deepEqual(checkInputs(record, { ...inputs, image_url: urls }), expected);
        assert.deepEqual(checkSource(record, { video_url: video, image_url: urls.map(url => ({ url })) }), expected);
      }
    }
  } finally {
    if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED;
    else process.env.MULTI_REFERENCE_ENABLED = old;
  }
});

test('resolved MP4 sources retain dimensions and separately proven visual duration', async () => {
  const bytes = lipSyncMp4({ video: 5, sampleCount: 150 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    const last = Math.min(Number(end), bytes.length - 1);
    return new Response(bytes.subarray(Number(start), last + 1), {
      status: 206, headers: { 'content-range': `bytes ${start}-${last}/${bytes.length}` },
    });
  };
  try {
    const owner = '11111111-2222-3333-4444-555555555555';
    const key = uploadKeyFor(owner, 'video/mp4', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').key;
    const result = await resolveUploadedSource(owner, key, { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', jurisdiction: 'eu' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.dimensions, { width: 640, height: 360 });
    assert.equal(result.seconds, 5);
    assert.ok(result.videoSeconds >= 4.99 && result.videoSeconds <= 5);
    assert.equal(checkSource(record, { video_url: result }).error, 'source_resolution_out_of_range');
  } finally { globalThis.fetch = realFetch; }
});
