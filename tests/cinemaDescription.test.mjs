import test from 'node:test';
import assert from 'node:assert/strict';
import { cinemaDescription } from '../app/veyrnox/_lib/cinemaDescription.js';

test('viewer descriptions keep only the opening plain-language sentence', () => {
  const synopsis = 'A quiet AI visual study of a man enjoying coffee. Created by VulcanSphere with Google Veo 3. Source: https://example.com/video';
  assert.equal(cinemaDescription(synopsis), 'A quiet AI visual study of a man enjoying coffee.');
});

test('viewer descriptions normalize whitespace and leave concise copy intact', () => {
  assert.equal(cinemaDescription('  A painter works\n beside the sea  '), 'A painter works beside the sea');
  assert.equal(cinemaDescription(null), '');
});

test('viewer descriptions shorten an unpunctuated opening without cutting a word', () => {
  assert.equal(cinemaDescription('A surprisingly detailed description without a sentence ending', 28), 'A surprisingly detailed…');
});
