import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, compare, RECORDED_RATE } from '../scripts/check-crun-spend.mjs';

const row = (model, outcome, cost) => ({ outcome, cost_snapshot: cost, model_routes: { model_id: model } });

test('summarize splits completed from failed cost and groups by model', () => {
    const s = summarize([row('a', 'completed', '0.2670'), row('a', 'failed', '0.2670'), row('b', 'completed', '0.0730')]);
    assert.equal(s.jobs, 3);
    assert.ok(Math.abs(s.all - 0.607) < 1e-9);
    assert.ok(Math.abs(s.completed - 0.34) < 1e-9);
    assert.ok(Math.abs(s.failed - 0.267) < 1e-9);
    assert.equal(s.byModel.get('a').jobs, 2);
});

test('compare fits when the balance fall is between completed and all attempts', () => {
    const s = { all: 1, completed: 0.5 };
    assert.equal(compare(s, { before: 1000, after: 1000 - RECORDED_RATE * 0.7 }).verdict, 'fits');
});

test('compare flags a fall above the records unless outside spend is allowed', () => {
    const s = { all: 1, completed: 1 };
    const drop = RECORDED_RATE + 55;
    assert.equal(compare(s, { before: 1000, after: 1000 - drop }).verdict, 'over');
    assert.equal(compare(s, { before: 1000, after: 1000 - drop, allowCredits: 55 }).verdict, 'fits');
});

test('compare flags a fall below completed attempts', () => {
    assert.equal(compare({ all: 1, completed: 1 }, { before: 1000, after: 1000 }).verdict, 'under');
});

import { attemptCost, parseAmount } from '../scripts/check-crun-spend.mjs';

test('attemptCost scales a per-second route by 5 s blocks and leaves per-generation routes at one unit', () => {
    const kling = (sec) => ({ cost_snapshot: '0.2670', model_routes: { cost_unit: 'per_second', billing_seconds: '5.00' }, jobs: { duration_seconds: sec } });
    assert.ok(Math.abs(attemptCost(kling('5')) - 0.267) < 1e-9);
    assert.ok(Math.abs(attemptCost(kling('10')) - 0.534) < 1e-9);
    assert.ok(Math.abs(attemptCost(kling(null)) - 0.267) < 1e-9);
    assert.equal(attemptCost({ cost_snapshot: '0.0730', model_routes: { cost_unit: 'per_generation' }, jobs: { duration_seconds: '8' } }), 0.073);
});

test('parseAmount rejects separators, blanks, junk, negatives and a zero rate', () => {
    assert.equal(parseAmount('9186.74'), 9186.74);
    for (const bad of ['9,186.74', '', ' ', 'abc', '-5', '1e3', 'NaN', undefined]) assert.equal(parseAmount(bad), null);
    assert.equal(parseAmount('0', { positive: true }), null);
    assert.equal(parseAmount('212', { positive: true }), 212);
});
