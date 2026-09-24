import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatch } from '../scripts/audit-pricing-parity.mjs';
const ultra = {price_usd: 129, credits: 3000};
const match = {credits: 5, confidence: 'specified-tier'};

test('Kling no-audio parity exposes a real loss instead of multiplying clip cost by seconds', () => {
    const r = evaluateMatch({provider_cost_per_unit: '0.2750', cost_unit: 'per_second', billing_seconds: 5, active: true}, match, ultra);
    assert.equal(r.cost, 0.275);
    assert.equal(r.revenue, 0.215);
    assert.ok(Math.abs(r.contribution + 0.06) < 1e-10);
    assert.equal(r.providerBreakEven, false);
});
test('payment fees turn near-break-even Wan matching into a loss', () => {
    const model = {provider_cost_per_unit: 0.30, active: true};
    assert.equal(evaluateMatch(model, {...match, credits: 7}, ultra).providerBreakEven, true);
    assert.equal(evaluateMatch(model, {...match, credits: 7}, ultra, {percent: 8, fixedUsd: 0.30}).providerBreakEven, false);
});
test('inactive cheap route stays inactive and cannot stand in for current supplier cost', () => {
    const r = evaluateMatch({provider_cost_per_unit: 0.0271, active: false}, {...match, credits: 2}, ultra);
    assert.equal(r.active, false);
    assert.equal(r.cost, 0.0271);
    const live = evaluateMatch({provider_cost_per_unit: 0.09, active: true}, {...match, credits: 2}, ultra);
    assert.equal(live.providerBreakEven, false);
});
test('fees allocate once per pack, rather than charging a fixed fee per generation', () => {
    const r = evaluateMatch({provider_cost_per_unit: 0.02, active: true}, {...match, credits: 1}, ultra, {percent: 8, fixedUsd: 0.30});
    assert.ok(Math.abs(r.contribution - ((129 * 0.92 - 0.30) / 3000 - 0.02)) < 1e-10);
});
test('invalid scenarios fail rather than reporting misleading margins', () => {
    for (const cost of [NaN, -1, Infinity]) assert.throws(() => evaluateMatch({provider_cost_per_unit: cost}, match, ultra));
    assert.throws(() => evaluateMatch({provider_cost_per_unit: 0.02}, match, {...ultra, credits: 0}));
    assert.throws(() => evaluateMatch({provider_cost_per_unit: 0.02}, match, ultra, {percent: 100, fixedUsd: 0}));
});
