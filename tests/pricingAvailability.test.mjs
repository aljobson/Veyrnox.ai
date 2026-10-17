import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The page's words live in the English catalog (ADR-0107): the page source plus
// that catalog is everything a visitor can read here.
const pricing = readFileSync(new URL('../app/veyrnox/pricing/page.js', import.meta.url), 'utf8')
  + readFileSync(new URL('../lib/i18n/messages/en.mjs', import.meta.url), 'utf8');

test('the pricing catalog distinguishes loading from an unavailable live catalog', () => {
  assert.match(pricing, /status: 'loading'/);
  assert.match(pricing, /status: 'live'/);
  assert.match(pricing, /status: 'unavailable'/);
  assert.match(pricing, /Loading live prices/);
  assert.match(pricing, /bundled reference list/);
  assert.doesNotMatch(pricing, /Showing the cached list; the live catalog did not answer/);
});

test('public price reads use their bounded endpoint cache instead of forcing no-store', () => {
  assert.match(pricing, /fetch\('\/api\/catalog'\)/);
  assert.match(pricing, /fetch\('\/api\/credit-packs'\)/);
  assert.doesNotMatch(pricing, /fetch\('\/api\/(?:catalog|credit-packs)', \{ cache: 'no-store' \}\)/);
});

test('the Credit Pack section stays visible in loading, unavailable, empty and populated states', () => {
  assert.doesNotMatch(pricing, /\{packs && \(\s*<section/);
  assert.match(pricing, /Loading Credit Packs/);
  assert.match(pricing, /Credit Packs are temporarily unavailable/);
  assert.match(pricing, /No Credit Packs are available right now/);
  assert.match(pricing, /packState\.packs\.map/);
});

test('model rows translate credits into a clearly qualified live pack-value range', () => {
  assert.match(pricing, /creditValueRange/);
  assert.match(pricing, /Approx\. pack value/);
  assert.match(pricing, /Based on current pack rates before tax/);
  assert.match(pricing, /packState\.status === 'success'/);
  assert.doesNotMatch(pricing, /hidden md:table-cell[^>]*>\s*<PackValue/s);
});
