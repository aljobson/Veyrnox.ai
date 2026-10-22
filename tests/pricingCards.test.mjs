import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';

const file = 'app/veyrnox/_components/PricingCards.js';
const PACKS = [
  { id: 'web-160', credits: 160, price_usd_cents: 1000 },
  { id: 'web-330', credits: 330, price_usd_cents: 1900 },
  { id: 'web-1300', credits: 1300, price_usd_cents: 5900 },
  { id: 'web-3000', credits: 3000, price_usd_cents: 12900 },
];

function render(packs, typical, locale = 'en') {
  const f = fixture(locale, '/pricing');
  return f.render(React.createElement(f.load(file).PricingCards, { packs, typical }));
}

test('every live pack is a card in the same row, and only the cheapest pack per credit is marked best value', () => {
  const html = render(PACKS, { image: 2, video: 19 });
  assert.equal((html.match(/data-pack=/g) || []).length, PACKS.length);
  assert.doesNotMatch(html, /role="tab/);
  assert.match(html, /xl:grid-cols-4/);
  assert.equal((html.match(/Best value/g) || []).length, 1);
  const cards = Object.fromEntries(html.split('data-pack="').slice(1).map((chunk) => [chunk.slice(0, chunk.indexOf('"')), chunk]));
  assert.match(cards['web-3000'], /Best value/);
  assert.match(cards['web-3000'], /\$0\.043 per credit/);
  for (const [id, price] of [['web-160', '$10'], ['web-330', '$19'], ['web-1300', '$59'], ['web-3000', '$129']]) {
    assert.ok(cards[id].includes(price), `${id} shows ${price}`);
    if (id !== 'web-3000') assert.doesNotMatch(cards[id], /Best value/);
  }
});

test('the saving is measured against the dearest pack, never against a typed list price', () => {
  const html = render(PACKS, null);
  // 0.043 against 0.0625 a credit (the dearest pack): 31% off the entry rate.
  assert.match(html, /Save 31%/);
  assert.doesNotMatch(html, /<s[ >]|<del[ >]|line-through/);
});

test('what a pack buys comes from the live typical prices and is left out without them', () => {
  const withCosts = render(PACKS, { image: 2, video: 19 });
  assert.match(withCosts, /Images, about 1,500/);
  assert.match(withCosts, /Five-second clips, about 157/);
  assert.match(withCosts, /Images, about 80</);
  assert.match(withCosts, /Five-second clips, about 8</);
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
  assert.equal((html.match(/href="\/app\/credits"/g) || []).length, PACKS.length);
  const de = render(PACKS, null, 'de');
  assert.match(de, /Credits verfallen nie/);
  assert.match(de, /Bester Preis/);
});
