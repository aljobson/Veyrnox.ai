import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCumulativeProbeSpend, assertProbeEnvironment, generationBody, historicalProbeSpend, isPreDebitValidationRejection, probeSpendCeiling, syntheticVideoArgs } from '../scripts/kling-o1-staging-probe.mjs';

const valid = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  KLING_O1_PROBE_MAX_USD: '5',
  KLING_O1_EXPECTED_WORKER_VERSION: 'd3aea259-2be4-477c-b91d-7909c80ef929',
  E2E_EMAIL: 'staging@example.test',
  E2E_PASSWORD: 'not-a-real-secret',
};

const continuation = {
  ...valid,
  KLING_O1_PROBE_PHASE: 'remaining',
  KLING_O1_PRIOR_SUCCESS_JOB_IDS: '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
  KLING_O1_REUSE_KEYS: 'uploads/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.mp4,uploads/33333333-3333-4333-8333-333333333333/55555555-5555-4555-8555-555555555555.png,uploads/33333333-3333-4333-8333-333333333333/66666666-6666-4666-8666-666666666666.png',
};

test('paid Kling probe is manual, staging-bound and fixed below the approved cap', () => {
  assert.equal(probeSpendCeiling(), 4.2);
  assert.equal(assertProbeEnvironment(valid).origin, 'https://veyrnox-ai-staging.al-jobson.workers.dev');
  for (const key of ['GITHUB_EVENT_NAME', 'KLING_O1_EXPECTED_WORKER_VERSION', 'E2E_EMAIL']) {
    assert.throws(() => assertProbeEnvironment({ ...valid, [key]: '' }));
  }
  assert.throws(() => assertProbeEnvironment({ ...valid, KLING_O1_PROBE_MAX_USD: '6' }));
  assert.equal(assertProbeEnvironment(continuation).phase, 'remaining');
  assert.throws(() => assertProbeEnvironment({ ...continuation, KLING_O1_PRIOR_SUCCESS_JOB_IDS: '' }));
  assert.throws(() => assertProbeEnvironment({ ...continuation, KLING_O1_REUSE_KEYS: 'bad' }));
});

test('paid Kling probe enforces the approved cap across prior runs', () => {
  const rows = [
    { kind: 'generation', delta: -47, job_id: 'deleted-output-job', created_at: '2026-11-06T12:00:00Z' },
    { kind: 'generation', delta: -94, job_id: 'retained-output-job', created_at: '2026-11-06T12:10:00Z' },
    { kind: 'top_up', delta: 999, created_at: '2026-11-06T12:20:00Z' },
    { kind: 'generation', delta: -47, created_at: '2026-11-05T12:00:00Z' },
  ];
  assert.equal(historicalProbeSpend(rows), 2.52);
  assert.deepEqual(assertCumulativeProbeSpend(rows, 1.68), {
    approvalStartedAt: '2026-11-06T00:00:00.000Z',
    historicalProviderUsd: 2.52,
    nextRunMaximumProviderUsd: 1.68,
    projectedProviderUsd: 4.2,
  });
  assert.throws(() => assertCumulativeProbeSpend(rows, 3.36), /above the approved \$5\.00 cap/);
  assert.equal(historicalProbeSpend([{ kind: 'generation', delta: -12, created_at: '2026-11-06T12:00:00Z' }]), 0);
});

test('controlled validation rejection is accepted only when it created no job', () => {
  const rejected = { status: 422, body: { error: 'source_frame_rate_invalid' } };
  assert.equal(isPreDebitValidationRejection(rejected, 0), true);
  assert.equal(isPreDebitValidationRejection(rejected, 1), false);
  assert.equal(isPreDebitValidationRejection({ status: 401, body: { error: 'not_authenticated' } }, 0), false);
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
