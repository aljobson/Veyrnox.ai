import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseEndpoint, endpointKind, submitTask } from '../packages/adapters/crun.js';
import { capabilityFor, checkSource, publicCapabilities } from '../lib/modelCapabilities.js';
import { seedance25Bill, seedance25RawRefusal } from '../lib/seedance25Billing.js';
const url = 'https://r2.example/source.mp4?sig=private';
for (const task of ['edit', 'extend']) {
  const endpoint = `crun:bytedance/seedance2-5-r2v:${task}`;
  const model = `seedance-2.5-${task}`;
  test(`${task}: exact request, internal duration, video capability`, () => {
    assert.equal(endpointKind(endpoint), 'video');
    assert.deepEqual(buildRequest(parseEndpoint(endpoint), { prompt: ' restyle ', video_url: url }), { ok: true, body: {
      model: 'bytedance/seedance2-5-r2v', input: { prompt: 'restyle', reference_videos: [url], task_type: task,
        duration: task === 'edit' ? -1 : 5, aspect_ratio: 'auto', resolution: '720p', audio: true },
    } });
    const record = capabilityFor(endpoint);
    assert.equal(record.strictInputs, true);
    assert.equal(publicCapabilities(record).media.video.maxFiles, 1);
    for (const [seconds, error] of [[3.9, 'source_too_short'], [10.01, 'source_too_long'], [null, 'source_length_unknown']]) {
      assert.equal(checkSource(record, { video_url: { seconds, videoSeconds: seconds } }).error, error);
    }
  });
  test(`${task}: every unsupported input is refused`, () => {
    const base = { prompt: 'restyle', video_url: url };
    for (const extra of [{ resolution: '1080p' }, { aspect_ratio: '16:9' }, { duration_seconds: 10 }, { duration: -1 },
      { callback_url: url }, { byteplus_fallback: true }, { direct_byteplus: true }, { image_url: url },
      { audio_url: url }, { audio: false }, { seed: 1 }, { prompt: '' }, { prompt: 'a'.repeat(30001) },
      { video_url: 'http://x.test/a.mp4' }, { video_url: [] }, { video_url: [url, url] }]) {
      assert.equal(buildRequest(parseEndpoint(endpoint), { ...base, ...extra }).ok, false, JSON.stringify(extra).slice(0, 100));
    }
    assert.equal(buildRequest(parseEndpoint(endpoint), { ...base, prompt: 'a'.repeat(30000) }).ok, true);
    assert.equal(seedance25RawRefusal(model, { prompt: 'x', duration_seconds: task === 'edit' ? 5 : 10 }) !== null, true);
    assert.equal(seedance25RawRefusal(model, { prompt: 'x', video_url: url }), 'inputs_key_not_allowed:video_url');
  });
  test(`${task}: billed units follow measured source only for edit`, () => {
    for (const [seconds, units] of [[4, 1], [5, 1], [5.055, 2], [task === 'edit' ? 10 : 6, 2]]) {
      const bill = seedance25Bill(model, 78, { video_url: { seconds } });
      assert.equal(bill.ok, true);
      assert.equal(bill.units, task === 'edit' ? units : 1);
      assert.equal(bill.credits, 78 * bill.units);
      assert.equal(bill.source_seconds, seconds);
    }
    for (const seconds of [null, NaN, 0, 3.999, 10.001]) assert.equal(seedance25Bill(model, 78, { video_url: { seconds } }).ok, false);
  });
  test(`${task}: submit refusal redacts signed media`, async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 422, message: `Unsupported media ${url}` }, { status: 422 }));
    const result = await submitTask({ job_id: 'job-25', provider_endpoint: endpoint, inputs: { prompt: 'x', video_url: url } }, { apiKey: 'test' });
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.error, 'crun 422/422: invalid_input');
  });
}
