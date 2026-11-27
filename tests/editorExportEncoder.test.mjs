import test from 'node:test';
import assert from 'node:assert/strict';
import { addVideoFrameWithTimeout, ENCODER_STALLED, exportWithEncoderFallback } from '../app/veyrnox/_lib/editorExportEncoder.mjs';

test('a stalled video frame is bounded and a qualified software export retries once with the browser encoder', async () => {
    await assert.rejects(
        addVideoFrameWithTimeout(() => new Promise(() => {}), { timeoutMs: 5 }),
        error => error.code === ENCODER_STALLED,
    );
    const attempts = [], retries = [];
    const result = await exportWithEncoderFallback(async acceleration => {
        attempts.push(acceleration);
        if (acceleration === 'prefer-software') throw Object.assign(new Error('stalled'), { code: ENCODER_STALLED });
        return 'video';
    }, () => retries.push('retry'));
    assert.equal(result, 'video');
    assert.deepEqual(attempts, ['prefer-software', 'no-preference']);
    assert.deepEqual(retries, ['retry']);
});

test('cancellation interrupts a stalled write and ordinary export errors are never retried', async () => {
    const controller = new AbortController();
    const pending = addVideoFrameWithTimeout(() => new Promise(() => {}), { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    let attempts = 0;
    await assert.rejects(exportWithEncoderFallback(async () => { attempts++; throw new Error('decode failed'); }), /decode failed/);
    assert.equal(attempts, 1);
});
