import test from 'node:test';
import assert from 'node:assert/strict';
import { ODDLING_ARCHETYPES, sanitizeOddlingPicks } from '../app/veyrnox/_lib/character.js';
import { ODDLING_FEATURE_CHARACTERS, ODDLING_FEATURE_SOURCES } from '../app/veyrnox/_lib/oddlingFeatureCharacters.js';
import { buildOddlingAnimationPrompt, oddlingsForSource } from '../app/veyrnox/_lib/oddlingStudio.js';

const sizes = ['Small', 'Medium', 'Large', 'Extra Large'];

test('retired size-comparison collections remain valid source history but stay outside the public cast', () => {
  assert.equal(ODDLING_FEATURE_CHARACTERS.length, 40);
  assert.equal(new Set(ODDLING_FEATURE_CHARACTERS.map(({ id }) => id)).size, 40);
  const publicIds = new Set(ODDLING_ARCHETYPES.map(({ id }) => id));
  const expected = ['head', 'neck', 'arm', 'leg', 'hand', 'foot', 'eye', 'mouth', 'ear', 'nose'];
  assert.deepEqual(ODDLING_FEATURE_SOURCES.map(({ id }) => id), expected.map((id) => id + '-sizes'));
  for (const [index, source] of ODDLING_FEATURE_SOURCES.entries()) {
    const characters = source.ids.map((id) => ODDLING_FEATURE_CHARACTERS.find((character) => character.id === id));
    const key = expected[index] + '_size';
    assert.deepEqual(characters.map(({ picks }) => picks[key]), sizes);
    assert.deepEqual(characters.map(({ id }) => id), source.ids);
    for (const character of characters) {
      assert.equal(publicIds.has(character.id), false);
      assert.deepEqual(sanitizeOddlingPicks(character.picks), character.picks);
      const selectedSizes = Object.keys(character.picks).filter((id) => id.endsWith('_size'));
      assert.deepEqual(selectedSizes, [key]);
      assert.equal(buildOddlingAnimationPrompt(character.id), '');
    }
    assert.deepEqual(oddlingsForSource(source.id).map(({ id }) => id), [...publicIds]);
  }
});
