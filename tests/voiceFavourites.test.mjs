import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVoiceFavourites, toggleVoiceFavourite } from '../app/veyrnox/_lib/voiceFavourites.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('voice favourites persist a unique shortlist of known stock voices', () => {
  const local = storage();
  assert.deepEqual(toggleVoiceFavourite(local, 'Calm_Woman'), ['Calm_Woman']);
  assert.deepEqual(toggleVoiceFavourite(local, 'Wise_Woman'), ['Wise_Woman', 'Calm_Woman']);
  assert.deepEqual(toggleVoiceFavourite(local, 'Calm_Woman'), ['Wise_Woman']);
  assert.deepEqual(toggleVoiceFavourite(local, 'cloned-user-voice'), ['Wise_Woman']);
  assert.deepEqual(readVoiceFavourites(local), ['Wise_Woman']);
});

test('voice favourites fail closed when browser storage is malformed or blocked', () => {
  assert.deepEqual(readVoiceFavourites({ getItem: () => '{bad' }), []);
  const blocked = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(toggleVoiceFavourite(blocked, 'Calm_Woman'), []);
});

test('the voice library exposes a persistent accessible favourite control and filter', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/TextToSpeechControls.js', import.meta.url), 'utf8');
  assert.match(source, /readVoiceFavourites\(window\.localStorage\)/);
  assert.match(source, /toggleVoiceFavourite\(window\.localStorage, voiceId\)/);
  assert.match(source, /★ Favourites/);
  assert.match(source, /Add \$\{voice\.label\} to favourite voices/);
  assert.match(source, /No voice sample, script, or cloned identity is stored/);
});
