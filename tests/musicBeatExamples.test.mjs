import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_PROMPT_KEYS, EXAMPLE_ROTATE_MS, nextExampleIndex, startExampleRotation } from '../app/veyrnox/_lib/music/beat/beatExamples.mjs';
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

// A window with a manual clock and a reduced-motion preference the test can flip.
function fakeWindow(reduced) {
  const timers = new Map(); let next = 1; const listeners = new Set();
  const query = { matches: reduced, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  return {
    query, listeners, timers,
    setInterval: (fn) => { timers.set(next, fn); return next++; },
    clearInterval: (id) => timers.delete(id),
    matchMedia: () => query,
    tick: () => timers.forEach((fn) => fn()),
    set(reducedNow) { query.matches = reducedNow; listeners.forEach((fn) => fn()); },
  };
}
const recorder = () => { const seen = { index: 0 }; return { seen, onIndex: (v) => { seen.index = typeof v === 'function' ? v(seen.index) : v; } }; };

test('rotation steps while motion is allowed and cleans up', () => {
  const win = fakeWindow(false); const { seen, onIndex } = recorder();
  const stop = startExampleRotation({ win, onIndex });
  assert.equal(win.timers.size, 1);
  win.tick(); assert.equal(seen.index, 1);
  stop();
  assert.equal(win.timers.size, 0); assert.equal(win.listeners.size, 0);
});

test('reduced motion shows the first example and never rotates', () => {
  const win = fakeWindow(true); const { seen, onIndex } = recorder(); seen.index = 2;
  startExampleRotation({ win, onIndex });
  assert.equal(seen.index, 0); assert.equal(win.timers.size, 0);
});

test('turning reduced motion on while the field is open stops the rotation and resets to the first example', () => {
  const win = fakeWindow(false); const { seen, onIndex } = recorder();
  startExampleRotation({ win, onIndex });
  win.tick(); win.tick(); assert.equal(seen.index, 2);
  win.set(true);
  assert.equal(win.timers.size, 0); assert.equal(seen.index, 0);
  win.set(false);
  assert.equal(win.timers.size, 1);
  win.tick(); assert.equal(seen.index, 1);
});

test('without a window the rotation does nothing', () => {
  const { onIndex } = recorder();
  assert.doesNotThrow(() => startExampleRotation({ win: null, onIndex })());
});
