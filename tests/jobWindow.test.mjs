import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHydrated, shouldPoll } from '../app/veyrnox/_lib/jobWindow.js';

const row = (job_id, state) => ({ job_id, state });

test('mergeHydrated replaces the hydrated head and keeps the un-hydrated tail', () => {
    const prev = [row('a', 'queued'), row('b', 'queued'), row('c', 'queued')];
    const results = [row('a', 'succeeded'), row('b', 'failed')];
    assert.deepEqual(mergeHydrated(prev, results), [
        row('a', 'succeeded'), row('b', 'failed'), row('c', 'queued'),
    ]);
});

test('mergeHydrated is a no-op tail when the whole list was hydrated', () => {
    const prev = [row('a', 'queued')];
    assert.deepEqual(mergeHydrated(prev, [row('a', 'running')]), [row('a', 'running')]);
});

test('shouldPoll never reaches past the visible window', () => {
    const rows = [row('a', 'running'), row('b', 'queued'), row('c', 'queued')];
    assert.deepEqual(rows.map((r, i) => shouldPoll(r, i, 2)), [true, true, false]);
});

test('shouldPoll skips settled rows inside the window', () => {
    assert.equal(shouldPoll(row('a', 'succeeded'), 0, 12), false);
    assert.equal(shouldPoll(row('a', 'failed'), 0, 12), false);
});
