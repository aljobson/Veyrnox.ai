import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '../lib/i18n/locales.mjs';
import en from '../lib/i18n/messages/app/en/faceless-reel.mjs';

test('every locale has its own illustrative example note without source-streaming claims', async () => {
  const key = 'app.features.exampleNote';
  assert.equal(en[key], 'Illustrative example. Results vary with your inputs and selected model.');
  for (const { code } of LOCALES) {
    const { default: messages } = await import(`../lib/i18n/messages/app/${code}/faceless-reel.mjs`);
    assert.ok(messages[key]?.trim(), code);
    assert.doesNotMatch(messages[key], /audited|streamed|lipsync\.video/i, code);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort(), code);
    if (code !== 'en') assert.notEqual(messages[key], en[key], code);
  }
});
