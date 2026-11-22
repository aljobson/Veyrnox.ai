import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildRequest, endpointKind, submitTask } from '../packages/adapters/crun.js';
import { crunReferenceTags } from '../lib/crunSeedanceReference.js';
import { crunInputRefusal } from '../lib/crunInputRefusal.js';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { TEMPLATE_FACE_WORDING_COMPACT } from '../lib/templateFaceWording.mjs';

const CAP = 0.01796; // ADR-0037
const seedance = { model: 'bytedance/seedance2-0-r2v' };
const image = 'https://r2.example/a.png?sig=secret';
const video = 'https://r2.example/b.mp4?sig=secret';
const sql = readFileSync('packages/db/schema/supabase/0582_kling_3_pro_crun_first.sql', 'utf8');
const crunRow = { id: 'kling-3.0-i2v', provider: 'crun' };
const withNegative = ALL_TEMPLATES.find(t => t.model === 'Kling 3.0 · I2V' && t.negativePrompt?.trim());
const withoutNegative = ALL_TEMPLATES.find(t => t.model === 'Kling 3.0 · I2V' && !t.negativePrompt?.trim());

test('a typed negative prompt is refused on the Crun Kling offer, and only there', () => {
  assert.equal(crunInputRefusal(crunRow, { negative_prompt: ' blur ' }, {}), 'inputs_key_not_allowed:negative_prompt');
  assert.equal(crunInputRefusal(crunRow, { negative_prompt: '  ' }, {}), null);
  assert.equal(crunInputRefusal({ ...crunRow, provider: 'fal' }, { negative_prompt: 'blur' }, {}), null, 'unchanged until 0582');
  assert.equal(crunInputRefusal({ id: 'kling-3.0-i2v-kie', provider: 'crun' }, { negative_prompt: 'blur' }, {}), null);
});

test('a template with its own negative prompt is blocked instead of running without it', () => {
  assert.equal(crunInputRefusal(crunRow, {}, { preset: withNegative.id }), 'template_blocked');
  assert.equal(crunInputRefusal(crunRow, {}, { template_id: withNegative.id }), 'template_blocked');
  assert.equal(crunInputRefusal(crunRow, {}, { preset: withoutNegative.id }), null);
  assert.equal(crunInputRefusal(crunRow, {}, { preset: 'not-a-template' }), null);
});

test('the Kling offer no longer advertises a negative prompt or an end frame', () => {
  const caps = publicCapabilities(capabilityFor('crun:kling/v3'));
  assert.equal(caps.inputs.negative_prompt, undefined);
  assert.equal(caps.media.endImage, undefined);
  assert.equal(caps.media.image.required, true);
});

test('Crun Kling gets the same submit-only face wording as fal', async () => {
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ code: 200, data: { task_id: 'task-1' } }), { status: 200 });
  };
  try {
    const job = { job_id: 'job-1', provider_endpoint: 'crun:kling/v3', inputs: { prompt: 'x'.repeat(1800), image_url: image } };
    assert.equal((await submitTask(job, { apiKey: 'test', faceIdentity: true })).ok, true);
    assert.ok(sent.input.prompt.endsWith(TEMPLATE_FACE_WORDING_COMPACT));
    assert.equal(job.inputs.prompt.length, 1800, 'stored inputs do not change');
    await submitTask(job, { apiKey: 'test' });
    assert.equal(sent.input.prompt.length, 1800);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Seedance translates tags, keeps sound on and sends the references', () => {
  assert.deepEqual(buildRequest(seedance, { prompt: '@Image1 meets @image2', image_url: [image, image], aspect_ratio: '9:16', duration_seconds: 10, resolution: '1080p' }), {
    ok: true,
    body: { model: 'bytedance/seedance2-0-r2v', input: { prompt: '[Image1] meets [Image2]', reference_images: [image, image], resolution: '1080p', aspect_ratio: '9:16', duration: 10, audio: true } },
  });
  const withVideo = buildRequest(seedance, { prompt: '@Image1 moves like @Video1', image_url: image, video_url: video });
  assert.deepEqual(withVideo.body.input.reference_videos, [video]);
  assert.equal(withVideo.body.input.prompt, '[Image1] moves like [Video1]');
  assert.equal(withVideo.body.input.aspect_ratio, 'auto');
  assert.equal(endpointKind('crun:bytedance/seedance2-0-r2v'), 'video');
});

test('Seedance refuses a shape it cannot express or price', () => {
  assert.equal(crunReferenceTags('@Image2', 1, 0), null);
  assert.deepEqual(buildRequest(seedance, { prompt: '@Image2', image_url: image }), { ok: false, error: 'inputs_invalid:prompt' });
  assert.deepEqual(buildRequest(seedance, { prompt: '@Video1', image_url: image }), { ok: false, error: 'inputs_invalid:prompt' });
  assert.deepEqual(buildRequest(seedance, { prompt: 'a' }), { ok: false, error: 'inputs_invalid:image_url' });
  assert.deepEqual(buildRequest(seedance, { prompt: 'a', image_url: Array(10).fill(image) }), { ok: false, error: 'source_count_exceeded' });
  assert.deepEqual(buildRequest(seedance, { prompt: 'a', image_url: image, duration_seconds: 7 }), { ok: false, error: 'duration_not_supported' });
  assert.deepEqual(buildRequest(seedance, { prompt: 'a', image_url: image, video_url: video, resolution: '1080p' }), { ok: false, error: 'resolution_not_supported' });
});

test('Seedance prices at Crun public rates fit the floor for every shape it accepts', () => {
  const usd = credits => credits / 206;
  assert.ok(usd(32 * 5) <= 85 * CAP, '720p image only');
  assert.ok(usd(19 * (5 + 10)) <= 85 * CAP, '720p, 10 s reference, 5 s output');
  assert.ok(usd(78 * 5) <= Math.ceil(85 * 2.25) * CAP, '1080p image only');
  assert.ok(usd(159 * 5) <= Math.ceil(85 * 5.15) * CAP, '4k image only');
  assert.ok(usd(48 * (5 + 10)) > Math.ceil(85 * 2.25) * CAP, '1080p with a 10 s reference is over the floor, so it is refused');
});

test('0582 moves only Kling 3.0 Pro through the guarded reorder and leaves Seedance unrouted', () => {
  assert.match(sql, /'kling-3\.0-i2v', 'crun', 'crun:kling\/v3', 0\.4369/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.doesNotMatch(sql, /seedance2-0-r2v|'seedance-2\.0-reference'/);
  assert.match(sql, /credits_5s = 32/);
  assert.match(sql, /GET DIAGNOSTICS affected = ROW_COUNT;\s+IF affected <> 1/);
  assert.ok(sql.indexOf("state = 'active'") < sql.indexOf('model_route_reorder('));
  assert.ok(0.4369 <= 32 * CAP);
  assert.ok(0.56 <= 32 * CAP, 'fal, second, needs no margin waiver');
  const failover = readFileSync('scripts/test-supplier-route-failover.mjs', 'utf8');
  assert.doesNotMatch(failover, /seedance2-0-r2v/, 'the unproved Seedance route is not on the safety list');
});
