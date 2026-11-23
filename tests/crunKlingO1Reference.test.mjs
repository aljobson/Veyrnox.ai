import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CRUN_KLING_O1_REFERENCE_CAPABILITY, CRUN_KLING_O1_REFERENCE_DEFAULT_PROMPT, buildKlingO1ReferenceRequest,
  nearestKlingAspect, withDerivedAspect,
} from '../lib/crunKlingO1Reference.js';
import { capabilityFor, declaredInputs, checkInputs } from '../lib/modelCapabilities.js';
import { buildRequest, parseEndpoint } from '../packages/adapters/crun.js';

const sql = readFileSync('packages/db/schema/supabase/0586_crun_kling_o1_reference_first.sql', 'utf8');
const VIDEO = 'https://cdn.example.test/source.mp4';
const IMAGE = 'https://cdn.example.test/person.jpg';
const base = { prompt: 'a dancer', video_url: VIDEO, image_url: [IMAGE], duration_seconds: 5, aspect_ratio: '16:9' };

test('the request is Crun feature mode at 720p with audio off, built from our own fields', () => {
  const r = buildKlingO1ReferenceRequest(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, { model: 'kling/o1-r2v', input: {
    prompt: 'a dancer', duration: 5, resolution: '720p', reference_videos: [VIDEO], reference_video_type: 'feature_video',
    reference_images: [IMAGE], aspect_ratio: '16:9', audio: false,
  } });
});

test('the adapter routes our endpoint name to it and sends Crun\'s own model id', () => {
  assert.deepEqual(parseEndpoint('crun:kling/o1-r2v-ref'), { model: 'kling/o1-r2v-ref' });
  const r = buildRequest({ model: 'kling/o1-r2v-ref' }, base);
  assert.equal(r.ok, true);
  assert.equal(r.body.model, 'kling/o1-r2v');
  // The swap endpoints keep their own builder: base_video, elements, auto.
  assert.equal(buildRequest({ model: 'kling/o1-r2v' }, base).ok, false);
});

test('a blank prompt gets the fixed sentence, a long one is refused before the debit', () => {
  assert.equal(buildKlingO1ReferenceRequest({ ...base, prompt: '  ' }).body.input.prompt, CRUN_KLING_O1_REFERENCE_DEFAULT_PROMPT);
  assert.equal(buildKlingO1ReferenceRequest({ ...base, prompt: undefined }).body.input.prompt, CRUN_KLING_O1_REFERENCE_DEFAULT_PROMPT);
  assert.equal(buildKlingO1ReferenceRequest({ ...base, prompt: 'x'.repeat(2501) }).error, 'inputs_invalid:prompt');
});

test('each input Crun could not take is refused, none is changed', () => {
  const bad = (patch) => buildKlingO1ReferenceRequest({ ...base, ...patch }).error;
  assert.equal(bad({ duration_seconds: 7 }), 'duration_not_supported');
  assert.equal(bad({ aspect_ratio: 'auto' }), 'inputs_invalid:aspect_ratio');
  assert.equal(bad({ aspect_ratio: undefined }), 'inputs_invalid:aspect_ratio');
  assert.equal(bad({ aspect_ratio: '4:3' }), 'inputs_invalid:aspect_ratio');
  assert.equal(bad({ video_url: 'http://insecure.test/v.mp4' }), 'inputs_invalid:video_url');
  assert.equal(bad({ video_url: undefined }), 'inputs_invalid:video_url');
  assert.equal(bad({ video_url: [VIDEO, VIDEO] }), 'inputs_invalid:video_url');
  assert.equal(bad({ image_url: [] }), 'inputs_invalid:image_url');
  assert.equal(bad({ image_url: [IMAGE, IMAGE, IMAGE] }), 'source_count_exceeded');
  assert.match(bad({ negative_prompt: 'x' }), /^inputs_key_not_allowed:negative_prompt/);
  assert.equal(buildKlingO1ReferenceRequest({ ...base, duration_seconds: 10 }).body.input.duration, 10);
});

test('the frame shape is the nearest of 1:1, 16:9 and 9:16, and 4:3 goes to the non-square one', () => {
  const shapes = [[1280, 720], [720, 1280], [1000, 1000], [1600, 1200], [1200, 1600], [1100, 1000], [2160, 720], [0, 5], [NaN, 5]];
  assert.deepEqual(shapes.map(([w, h]) => nearestKlingAspect(w, h)), ['16:9', '9:16', '1:1', '16:9', '9:16', '1:1', '16:9', null, null]);
});

