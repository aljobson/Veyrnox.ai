import test from 'node:test';
import assert from 'node:assert/strict';
import { assetRetention } from '../app/veyrnox/_lib/assetRetention.js';
import { mergeHydrated } from '../app/veyrnox/_lib/jobWindow.js';

const now = Date.parse('2026-09-24T12:00:00Z');
const row = { job_id: 'a', state: 'succeeded', has_asset: true };
test('retention notices use the asset deadline, not the job creation date', () => {
  const future = { ...row, submitted_at: 0, asset_expires_at: '2026-10-24T12:00:00Z' };
  assert.match(assetRetention(future, now).text, /^File expires /);
  assert.equal(assetRetention(future, now).urgent, false);
  assert.equal(assetRetention({ ...future, asset_expires_at: '2026-10-01T12:00:00Z' }, now).urgent, true);
  assert.match(assetRetention({ ...future, asset_expires_at: '2026-09-24T12:00:00Z' }, now).text, /^Retention ended /);
});
test('missing files, unknown deadlines and unfinished jobs do not invent expiry dates', () => {
  assert.match(assetRetention({ ...row, has_asset: false }, now).text, /^File unavailable/);
  for (const value of [undefined, null, 'invalid']) {
    assert.match(assetRetention({ ...row, asset_expires_at: value }, now).text, /kept for 90 days/);
  }
  assert.equal(assetRetention({ ...row, state: 'failed' }, now), null);
  assert.equal(assetRetention({ ...row, state: 'running' }, now), null);
});
test('local hydration preserves account rows and retention metadata by job id', () => {
  const server = [{ ...row, job_id: 'other-device' }, { ...row, asset_expires_at: '2026-10-01T12:00:00Z' }];
  const merged = mergeHydrated(server, [{ job_id: 'a', state: 'succeeded', asset_url: 'https://r2.test/a' }]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], server[0]);
  assert.equal(merged[1].asset_expires_at, server[1].asset_expires_at);
  assert.equal(merged[1].asset_url, 'https://r2.test/a');
});
