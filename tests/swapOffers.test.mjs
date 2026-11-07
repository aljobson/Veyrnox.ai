import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFor, checkInputs, checkSource, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { resolveRouteSet } from '../lib/supplierRoutesDispatch.js';
import { estimatedCredits } from '../lib/generationEstimate.js';

const endpoints = ['fal-ai/minimax-h3-max-recast', 'crun:wan/2-2-animate-replace'];
const ids = ['swap-recast', 'swap-quick'];
const inputs = { image_url: 'https://owned.test/person.jpg', video_url: 'https://owned.test/clip.mp4' };
const video = { contentType: 'video/mp4', seconds: 5, videoSeconds: 5, dimensions: { width: 640, height: 360 } };
const image = { contentType: 'image/jpeg', dimensions: { width: 640, height: 640 } };

test('Swap contracts pin whole-job output and expose only the intended source controls', async () => {
  for (const [i, endpoint] of endpoints.entries()) {
    const record = capabilityFor(endpoint), view = publicCapabilities(record);
    assert.equal(record.kind, 'video');
    assert.equal(record.lengths, null);
    assert.deepEqual(view.lengths, [5]);
    assert.deepEqual(fallbackCapabilitiesFor(ids[i]), view);
    assert.equal(view.media.video.label, 'Video to change');
    assert.equal(view.media.video.maxSeconds, 10);
    assert.equal(view.media.video.minSeconds, i ? 2 : 5);
    assert.equal(checkInputs(record, inputs).ok, true);
    for (const key of ['resolution', 'enable_safety_checker', 'callback_url', 'model', 'unknown']) {
      assert.equal(checkInputs(record, { ...inputs, [key]: false }).ok, false, key);
    }
    for (const key of ['video_url', 'image_url']) {
      const missing = { ...inputs }; delete missing[key];
      assert.equal(checkInputs(record, missing).error, `inputs_invalid:${key}`);
    }
    assert.equal(checkInputs(record, { ...inputs, duration_seconds: 10 }).error, 'duration_not_supported');
    const credits = i ? 67 : 134, model = { credits, modality: 'video-to-video', durations: view.lengths };
    assert.equal(estimatedCredits(model), credits);
    assert.equal(estimatedCredits(model, 5), credits);
    assert.equal(estimatedCredits(model, 10), null);
    assert.deepEqual(await resolveRouteSet({ id: ids[i], provider: record.provider, provider_endpoint: endpoint }, {}, {
      read: async () => [], log() {}, env: { SUPPLIER_ROUTES_ENABLED: 'true' },
    }), { own: null, routes: [] });
  }
  const record = capabilityFor(endpoints[0]);
  assert.equal(checkInputs(record, { ...inputs, prompt: 'x'.repeat(1000) }).ok, true);
  assert.equal(checkInputs(record, { ...inputs, prompt: 'x'.repeat(1001) }).ok, false);
  assert.deepEqual(shapePayload(record, { ...inputs, resolution: '1080P', enable_safety_checker: false, duration_seconds: 5 }), {
    video_url: inputs.video_url, reference_image_urls: [inputs.image_url], resolution: '768P', enable_safety_checker: true,
  });
});

test('Pro allows one photo off and two on, with all reference evidence present; Quick always one', t => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; });
  for (const flag of ['false', 'true']) {
    process.env.MULTI_REFERENCE_ENABLED = flag;
    for (const [i, endpoint] of endpoints.entries()) {
      const record = capabilityFor(endpoint), max = !i && flag === 'true' ? 2 : 1;
      assert.equal(publicCapabilities(record).media.image.maxFiles, max);
      for (const count of [1, 2, 3]) {
        const photos = Array.from({ length: count }, (_, n) => `https://owned.test/${n}.jpg`);
        assert.equal(checkInputs(record, { ...inputs, image_url: photos }).ok, count <= max);
        assert.equal(checkSource(record, { video_url: video, image_url: photos.map(() => image) }).ok, count <= max);
      }
    }
  }
  const spec = capabilityFor(endpoints[0]).media.image;
  assert.equal(spec.verifiedAt, '2026-11-07');
  assert.equal(spec.verification, 'https://fal.ai/models/fal-ai/minimax-h3-max-recast/llms.txt');
  assert.equal(spec.priceVerification, 'https://fal.ai/models/fal-ai/minimax-h3-max-recast');
});

test('source bounds refuse unreadable/short/long media and Quick dimensions, accepting MP4 plus JPEG', () => {
  for (const endpoint of endpoints) {
    const record = capabilityFor(endpoint), min = record.media.video.minSeconds;
    assert.deepEqual(checkSource(record, { video_url: video, image_url: image }), { ok: true });
    for (const [override, error] of [
      [{ videoSeconds: min - 1 }, 'source_too_short'],
      [{ videoSeconds: null }, 'source_length_unknown'],
      [{ contentType: 'video/quicktime', videoSeconds: null, seconds: null }, 'source_length_unknown'],
      [{ seconds: 11, videoSeconds: 10 }, 'source_too_long'],
      [{ seconds: null }, 'source_length_unknown'],
    ]) assert.equal(checkSource(record, { video_url: { ...video, ...override }, image_url: image }).error, error);
  }
  const quick = capabilityFor(endpoints[1]);
  for (const [slot, source, min, max] of [['image_url', image, 200, 4096], ['video_url', video, 200, 2048]]) {
    for (const dimensions of [{ width: min - 1, height: 640 }, { width: 640, height: min - 1 }, { width: max + 1, height: 640 }, { width: 640, height: max + 1 }]) {
      assert.equal(checkSource(quick, { video_url: video, image_url: image, [slot]: { ...source, dimensions } }).error, 'source_resolution_out_of_range');
    }
    for (const dimensions of [null, { width: NaN, height: 640 }]) {
      assert.equal(checkSource(quick, { [slot]: { ...source, dimensions } }).error, 'source_size_unknown');
    }
    assert.equal(checkSource(quick, { [slot]: { ...source, dimensions: { width: min, height: max } } }).ok, true);
  }
  assert.equal(checkSource(capabilityFor(endpoints[0]), { video_url: { ...video, dimensions: null } }).ok, true);
});