test('the gateway derives the aspect from the uploaded video, and only for a record that asks', () => {
  const record = capabilityFor('crun:kling/o1-r2v-ref');
  const inputs = { prompt: 'p', video_url: VIDEO };
  const out = withDerivedAspect(record, inputs, { video_url: { dimensions: { width: 720, height: 1280 } } });
  assert.equal(out.aspect_ratio, '9:16');
  assert.equal(inputs.aspect_ratio, undefined, 'the input object is not changed');
  assert.equal(withDerivedAspect(record, inputs, { video_url: [{ dimensions: { width: 1280, height: 720 } }] }).aspect_ratio, '16:9');
  assert.equal(withDerivedAspect(record, inputs, {}), inputs, 'no readable video: nothing is added and the request is refused later');
  assert.equal(withDerivedAspect(capabilityFor('fal-ai/kling-video/o1/video-to-video/reference'), inputs, { video_url: { dimensions: { width: 720, height: 1280 } } }), inputs);
});

test('a client cannot choose the aspect: the key is server only and dropped from what a caller sends', () => {
  const record = capabilityFor('crun:kling/o1-r2v-ref');
  assert.equal(record.inputs.aspect_ratio.serverOnly, true);
  const kept = declaredInputs(record, { prompt: 'p', aspect_ratio: '1:1', video_url: VIDEO, image_url: [IMAGE] });
  assert.equal(kept.aspect_ratio, undefined);
  assert.equal(checkInputs(record, { ...base, aspect_ratio: '16:9' }).ok, true);
  assert.equal(checkInputs(record, { ...base, aspect_ratio: 'auto' }).ok, false);
});

test('the Crun record has the same media pins as fal, so either supplier accepts the same source', () => {
  const fal = capabilityFor('fal-ai/kling-video/o1/video-to-video/reference');
  const crun = CRUN_KLING_O1_REFERENCE_CAPABILITY;
  const pin = (spec) => ({ required: spec.required, list: !!spec.list, max: spec.max ?? null, minSeconds: spec.minSeconds ?? null, maxSeconds: spec.maxSeconds ?? null, minSide: spec.minSide ?? null, maxSide: spec.maxSide ?? null });
  assert.deepEqual(pin(crun.media.video), pin(fal.media.video));
  assert.deepEqual(pin(crun.media.image), pin(fal.media.image));
  assert.deepEqual(Object.keys(crun.lengths.map), Object.keys(fal.lengths.map));
  assert.equal(crun.fixed.reference_video_type, 'feature_video');
  assert.equal(crun.fixed.audio, false);
});

test('90 Crun credits at 206 per $1 is the recorded cost, and both routes sit inside the 47-credit floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.equal((90 / 206).toFixed(4), '0.4369');
  assert.ok(0.4369 <= 47 * CAP);
  assert.ok(0.84 <= 47 * CAP, 'fal, now second, inside the floor');
});

test('the migration backfills the missing fal route, proves and activates Crun, reorders and asserts the end state', () => {
  assert.match(sql, /'current dispatch \(0586/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public\.model_routes r WHERE r\.model_id = c\.id\)/);
  assert.match(sql, /'crun:kling\/o1-r2v-ref', 2, 'standby', 'licensed_reseller'|'crun', 'crun:kling\/o1-r2v-ref', 0\.4369, 'per_second', 5, 2, 'standby'/);
  assert.match(sql, /681e4480-3036-44d8-84bb-30311e929b26/);
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /CASE supplier WHEN 'crun' THEN 0 ELSE 1 END/);
  assert.match(sql, /IF affected <> 1 THEN/);
  assert.match(sql, /IF affected <> 2 THEN/);
  assert.match(sql, /credits_5s = 47/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i, 'the catalog row is changed only by the guarded reorder');
  assert.doesNotMatch(sql, /SET\s+credits_5s|,\s*credits_5s\s*=/, 'the price is read, never set');
});

test('the header states what was not established and what differs from fal', () => {
  assert.match(sql, /NOT established: a side-by-side with fal/);
  assert.match(sql, /signed R2 links/);
  assert.match(sql, /a 4:3 source is made 16:9 here/);
  assert.match(sql, /never hops/);
  assert.match(sql, /Deploy the Worker that has crun:kling\/o1-r2v-ref BEFORE applying/);
});
