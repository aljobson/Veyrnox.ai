import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_PROMPT_KEYS, EXAMPLE_ROTATE_MS, nextExampleIndex } from '../app/veyrnox/_lib/music/beat/beatExamples.mjs';
import * as ai from '../app/veyrnox/_lib/music/beat/beatAi.mjs';
import * as magic from '../app/veyrnox/_lib/music/beat/magicBar.mjs';

const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];

test('the example index steps through every example and wraps', () => {
  const seen = [];
  let index = 0;
  for (let step = 0; step < EXAMPLE_PROMPT_KEYS.length; step += 1) { seen.push(index); index = nextExampleIndex(index); }
  assert.deepEqual(seen, [...EXAMPLE_PROMPT_KEYS.keys()]);
  assert.equal(index, 0);
});

test('a bad index starts over at the first example', () => {
  for (const bad of [-1, 1.5, NaN, undefined, null, '2']) assert.equal(nextExampleIndex(bad), 0);
  assert.equal(nextExampleIndex(0, 0), 0);
});

test('the rotation is slow enough to read', () => {
  assert.ok(EXAMPLE_ROTATE_MS >= 4000);
});

test('both prompt fields get the same examples', () => {
  assert.equal(ai.EXAMPLE_PROMPT_KEYS, EXAMPLE_PROMPT_KEYS);
  assert.equal(magic.EXAMPLE_PROMPT_KEYS, EXAMPLE_PROMPT_KEYS);
});

test('every example has copy in every locale and is short enough for a placeholder', async () => {
  for (const locale of LOCALES) {
    const { default: messages } = await import(`../lib/i18n/messages/app/${locale}/music-beat-ui-1.mjs`);
    for (const key of EXAMPLE_PROMPT_KEYS) {
      assert.equal(typeof messages[key], 'string', `${locale} is missing ${key}`);
      assert.ok(messages[key].trim().length > 0 && messages[key].length <= 80, `${locale} ${key}`);
    }
  }
});

test('the examples ask for instrumental parts only', async () => {
  const { default: en } = await import('../lib/i18n/messages/app/en/music-beat-ui-1.mjs');
  for (const key of EXAMPLE_PROMPT_KEYS) assert.doesNotMatch(en[key], /\b(lyrics?|vocals?|sing|singer|rap)\b/i);
});
