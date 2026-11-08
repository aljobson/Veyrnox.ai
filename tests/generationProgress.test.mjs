import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAP_PERCENT,
  BAR_MAX_AGE_MS,
  estimatePercent,
  expectedDurationMs,
  barRows,
} from '../app/veyrnox/_lib/generationProgress.mjs';

test('the estimate starts at 0, only rises, and never reaches the cap before the job settles', () => {
  assert.equal(estimatePercent(0, 40_000), 0);
  let last = -1;
  for (let s = 0; s <= 3600; s += 5) {
    const p = estimatePercent(s * 1000, 40_000);
    assert.ok(p >= last, 'never goes backwards');
    assert.ok(p <= CAP_PERCENT, 'never past the cap');
    last = p;
  }
  assert.equal(estimatePercent(3600_000, 40_000), CAP_PERCENT);
  assert.ok(estimatePercent(40_000, 40_000) > 80);
});

test('bad input degrades to 0 instead of NaN', () => {
  assert.equal(estimatePercent(NaN, 40_000), 0);
  assert.equal(estimatePercent(-5, 40_000), 0);
  assert.ok(Number.isInteger(estimatePercent(10_000, undefined)));
});

test('slow models and video take longer than images', () => {
  assert.equal(expectedDurationMs('auto-short-32s'), 360_000);
  assert.ok(expectedDurationMs('kling-2.6') > expectedDurationMs('flux-pro'));
  assert.ok(expectedDurationMs('some-music-model') > expectedDurationMs('flux-pro'));
  assert.equal(expectedDurationMs(undefined), expectedDurationMs('flux-pro'));
});

test('rows hold unsettled recent jobs, oldest first, with a label and percent', () => {
  const now = 1_000_000_000_000;
  const rows = barRows(
    [
      { job_id: 'new', model_id: 'flux-pro', submitted_at: now - 1000, prompt: 'a fox' },
      { job_id: 'old', model_id: 'flux-pro', submitted_at: now - 30_000, name: 'Poster' },
      { job_id: 'done', submitted_at: now - 1000, settled: 'succeeded' },
      { job_id: 'stale', submitted_at: now - BAR_MAX_AGE_MS - 1 },
      null,
    ],
    now,
  );
  assert.deepEqual(rows.map((r) => r.job_id), ['old', 'new']);
  assert.equal(rows[0].label, 'Poster');
  assert.ok(rows[0].percent > rows[1].percent);
  assert.deepEqual(barRows(undefined, now), []);
});
