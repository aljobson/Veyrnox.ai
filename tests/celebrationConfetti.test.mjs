import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/veyrnox/veyrnox.css', import.meta.url), 'utf8');
const gen = readFileSync(new URL('../app/veyrnox/_components/GenerationCelebration.js', import.meta.url), 'utf8');
const wins = readFileSync(new URL('../app/veyrnox/_components/YourWinsCelebration.jsx', import.meta.url), 'utf8');

test('a generation success and a win both show confetti and play the chime', () => {
  assert.match(gen, /<ConfettiBurst/);
  assert.match(gen, /playCelebrationSound\(\)/);
  assert.match(wins, /<ConfettiBurst \/>/);
  assert.match(gen, /<VeyCharacter pose="cheer"/, 'the mascot cheers on a success');
  assert.match(wins, /playCelebrationSound\(\)/);
});

test('confetti never takes taps, never changes the layout and is skipped for reduced motion', () => {
  assert.match(css, /\.vx-confetti \{ pointer-events: none; position: fixed; inset: 0;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^}]*\.vx-celebrate-card[^}]*\}[^}]*\.vx-confetti \{ display: none; \}/s);
});

test('the chime is silent when sound is off and never throws without audio support', async () => {
  const store = new Map([['veyrnox_sound_off', '1']]);
  globalThis.window = {};
  globalThis.localStorage = { getItem: k => store.get(k) ?? null };
  const { playCelebrationSound, soundEnabled } = await import('../app/veyrnox/_lib/celebrationSound.js');
  assert.equal(soundEnabled(), false);
  assert.doesNotThrow(() => playCelebrationSound());
  store.delete('veyrnox_sound_off');
  assert.equal(soundEnabled(), true);
  assert.doesNotThrow(() => playCelebrationSound());
  delete globalThis.window; delete globalThis.localStorage;
});
