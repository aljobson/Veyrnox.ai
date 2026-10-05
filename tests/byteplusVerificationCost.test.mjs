import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBytePlusCost } from '../scripts/lib/byteplus-verification-cost.mjs';

test('a Fast job that matched the old 1:1 pack estimate fails the activation cost check', () => {
    const result = assessBytePlusCost('byteplus:seedance-2.0-fast', 106061, 0.35);
    assert.equal(result.billedCost, 0.5939);
    assert.equal(result.costWithinTolerance, false);
});

test('missing or invalid usage cannot pass on successful media output alone', () => {
    for (const tokens of [null, undefined, 0, -1, NaN, Infinity, '100000']) {
        assert.equal(assessBytePlusCost('byteplus:seedance-2.0-fast', tokens, 0.35).costWithinTolerance, false);
    }
    assert.equal(assessBytePlusCost('unknown', 100000, 0.35).costWithinTolerance, false);
});

test('PAYG 1.0 route retains its separate rate and valid positive evidence can pass', () => {
    const result = assessBytePlusCost('byteplus:seedance-1.0-pro-fast', 100000, 0.10);
    assert.equal(result.billedCost, 0.10);
    assert.equal(result.costWithinTolerance, true);
    assert.equal(assessBytePlusCost('byteplus:seedance-2.5', 100000, 1.07).costWithinTolerance, true);
});
