import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProbeEnvironment, generationBody, probeSpendCeiling, syntheticVideoArgs } from '../scripts/kling-o1-staging-probe.mjs';

const valid = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  KLING_O1_PROBE_APPROVED: 'owner-approved-2026-11-06',
  KLING_O1_PROBE_MAX_USD: '5',
  KLING_O1_EXPECTED_WORKER_VERSION: 'd3aea259-2be4-477c-b91d-7909c80ef929',
  E2E_EMAIL: 'staging@example.test',
  E2E_PASSWORD: 'not-a-real-secret',
};

test('paid Kling probe is manual, staging-bound and fixed below the approved cap', () => {
  assert.equal(probeSpendCeiling(), 3.36);
  assert.equal(assertProbeEnvironment(valid).origin, 'https://veyrnox-ai-staging.al-jobson.workers.dev');
  for (const key of ['GITHUB_EVENT_NAME', 'KLING_O1_PROBE_APPROVED', 'KLING_O1_EXPECTED_WORKER_VERSION', 'E2E_EMAIL']) {
    assert.throws(() => assertProbeEnvironment({ ...valid, [key]: '' }));
  }
  assert.throws(() => assertProbeEnvironment({ ...valid, KLING_O1_PROBE_MAX_USD: '6' }));
});

test('probe payload preserves video, Image1 and Image2 ordering and exact credit confirmation', () => {
  const body = generationBody({ duration: 10, keys: ['video-key', 'image-one', 'image-two'], idempotencyKey: 'probe-key-123', prompt: 'exact prompt' });
  assert.equal(body.model_id, 'kling-o1-reference');
  assert.equal(body.confirmed_credits, 94);
  assert.deepEqual(body.references, [
    { slot: 'video', origin: 'upload', key: 'video-key' },
    { slot: 'image', origin: 'upload', key: 'image-one' },
    { slot: 'image', origin: 'upload', key: 'image-two' },
  ]);
  assert.deepEqual(body.inputs, { prompt: 'exact prompt', duration_seconds: 10 });
  assert.equal(body.consent, true);
});

test('synthetic video fixtures use a timeline the staging parser can prove', () => {
  const args = syntheticVideoArgs({ duration: 5, rate: 24 });
  assert.deepEqual(args.slice(args.indexOf('-bf'), args.indexOf('-bf') + 2), ['-bf', '0']);
  assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '5']);
  assert.match(args[args.indexOf('-i') + 1], /size=1280x720:rate=24$/);
  assert.ok(args.includes('+faststart'));
});
