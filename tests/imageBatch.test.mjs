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
    for (const code of ['internal', 'network_error', 'gateway_error', 'debit_failed', 'account_changed']) {
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

test('admission_unknown is never described as a rejected request', () => {
    assert.equal(submitErrorCode('admission_unknown'), 'outcome_unknown');
    assert.match(batchNote(1, 3, 'admission_unknown'), /may have too/);
    assert.equal(submitErrorCode('admission_unavailable'), 'admission_unavailable');
});

test('continuation skips accepted items, retains keys and seeds, and allocates by unresolved position', async () => {
    const { createBatch, allocationSnapshot } = await import('../app/veyrnox/_lib/imageBatch.js');
    let id = 0;
    const batch = createBatch(3, () => `key-${++id}`);
    const calls = [];
    const send = async i => { calls.push([i, batch.keys[i], inputsForIndex({ seed: 7 }, i, 3).seed]); if (i === 1) throw { code: 'price_changed' }; return { job_id: 'accepted' }; };
    const first = await sendInOrder(3, send, batch);
    assert.equal(first.started, 1);
    const quote = allocationSnapshot(batch, 9, 1);
    assert.deepEqual(quote, { ceilings: [null, 0, 9], total: 9, payable: 9 });
    await sendInOrder(3, async i => { calls.push([i, batch.keys[i], inputsForIndex({ seed: 7 }, i, 3).seed]); return { job_id: `job-${i}` }; }, batch);
    assert.deepEqual(calls, [[0, 'key-1', 7], [1, 'key-2', 8], [1, 'key-2', 8], [2, 'key-3', 9]]);
    assert.deepEqual(createBatch(3, () => `key-${++id}`).keys, ['key-4', 'key-5', 'key-6']);
});

test('unknown requests retain their paid ceiling without reserving another allowance', async () => {
    const { createBatch, allocationSnapshot } = await import('../app/veyrnox/_lib/imageBatch.js');
    const batch = createBatch(2, () => 'same-key');
    await sendInOrder(2, async () => { throw { code: 'admission_unknown' }; }, batch);
    // The unknown item keeps its ceiling but adds nothing to the affordability total (its key replays).
    assert.deepEqual(allocationSnapshot(batch, 7, 1), { ceilings: [7, 0], total: 7, payable: 0 });
    await sendInOrder(2, async () => { throw { code: 'price_changed' }; }, batch);
    // A definitive refusal establishes there is no accepted job for that item.
    assert.deepEqual(allocationSnapshot(batch, 9, 0), { ceilings: [9, 9], total: 18, payable: 18 });
});

test('a partial batch replaces only a definitive refusal key, preserving uncertain and price-confirmation keys', async () => {
    const { createBatch } = await import('../app/veyrnox/_lib/imageBatch.js');
    for (const code of ['provider_submit_failed', 'price_changed', 'network_error', 'admission_unknown']) {
        let key = 0;
        const makeKey = () => `key-${++key}`;
        const batch = createBatch(3, makeKey);
        await sendInOrder(3, async i => {
            if (i === 1) throw { code };
            return { job_id: 'accepted' };
        }, batch, makeKey);
        assert.deepEqual(batch.keys, ['key-1', code === 'provider_submit_failed' ? 'key-4' : 'key-2', 'key-3']);
        assert.deepEqual(batch.accepted, [{ job_id: 'accepted' }, null, null]);
        assert.deepEqual([...batch.unknown], ['network_error', 'admission_unknown'].includes(code) ? [1] : []);
    }
});

test('a lost-reply item replays at zero balance: only unsubmitted items count toward the total', async () => {
    const { createBatch, allocationSnapshot, submitErrorCode } = await import('../app/veyrnox/_lib/imageBatch.js');
    const batch = createBatch(2, () => 'k');
    batch.unknown.add(0);
    assert.deepEqual(allocationSnapshot(batch, 5, 0), { ceilings: [5, 5], total: 10, payable: 5 });
    assert.deepEqual(allocationSnapshot({ accepted: [null], unknown: new Set([0]) }, 5, 0), { ceilings: [5], total: 5, payable: 0 });
    assert.equal(submitErrorCode('outcome_unknown'), 'outcome_unknown');
});
