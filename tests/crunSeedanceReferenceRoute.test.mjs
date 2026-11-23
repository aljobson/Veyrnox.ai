import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { capabilityFor, checkSource, publicCapabilities } from '../lib/modelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { crunInputRefusal } from '../lib/crunInputRefusal.js';
import { classifySubmitFailure } from '../lib/supplierRoutesFailover.js';
import { submitTask } from '../packages/adapters/crun.js';

const CAP = 0.01796; // ADR-0037
const ENDPOINT = 'crun:bytedance/seedance2-0-r2v';
const IMAGE_TASK = 'c6be2f4e-aaa4-47e5-994a-209cdb6961b4';
const VIDEO_TASK = '193ea5bf-d737-4af4-8fa3-8fe1de3c538c';
const sql = readFileSync('packages/db/schema/supabase/0583_seedance_reference_crun_first.sql', 'utf8');
const row = { id: 'seedance-2.0-reference', provider: 'crun' };
const image = 'https://r2.example/a.png?sig=secret';

test('customers are offered only the proved 5 s, 720p shape, live and in the outage fallback', () => {
  for (const caps of [publicCapabilities(capabilityFor(ENDPOINT)), fallbackCapabilitiesFor(row.id)]) {
    assert.deepEqual(caps.lengths, [5]);
    assert.equal(caps.resolutionTiers, undefined);
    assert.equal(caps.presentation.resolutionLabel, '720p');
    assert.equal(caps.presentation.audioIncluded, true);
    assert.equal(caps.media.video, undefined, 'the reference video stays server-only');
    assert.equal(caps.media.image.required, true);
  }
});

test('a dearer tier is refused before the debit instead of quietly serving 720p', () => {
  for (const resolution of ['1080p', '4k', 'other']) assert.equal(crunInputRefusal(row, { resolution }, {}), 'resolution_not_supported');
  for (const inputs of [{}, { resolution: '720p' }, { resolution: null }]) assert.equal(crunInputRefusal(row, inputs, {}), null);
  assert.equal(crunInputRefusal({ ...row, provider: 'fal' }, { resolution: '1080p' }, {}), null, 'unchanged until 0583');
});

test('a reference video longer than the proved clip is refused', () => {
  const clip = seconds => ({ video_url: { seconds, videoSeconds: seconds, dimensions: { width: 720, height: 1280 }, sizeBytes: 1000, frameRate: 24 } });
  const record = capabilityFor(ENDPOINT);
  assert.equal(checkSource(record, clip(5)).ok, true);
  assert.equal(checkSource(record, clip(5.05)).ok, true);
  assert.equal(checkSource(record, clip(5.1)).error, 'source_too_long');
});

test('recorded cost covers both proofs and the longest allowed reference, inside the floor', () => {
  const usd = credits => credits / 206;
  assert.equal(usd(157.93).toFixed(4), '0.7667');
  assert.equal(usd(191.46).toFixed(4), '0.9294');
  assert.ok(19 * (5.088 + 5.05) <= 193, 'input plus output seconds at the 720p rate');
  assert.equal(usd(193).toFixed(4), '0.9369');
  assert.ok(0.9369 <= 85 * CAP);
  assert.ok(1.512 <= 85 * CAP, 'fal, second, needs no margin waiver');
});

test('a Crun refusal keeps none of its text, and an image job has no failover path', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 422, message: `invalid parameter ${image}` }), { status: 422 });
  try {
    const refused = await submitTask({ job_id: 'job-1', provider_endpoint: ENDPOINT, inputs: { prompt: 'a', image_url: image } }, { apiKey: 'test' });
    assert.deepEqual(refused, { ok: false, outcome: 'rejected', error: 'crun 422/422: invalid_input' });
    assert.equal(classifySubmitFailure(refused), 'stop');
  } finally { globalThis.fetch = realFetch; }
  const gateway = readFileSync('lib/generationProviderSubmit.js', 'utf8');
  assert.match(gateway, /canHop: !rawKeys\.length && !rawAssets\.length && !record\.edit/);
});

test('0583 records fal, proves Crun, reorders through the guard and writes no price', () => {
  assert.match(sql, /'seedance-2\.0-reference', 'fal', 'bytedance\/seedance-2\.0\/reference-to-video', 1\.5120/);
  assert.match(sql, /'seedance-2\.0-reference', 'crun', 'crun:bytedance\/seedance2-0-r2v', 0\.9369/);
  assert.ok(sql.includes(IMAGE_TASK) && sql.includes(VIDEO_TASK));
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.match(sql, /credits_5s = 85/);
  assert.ok(sql.indexOf("state = 'active', updated_at") < sql.indexOf('model_route_reorder('));
  assert.match(sql, /GET DIAGNOSTICS affected = ROW_COUNT;\s+IF affected <> 1/);
  assert.match(sql, /IF affected <> 2 THEN/);
});

test('the safety list names the route once and cites both proofs', () => {
  const failover = readFileSync('scripts/test-supplier-route-failover.mjs', 'utf8');
  assert.equal(failover.split(`'${ENDPOINT}'`).length - 1, 1);
  assert.ok(failover.includes(IMAGE_TASK) && failover.includes(VIDEO_TASK));
});
