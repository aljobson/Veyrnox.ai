import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_VEY_CHARACTER, VEY_CHARACTER_IDS, VEY_CHARACTER_STORAGE, WOBNIMO_CHARACTERS,
  isWobnimoCharacter, normaliseVeyCharacter, readVeyCharacter, wobnimoStateForMood, writeVeyCharacter,
} from '../lib/veyCharacterChoice.js';

const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('Vey is the default and the cast is Vey plus the twenty wobnimo mascots', () => {
  assert.equal(DEFAULT_VEY_CHARACTER, 'vey');
  assert.equal(WOBNIMO_CHARACTERS.length, 20);
  assert.equal(VEY_CHARACTER_IDS.length, 21);
  assert.equal(new Set(VEY_CHARACTER_IDS).size, 21);
  assert.equal(isWobnimoCharacter('vey'), false);
  assert.equal(isWobnimoCharacter('mochi'), true);
});

test('an unknown or hostile stored value falls back to Vey', () => {
  const storage = memory();
  assert.equal(readVeyCharacter(storage), 'vey');
  storage.setItem(VEY_CHARACTER_STORAGE, '{"version":1,"id":"<script>"}');
  assert.equal(readVeyCharacter(storage), 'vey');
  storage.setItem(VEY_CHARACTER_STORAGE, 'not json');
  assert.equal(readVeyCharacter(storage), 'vey');
  assert.equal(normaliseVeyCharacter(undefined), 'vey');
});

test('a chosen character survives a reload', () => {
  const storage = memory();
  for (const id of VEY_CHARACTER_IDS) {
    assert.equal(writeVeyCharacter(storage, id), true);
    assert.equal(readVeyCharacter(storage), id);
  }
});

test('Vey moods map onto wobnimo states', () => {
  assert.equal(wobnimoStateForMood('thinking'), 'thinking');
  assert.equal(wobnimoStateForMood('cheer'), 'celebrating');
  assert.equal(wobnimoStateForMood('worried'), 'sad');
  assert.equal(wobnimoStateForMood('guiding'), 'idle');
  assert.equal(wobnimoStateForMood(undefined), 'idle');
});

// The phone keeps its own copy (it cannot import from outside the app); these must not drift.
test('the mobile copy lists the same mascots and maps the same moods', () => {
  const mobile = readFileSync(new URL('../apps/mobile/src/lib/veyCharacterChoice.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../lib/veyCharacterChoice.js', import.meta.url), 'utf8');
  const ids = (src) => [...src.match(/WOBNIMO_CHARACTERS = [^\]]*\]/s)[0].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual(ids(mobile), ids(web));
  const moods = (src) => Object.fromEntries([...src.match(/MOOD_TO_STATE[^{]*\{([^}]*)\}/s)[1].matchAll(/(\w+):\s*'(\w+)'/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(moods(mobile), moods(web));
});
