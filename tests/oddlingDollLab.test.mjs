import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/veyrnox/_components/OddlingStudio.js', import.meta.url), 'utf8');

test('Oddling Studio presents a visual doll workflow and a price-forward action', () => {
  assert.match(source, /ODDLING DOLL LAB/);
  assert.match(source, /Every choice updates the real generation prompt/);
  assert.match(source, /Generate portrait/);
  assert.match(source, /Animate character/);
  assert.match(source, /LIVE PRICE/);
  assert.match(source, /NO CHARGE UNTIL CONFIRMED/);
});

test('balance lookup is gated by a stored session and warns before Create', () => {
  assert.match(source, /if \(!session\) \{ setBalance\(null\); return; \}/);
  assert.match(source, /gatewayFetch\('\/balance'\)/);
  assert.match(source, /Credits are running low/);
  assert.match(source, /Not enough credits/);
  assert.match(source, /href="\/app\/credits"/);
  assert.doesNotMatch(source, /gatewayFetch\('\/generations'/);
});
