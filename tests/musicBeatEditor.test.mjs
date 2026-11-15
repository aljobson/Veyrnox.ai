import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('BeatEditor JSX key expressions are unique, including across different element types', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatEditor.jsx', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bkey=\{((?:`[^`]*`)|[^}]+)\}/g)].map((match) => match[1].trim());
  assert.ok(keys.length >= 2);
  assert.equal(new Set(keys).size, keys.length, `Duplicate JSX keys: ${keys.join(', ')}`);
});
