import test from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterSeconds, recordFailure, _reset } from '../lib/adminThrottle.js';

test('locks a bucket only after ten failures inside the window', () => {
    _reset();
    const t0 = 1_000_000;
    for (let i = 0; i < 9; i++) recordFailure('reap', t0 + i);
    assert.equal(retryAfterSeconds('reap', t0 + 9), 0);
    recordFailure('reap', t0 + 10);
    assert.ok(retryAfterSeconds('reap', t0 + 11) > 0);
});

test('buckets do not lock each other out', () => {
    _reset();
    const t0 = 2_000_000;
    for (let i = 0; i < 10; i++) recordFailure('reap', t0 + i);
    assert.ok(retryAfterSeconds('reap', t0) > 0);
    assert.equal(retryAfterSeconds('backfill', t0), 0);
});

test('the window slides: failures older than 60s stop counting', () => {
    _reset();
    const t0 = 3_000_000;
    for (let i = 0; i < 10; i++) recordFailure('reap', t0 + i);
    assert.ok(retryAfterSeconds('reap', t0 + 59_000) > 0);
    assert.equal(retryAfterSeconds('reap', t0 + 61_000), 0);
});

test('retry-after counts down toward the oldest failure leaving the window', () => {
    _reset();
    const t0 = 4_000_000;
    for (let i = 0; i < 10; i++) recordFailure('reap', t0);
    assert.equal(retryAfterSeconds('reap', t0), 60);
    assert.equal(retryAfterSeconds('reap', t0 + 30_000), 30);
});

test('a sustained flood cannot grow the bucket without limit', () => {
    _reset();
    const t0 = 5_000_000;
    // Far more attempts than the threshold, all inside one window.
    for (let i = 0; i < 5000; i++) {
        assert.ok(recordFailure('reap', t0 + i) <= 10, 'retained count must stay bounded');
    }
    // Still locked, and the lockout slid forward with the newest failures
    // rather than expiring 60s after the first one.
    assert.ok(retryAfterSeconds('reap', t0 + 5000) > 0);
    assert.ok(retryAfterSeconds('reap', t0 + 61_000) > 0, 'sustained abuse extends its own lockout');
    // And it does clear once the flood actually stops.
    assert.equal(retryAfterSeconds('reap', t0 + 5000 + 61_000), 0);
});
