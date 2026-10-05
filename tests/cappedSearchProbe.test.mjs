// The capped-search cost probe: how a measured search fee becomes a recorded worst case and a number of Credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_RATES, TOKENS_BOUND, extraCosts, feeBound, outcome } from '../scripts/measure-capped-search.mjs';
import { SEARCH_CONTEXT_MAX_CHARS } from '../lib/chat.js';

test('the fee bound is the dearest search seen plus 50%, rounded up to a tenth of a cent, and never below a cent', () => {
    assert.equal(feeBound([0.007, 0.008, 0.011]), 0.017);
    assert.equal(feeBound([0.005]), 0.01, 'a floor of one cent');
    assert.equal(feeBound([0.0101]), 0.016, 'rounded up, not to nearest');
    assert.throws(() => feeBound([]), /no measured/i);
    assert.throws(() => feeBound([null, NaN]), /no measured/i);
});

test('injected tokens are bounded at one token per character of the context limit, which holds for any language', () => {
    assert.equal(TOKENS_BOUND, SEARCH_CONTEXT_MAX_CHARS);
    assert.equal(TOKENS_BOUND, 7000);
});

test('every catalog model has an input rate, and the extra is fee plus tokens at that rate, with Credits at the margin floor', () => {
    assert.deepEqual(Object.keys(INPUT_RATES).sort(), [
        'chat-claude-opus-5.5', 'chat-claude-sonnet-5.5', 'chat-deepseek-v4.1-flash', 'chat-gemini-3.8-flash', 'chat-gpt-6-luna', 'chat-gpt-6.1-sol',
        'chat-grok-4.7', 'chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small']);
    const rows = Object.fromEntries(extraCosts(0.017).map((r) => [r.id, r]));
    assert.equal(rows['chat-claude-opus-5.5'].cost, 0.045, '0.017 + 7000 x 4e-6');
    assert.equal(rows['chat-claude-opus-5.5'].credits, 3, 'ceil(0.045 / 0.01796)');
    assert.equal(rows['chat-gpt-6-luna'].cost, 0.0177);
    assert.equal(rows['chat-gpt-6-luna'].credits, 1);
    for (const r of Object.values(rows)) assert.ok(r.credits >= Math.ceil(Math.round((r.cost / 0.01796) * 1e6) / 1e6) && r.credits >= 1, r.id);
});

test('a dearer fee never lowers a price', () => {
    const lo = extraCosts(0.01), hi = extraCosts(0.06);
    for (let i = 0; i < lo.length; i++) { assert.ok(hi[i].cost >= lo[i].cost); assert.ok(hi[i].credits >= lo[i].credits); }
});

test('when no search worked the probe says so plainly instead of throwing, and says what to check', () => {
    for (const costs of [[], [null, NaN], [undefined]]) {
        const r = outcome(costs, 5);
        assert.equal(r.ok, false);
        assert.match(r.message, /no search succeeded/i);
        assert.match(r.message, /check the key/i);
        assert.ok(!/\bstack\b|Error:|\bthrow/i.test(r.message), 'no trace or error text in the message');
    }
});

test('when some searches worked it measures from those, and says how many failed', () => {
    const r = outcome([0.008, null, 0.011], 3);
    assert.equal(r.ok, true);
    assert.equal(r.fee, 0.017);
    assert.equal(r.failed, 1);
    assert.equal(outcome([0.008], 1).failed, 0);
});

test('with the measured fee ($0.007 a search, so a bound of $0.011) most models are one Credit, Sonnet-class two, Opus three', () => {
    assert.equal(feeBound([0.007, 0.007, 0.007, 0.007, 0.007]), 0.011);
    const credits = Object.fromEntries(extraCosts(0.011).map((r) => [r.id, r.credits]));
    assert.deepEqual(credits, {
        'chat-claude-opus-5.5': 3, 'chat-claude-sonnet-5.5': 2, 'chat-deepseek-v4.1-flash': 1, 'chat-gemini-3.8-flash': 1, 'chat-gpt-6-luna': 1,
        'chat-gpt-6.1-sol': 2, 'chat-grok-4.7': 2, 'chat-llama-4-maverick': 1, 'chat-ministral-14b': 1, 'chat-mistral-small': 1,
    });
});
