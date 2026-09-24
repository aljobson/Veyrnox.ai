import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAttribution, ATTRIBUTION_KEY } from '../app/veyrnox/_lib/utm.js';

test('retiring attribution deletes existing campaign data without storing new data', () => {
  const store = new Map([[ATTRIBUTION_KEY, '{"gclid":"old"}'], ['theme', 'dark']]);
  globalThis.localStorage = {
    removeItem: key => store.delete(key),
    setItem: () => assert.fail('must not collect attribution'),
  };
  clearAttribution();
  assert.equal(store.has(ATTRIBUTION_KEY), false);
  assert.equal(store.get('theme'), 'dark');
});

test('retirement tolerates blocked storage', () => {
  globalThis.localStorage = { removeItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(clearAttribution);
});
