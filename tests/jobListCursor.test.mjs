import test from 'node:test';
import assert from 'node:assert/strict';
import { jobCursorTimestamp, jobsPagePath } from '../lib/jobListCursor.js';
const id = 'b5eeff8e-3150-4448-a1eb-e8b96643ef26';

test('pagination retains all six fractional digits and UUID ties, without a plus sign in transit', () => {
  for (const before of ['2026-10-10T19:47:41.625562+00:00', '2026-10-10T19:47:41.625562Z']) {
    const path = jobsPagePath({ before, before_id: id });
    const parsed = new URL(`https://test.invalid${path}`).searchParams;
    assert.equal(parsed.get('before'), '2026-10-10T19:47:41.625562Z');
    assert.equal(parsed.get('before_id'), id);
    assert.equal(parsed.get('limit'), '24');
    assert.doesNotMatch(path, /%2B|\+/i);
  }
  assert.notEqual(jobCursorTimestamp('2026-10-10T19:47:41.625561+00:00'), jobCursorTimestamp('2026-10-10T19:47:41.625562+00:00'));
});

test('only a damaged UTC suffix is repaired; malformed cursors remain refused', () => {
  assert.equal(jobCursorTimestamp('2026-10-10T19:47:41.625562 00:00'), '2026-10-10T19:47:41.625562Z');
  for (const before of [null, '', 'tomorrow', '2026-10-10', '2026-10-10T19:47:41.625562 01:00', '2026-10-10T19:47:41.6255620Z', '2026-10-10T99:47:41Z']) {
    assert.throws(() => jobsPagePath({ before, before_id: id }), /invalid_cursor/);
  }
  assert.throws(() => jobsPagePath({ before: '2026-10-10T19:47:41Z', before_id: 'not-a-job' }), /invalid_cursor/);
});
