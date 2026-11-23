import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CRUN_BG_REMOVE_CAPABILITY, CRUN_UPSCALE_CAPABILITY, CRUN_UPSCALE_MAX_EDGE, buildCrunImageToolRequest,
} from '../lib/crunImageTools.js';
import { capabilityFor, checkSource, publicCapabilities } from '../lib/modelCapabilities.js';
import { buildRequest, endpointKind, parseEndpoint } from '../packages/adapters/crun.js';
import { toolGroups } from '../app/veyrnox/_lib/tools.js';

const sql = readFileSync('packages/db/schema/supabase/0599_crun_image_tools.sql', 'utf8');
const URL1 = 'https://cdn.example.test/photo.jpg';
const src = (width, height, sizeBytes = 100_000) => ({ image_url: { dimensions: { width, height }, sizeBytes } });

test('the cutout request is the standard model with one image, and nothing else is sent', () => {
  assert.deepEqual(buildCrunImageToolRequest('image-background-remove', { image_url: URL1 }),
    { ok: true, body: { model: 'image-background-remove', input: { img_urls: [URL1] } } });
});

test('the upscale request pins 2x, clean mode and PNG output', () => {
  assert.deepEqual(buildCrunImageToolRequest('image-upscale', { image_url: [URL1] }),
    { ok: true, body: { model: 'image-upscale', input: { img_urls: [URL1], scale_factor: 2, mode: 'clean', output_format: 'png' } } });
});

test('every input Crun could not take is refused before the debit', () => {
  for (const model of ['image-background-remove', 'image-upscale']) {
    assert.equal(buildCrunImageToolRequest(model, {}).error, 'inputs_invalid:image_url');
    assert.equal(buildCrunImageToolRequest(model, { image_url: 'http://insecure.test/a.jpg' }).error, 'inputs_invalid:image_url');
    assert.equal(buildCrunImageToolRequest(model, { image_url: [URL1, URL1] }).error, 'inputs_invalid:image_url');
    assert.match(buildCrunImageToolRequest(model, { image_url: URL1, scale_factor: 4 }).error, /^inputs_key_not_allowed:scale_factor/);
    assert.match(buildCrunImageToolRequest(model, { image_url: URL1, prompt: 'x' }).error, /^inputs_key_not_allowed:prompt/);
  }
  assert.equal(buildCrunImageToolRequest('image-pro', { image_url: URL1 }).error, 'provider_unsupported');
});

test('the adapter owns both endpoints, reads them as images and builds through the same function', () => {
  for (const model of ['image-background-remove', 'image-upscale']) {
    assert.deepEqual(parseEndpoint(`crun:${model}`), { model });
    assert.equal(endpointKind(`crun:${model}`), 'image');
    assert.equal(buildRequest({ model }, { image_url: URL1 }).ok, true);
  }
  assert.equal(endpointKind('crun:kling/o1-r2v-ref'), 'video', 'video routes are not read as images');
});

test('both are in the registry with one required image and no other controls', () => {
  for (const [endpoint, record] of [['crun:image-background-remove', CRUN_BG_REMOVE_CAPABILITY], ['crun:image-upscale', CRUN_UPSCALE_CAPABILITY]]) {
    assert.equal(capabilityFor(endpoint), record);
    assert.equal(record.provider, 'crun');
    assert.equal(record.kind, 'image');
    assert.deepEqual(record.inputs, {});
    assert.equal(record.media.image.required, true);
    assert.deepEqual(Object.keys(record.media), ['image']);
  }
});

test('the upscale refuses a source Crun would hand back unchanged, before the debit', () => {
  const record = CRUN_UPSCALE_CAPABILITY;
  assert.equal(CRUN_UPSCALE_MAX_EDGE, 1024);
  assert.deepEqual(checkSource(record, src(683, 1024)), { ok: true });
  assert.deepEqual(checkSource(record, src(1024, 1024)), { ok: true });
  assert.equal(checkSource(record, src(1024, 1536)).error, 'source_resolution_out_of_range', 'the 1024x1536 probe returned its own size and still charged');
  assert.equal(checkSource(record, src(1025, 600)).error, 'source_resolution_out_of_range');
  assert.equal(checkSource(record, { image_url: { dimensions: null, sizeBytes: 100 } }).error, 'source_size_unknown');
  assert.equal(checkSource(record, src(500, 500, 20_000_001)).error, 'source_too_large');
});

test('the cutout allows large photos up to 4096 px and refuses beyond', () => {
  assert.deepEqual(checkSource(CRUN_BG_REMOVE_CAPABILITY, src(4000, 3000)), { ok: true });
  assert.equal(checkSource(CRUN_BG_REMOVE_CAPABILITY, src(2667, 4097)).error, 'source_resolution_out_of_range');
});

test('the public catalog shows the size limit so the source picker can warn first', () => {
  const up = publicCapabilities(CRUN_UPSCALE_CAPABILITY);
  assert.equal(up.media.image.maxSide, 1024);
  assert.equal(up.media.image.required, true);
});

test('they sit beside Upscale and Remove background on the Tools page, web and mobile lists', () => {
  const m = (id) => ({ id, capabilities: { media: { image: { required: true } } } });
  const groups = toolGroups([m('topaz-upscale'), m('upscale-2x-clean'), m('bria-bg-remove'), m('background-remove-fast')]);
  assert.deepEqual(groups.map(g => [g.key, g.tools.map(t => t.id)]), [['upscale', ['topaz-upscale', 'upscale-2x-clean']], ['background', ['bria-bg-remove', 'background-remove-fast']]]);
  const mobile = readFileSync('apps/mobile/src/lib/toolDirectory.ts', 'utf8');
  assert.match(mobile, /ids: \['topaz-upscale', 'upscale-2x-clean'\]/);
  assert.match(mobile, /ids: \['bria-bg-remove', 'background-remove-fast'\]/);
});

test('the migration inserts two active Crun offers at 1 and 2 credits with one route each and asserts the floor', () => {
  assert.match(sql, /'background-remove-fast', 'Background Removal Fast', 'crun', 'crun:image-background-remove', 'image-to-image', 1, 0\.0025/);
  assert.match(sql, /'upscale-2x-clean',\s+'Upscale 2x Clean',\s+'crun', 'crun:image-upscale',\s+'image-to-image', 2, 0\.0146/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(sql, /round\(c\.provider_cost_per_unit \* 100000\) <= c\.credits_5s \* 1796/);
  assert.match(sql, /IF n <> 2 THEN/);
  assert.doesNotMatch(sql, /UPDATE\s+public\./i, 'existing rows are never rewritten');
  assert.doesNotMatch(sql, /UPDATE[^;]*(bria|topaz)/i, 'Bria and Topaz are untouched');
  const CAP = 0.01796;
  assert.ok(0.0025 <= 1 * CAP);
  assert.ok(0.0146 <= 2 * CAP);
});

test('the header states what was not established', () => {
  assert.match(sql, /NOT established: a 1024 px long edge actually doubling/);
  assert.match(sql, /signed R2 links/);
  assert.match(sql, /Deploy the Worker that has crun:image-background-remove and crun:image-upscale BEFORE applying/);
});
