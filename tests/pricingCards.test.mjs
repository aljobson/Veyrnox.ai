import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';

const file = 'app/veyrnox/_components/PricingCards.js';
const PACKS = [
  { id: 'web-100', credits: 100, price_usd_cents: 1000 },
  { id: 'web-270', credits: 270, price_usd_cents: 1900 },
  { id: 'web-1200', credits: 1200, price_usd_cents: 5900 },
  { id: 'web-3000', credits: 3000, price_usd_cents: 12900 },
];

function render(packs, typical, locale = 'en') {
  const f = fixture(locale, '/pricing');
  return f.render(React.createElement(f.load(file).PricingCards, { packs, typical }));
}

test('one tab per live pack, and the cheapest pack per credit is the one shown and marked best value', () => {
  const html = render(PACKS, { image: 2, video: 19 });
  assert.equal((html.match(/role="tab"/g) || []).length, PACKS.length);
  assert.match(html, /aria-selected="true"[^>]*>3,000</);
  assert.match(html, /Best value/);
  assert.match(html, /\$129/);
  assert.match(html, /\$0\.043 per credit/);
});

test('the saving is measured against the dearest pack, never against a typed list price', () => {
  const html = render(PACKS, null);
  // 0.043 against 0.100 a credit: 57% off the entry rate.
  assert.match(html, /Save 57%/);
  assert.doesNotMatch(html, /<s[ >]|<del[ >]|line-through/);
});

test('what a pack buys comes from the live typical prices and is left out without them', () => {
  const withCosts = render(PACKS, { image: 2, video: 19 });
  assert.match(withCosts, /Images, about 1,500/);
  assert.match(withCosts, /Five-second clips, about 157/);
  const without = render(PACKS, null);
  assert.doesNotMatch(without, /about \d/);
  assert.doesNotMatch(without, /Images, about/);
});

test('packs at one rate show no best-value mark and no saving', () => {
  const html = render([{ id: 'a', credits: 100, price_usd_cents: 1000 }, { id: 'b', credits: 200, price_usd_cents: 2000 }], null);
  assert.doesNotMatch(html, /Best value/);
  assert.doesNotMatch(html, /Save \d/);
});

test('promises on the card are the real ones and a translation is used when one is set', () => {
  const html = render(PACKS, null);
  assert.match(html, /Credits never expire/);
  assert.match(html, /Failed jobs refund automatically/);
  assert.match(html, /href="\/app\/credits"/);
  const de = render(PACKS, null, 'de');
  assert.match(de, /Credits verfallen nie/);
  assert.match(de, /Bester Preis/);
});
