import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSessionLoss } from '../app/veyrnox/_lib/proEditorSessionLoss.mjs';

test('identity is dropped and the frame removed synchronously, before the purge result exists', () => {
    const order = [];
    let finish;
    const promise = handleSessionLoss({
        invalidate: () => order.push('invalidate'),
        removeFrame: () => order.push('remove'),
        purge: () => { order.push('purge'); return new Promise((r) => { finish = r; }); },
        onResult: (r) => order.push('result:' + r.reason),
    });
    assert.deepEqual(order, ['invalidate', 'remove'], 'nothing waits on the wipe');
    return Promise.resolve().then(() => { assert.deepEqual(order.slice(0, 3), ['invalidate', 'remove', 'purge']); finish({ ok: true, reason: 'none' }); return promise; })
        .then((result) => { assert.deepEqual(result, { ok: true, reason: 'none' }); assert.equal(order.at(-1), 'result:none'); });
});

test('a failing step never skips the others, and a purge that throws or never answers is bounded', async () => {
    const seen = [];
    const thrown = await handleSessionLoss({
        invalidate: () => { throw new Error('cache'); },
        removeFrame: () => { seen.push('removed'); throw new Error('gone'); },
        purge: () => { throw new Error('boom'); },
        onResult: (r) => seen.push(r.reason),
    });
    assert.deepEqual(thrown, { ok: false, reason: 'error' });
    assert.deepEqual(seen, ['removed', 'error']);
    const slow = await handleSessionLoss({ invalidate() {}, removeFrame() {}, purge: () => new Promise(() => {}), timeoutMs: 20 });
    assert.deepEqual(slow, { ok: false, reason: 'timeout' });
});

test('an incomplete wipe is reported to the recorder', async () => {
    const recorded = [];
    await handleSessionLoss({ invalidate() {}, removeFrame() {}, purge: async () => ({ ok: false, reason: 'owned-elsewhere' }), onResult: (r) => recorded.push(r) });
    assert.deepEqual(recorded, [{ ok: false, reason: 'owned-elsewhere' }]);
});
