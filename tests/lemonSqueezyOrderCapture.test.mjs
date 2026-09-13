import test from 'node:test';
import assert from 'node:assert/strict';
import { orderIdentifierMatches } from '../packages/adapters/lemonsqueezy.js';

const ID = '104e18a2-d755-4d4b-80c4-a6c1dcbe1c10';
const order = (identifier) => ({ id: '1', attributes: { identifier } });

// The redirect's order_id is a guessable number; only the order's secret
// identifier proves the caller came back from paying that order (#94).
test('orderIdentifierMatches: the re-fetched order identifier must equal the redirect value', () => {
    assert.equal(orderIdentifierMatches(order(ID), ID), true);
    assert.equal(orderIdentifierMatches(order(ID), ID.toUpperCase()), true, 'UUID case is not significant');
    assert.equal(orderIdentifierMatches(order(ID), '204e18a2-d755-4d4b-80c4-a6c1dcbe1c10'), false);
});

test('orderIdentifierMatches: fails closed on missing or malformed values', () => {
    assert.equal(orderIdentifierMatches(order(ID), '[order_identifier]'), false, 'an unreplaced link variable');
    assert.equal(orderIdentifierMatches(order(ID), ''), false);
    assert.equal(orderIdentifierMatches(order(ID), undefined), false);
    assert.equal(orderIdentifierMatches(order(undefined), ID), false);
    assert.equal(orderIdentifierMatches(order('not-a-uuid'), 'not-a-uuid'), false);
    assert.equal(orderIdentifierMatches(null, ID), false);
});
