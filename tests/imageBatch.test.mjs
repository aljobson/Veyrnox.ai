import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IMAGE_COUNTS, takesImageCount, imageCount, totalCost, seedForIndex, inputsForIndex, batchNote, sendInOrder,
    submitErrorCode,
} from '../app/veyrnox/_lib/imageBatch.js';
import { SEED_MAX } from '../app/veyrnox/_lib/generationSettings.js';

const image = { kind: 'image', credits: 4 };

test('the count is offered to image models only, never an Auto Short', () => {
    assert.deepEqual(IMAGE_COUNTS, [1, 2, 3, 4]);
    assert.equal(takesImageCount(image), true);
    assert.equal(takesImageCount({ kind: 'video' }), false);
    assert.equal(takesImageCount({ kind: 'audio' }), false);
    assert.equal(takesImageCount({ kind: 'image', takesTopic: true }), false);
    assert.equal(takesImageCount(null), false);
});

test('any other model, or a count outside 1–4, sends exactly one', () => {
    assert.equal(imageCount(image, 3), 3);
    assert.equal(imageCount({ kind: 'video' }, 4), 1);
    assert.equal(imageCount(null, 4), 1);
    for (const bad of [0, 5, -1, 2.5, '2', undefined]) assert.equal(imageCount(image, bad), 1, String(bad));
});

test('the total is the per-unit price times the count', () => {
    assert.equal(totalCost(4, 1), 4);
    assert.equal(totalCost(4, 3), 12);
    assert.equal(totalCost(0, 4), 0);
});

test('seeds step by index and wrap inside the range the gateway accepts', () => {
    assert.equal(seedForIndex(42, 0), 42);
    assert.equal(seedForIndex(42, 3), 45);
    assert.equal(seedForIndex(SEED_MAX, 0), SEED_MAX);
    assert.equal(seedForIndex(SEED_MAX, 1), 0);
    assert.equal(seedForIndex(SEED_MAX - 1, 3), 1);
    for (let i = 0; i < 4; i++) {
        const s = seedForIndex(SEED_MAX - 2, i);
        assert.ok(Number.isInteger(s) && s >= 0 && s <= SEED_MAX, String(s));
    }
});

test('a set seed shifts only in a batch; no seed stays absent', () => {
    const withSeed = { prompt: 'p', seed: 7 };
    assert.equal(inputsForIndex(withSeed, 0, 1), withSeed);
    assert.deepEqual(inputsForIndex(withSeed, 2, 4), { prompt: 'p', seed: 9 });
    assert.deepEqual(withSeed, { prompt: 'p', seed: 7 }, 'the shared inputs are not mutated');
    const noSeed = { prompt: 'p' };
    assert.deepEqual(inputsForIndex(noSeed, 3, 4), { prompt: 'p' });
    assert.equal('seed' in inputsForIndex(noSeed, 3, 4), false);
    assert.deepEqual(inputsForIndex({ seed: 0 }, 1, 2), { seed: 1 });
});

test('the failure note says how many of the batch started', () => {
    assert.equal(batchNote(0, 1, 'rate_limited'), '');
    assert.equal(batchNote(1, 1, 'outcome_unknown'), '');
    assert.equal(batchNote(0, 4, 'rate_limited'), '0 of 4 started; image 1 did not.');
    assert.equal(batchNote(2, 4, 'insufficient_balance'), '2 of 4 started; image 3 did not.');
});

test('the note never claims what was charged; an unknown outcome points to Library', () => {
    for (const code of ['rate_limited', 'insufficient_balance', 'provider_submit_failed', 'outcome_unknown']) {
        assert.doesNotMatch(batchNote(2, 4, code), /charged/i, code);
    }
    assert.equal(batchNote(2, 4, 'outcome_unknown'), '2 of 4 started; image 3 may have too — check Library.');
});

test('a submit whose reply was lost is reported as an unknown outcome', () => {
    // Dropped connection / client throw, non-JSON 5xx, ledger_debit RPC error,
    // session swap after the reply: the gateway may have debited request k.
    for (const code of ['internal', 'gateway_error', 'debit_failed', 'account_changed']) {
        assert.equal(submitErrorCode(code), 'outcome_unknown', code);
    }
    // Refusals the gateway answered before (or refunded after) the debit keep their own copy.
    for (const code of ['rate_limited', 'insufficient_balance', 'account_frozen', 'debit_rejected',
        'model_gated', 'consent_required', 'provider_submit_failed', 'provider_moderation', 'unauthenticated']) {
        assert.equal(submitErrorCode(code), code, code);
    }
});

test('sendInOrder sends one at a time, in order', async () => {
    const order = [];
    let active = 0;
    let peak = 0;
    const result = await sendInOrder(4, async (i) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        order.push(i);
        active -= 1;
    });
    assert.deepEqual(order, [0, 1, 2, 3]);
    assert.equal(peak, 1, 'never two requests in flight');
    assert.deepEqual(result, { started: 4, error: null });
});

test('sendInOrder stops at the first failure and never retries', async () => {
    const calls = [];
    const boom = Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
    const result = await sendInOrder(4, async (i) => {
        calls.push(i);
        if (i === 2) throw boom;
    });
    assert.deepEqual(calls, [0, 1, 2], 'request 3 is never sent, request 2 is never resent');
    assert.equal(result.started, 2);
    assert.equal(result.error, boom);

    const first = await sendInOrder(3, async () => { throw boom; });
    assert.deepEqual(first, { started: 0, error: boom });
});

test('lost durable admission is an uncertain batch outcome', () => {
    assert.equal(submitErrorCode('dispatch_acceptance_unknown'), 'outcome_unknown');
    assert.match(batchNote(1, 3, submitErrorCode('dispatch_acceptance_unknown')), /may have too/);
});
