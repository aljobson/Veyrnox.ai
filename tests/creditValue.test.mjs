import test from 'node:test';
import assert from 'node:assert/strict';

import { creditValueRange, formatUsdRange } from '../app/veyrnox/_lib/creditValue.js';

const packs = [
  { credits: 100, price_usd_cents: 1000 },
  { credits: 500, price_usd_cents: 4000 },
  { credits: 1000, price_usd_cents: 7000 },
];

test('creditValueRange derives the low and high cash equivalent from live pack rates', () => {
  assert.deepEqual(creditValueRange(5, packs), { minCents: 35, maxCents: 50 });
});

test('creditValueRange ignores malformed packs and refuses invalid credit costs', () => {
  assert.deepEqual(
    creditValueRange(2, [...packs, { credits: 0, price_usd_cents: 1 }, { credits: 10, price_usd_cents: -1 }]),
    { minCents: 14, maxCents: 20 },
  );
  assert.equal(creditValueRange(0, packs), null);
  assert.equal(creditValueRange(2, []), null);
});

test('formatUsdRange keeps exact values compact and ranges explicit', () => {
  assert.equal(formatUsdRange({ minCents: 35, maxCents: 50 }), '$0.35–$0.50');
  assert.equal(formatUsdRange({ minCents: 50, maxCents: 50 }), '$0.50');
  assert.equal(formatUsdRange(null), null);
});
