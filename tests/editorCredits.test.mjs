import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editorCreditPack,
  editorCreditPacks,
  FREE_EDITOR_BENEFITS,
} from '../app/veyrnox/_lib/editorCredits.mjs';

test('editor credits preserve and sort the live one-off pack catalog', () => {
  const packs = editorCreditPacks([
    { id: 'web-3000', credits: 3000, price_usd_cents: 12900 },
    { id: 'web-100', credits: 100, price_usd_cents: 1000 },
    { id: 'web-1200', credits: 1200, price_usd_cents: 5900 },
    { id: 'web-270', credits: 270, price_usd_cents: 1900 },
  ]);
  assert.deepEqual(packs, [
    { id: 'web-100', credits: 100, price_usd_cents: 1000 },
    { id: 'web-270', credits: 270, price_usd_cents: 1900 },
    { id: 'web-1200', credits: 1200, price_usd_cents: 5900 },
    { id: 'web-3000', credits: 3000, price_usd_cents: 12900 },
  ]);
  assert.equal(FREE_EDITOR_BENEFITS.includes('No card required'), true);
});

test('editor credits reject malformed catalog rows', () => {
  assert.equal(editorCreditPack({ id: 'starter-monthly', credits: 270, price_usd_cents: 1900 }), null);
  assert.equal(editorCreditPack({ id: 'web-bad', credits: 0, price_usd_cents: 1900 }), null);
  assert.equal(editorCreditPack({ id: 'web-bad', credits: 270, price_usd_cents: 0 }), null);
});
