import test from 'node:test';
import assert from 'node:assert/strict';
import { jobsToWatch, WATCH_MAX_AGE_MS } from '../app/veyrnox/_lib/jobHistory.js';

test('only unsettled jobs from the last hour are watched', () => {
    const now = 1_000_000_000_000;
    const history = [
        { job_id: 'a', submitted_at: now - 60_000 },
        { job_id: 'b', submitted_at: now - 60_000, settled: 'succeeded' },
        { job_id: 'c', submitted_at: now - WATCH_MAX_AGE_MS - 1 },
        { job_id: 'd' },
        null,
    ];
    assert.deepEqual(jobsToWatch(history, now).map((r) => r.job_id), ['a']);
    assert.deepEqual(jobsToWatch(undefined, now), []);
});
