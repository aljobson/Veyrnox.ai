import test from 'node:test';
import assert from 'node:assert/strict';
import { createSetupDeadline, acquireSetupTracker } from '../app/veyrnox/_lib/videoEnhanceSetup.mjs';

test('stalled setup expires and disposes a tracker that completes later', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let timedOut = 0, closed = 0, complete;
    const setup = createSetupDeadline(() => { timedOut++; });
    const pending = acquireSetupTracker(() => new Promise(resolve => { complete = resolve; }), setup.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    t.mock.timers.tick(29999);
    assert.equal(timedOut, 0);
    t.mock.timers.tick(1);
    assert.equal(timedOut, 1);
    assert.equal(setup.signal.aborted, true);
    complete({ close() { closed++; } });
    await rejected;
    assert.equal(closed, 1);
});

test('replacing a source prevents stale setup from winning over the new one', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let complete, closed = 0;
    const old = createSetupDeadline(() => assert.fail('Cancelled source timed out'));
    const pending = acquireSetupTracker(() => new Promise(resolve => { complete = resolve; }), old.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    old.cancel();
    const next = createSetupDeadline(() => assert.fail('Ready source timed out'));
    const tracker = { close() { assert.fail('Active tracker closed prematurely'); } };
    assert.equal(await acquireSetupTracker(async () => tracker, next.signal), tracker);
    next.finish();
    complete({ close() { closed++; } });
    await rejected;
    t.mock.timers.tick(60000);
    assert.equal(closed, 1);
    assert.equal(next.signal.aborted, false);
    next.cancel();
    assert.equal(next.signal.aborted, true);
});

test('cancellation before tracker creation never starts expensive work', async () => {
    const setup = createSetupDeadline(() => assert.fail('Cancelled setup timed out'));
    setup.cancel();
    await assert.rejects(acquireSetupTracker(() => assert.fail('Tracker started'), setup.signal), { name: 'AbortError' });
});

test('a failed attempt can finish without a later timeout overwriting its error', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const setup = createSetupDeadline(() => assert.fail('Failure overwritten by timeout'));
    await assert.rejects(acquireSetupTracker(async () => { throw new Error('model unavailable'); }, setup.signal), /model unavailable/);
    setup.finish();
    t.mock.timers.tick(60000);
});
