import test from 'node:test';
import assert from 'node:assert/strict';
import { ODDLING_ARCHETYPES, CHARACTER_GROUPS, sanitizeOddlingPicks } from '../app/veyrnox/_lib/character.js';
import { ODDLING_FEATURE_CHARACTERS, ODDLING_FEATURE_SOURCES } from '../app/veyrnox/_lib/oddlingFeatureCharacters.js';
import { buildOddlingStudioPrompt, buildOddlingAnimationPrompt, oddlingsForSource, saveOddlingToLibrary, readOddlingLibrary } from '../app/veyrnox/_lib/oddlingStudio.js';

const sizes = ['Small', 'Medium', 'Large', 'Extra Large'];

test('ten new collections cover every non-torso size control with four distinct original characters', () => {
  assert.equal(ODDLING_FEATURE_CHARACTERS.length, 40);
  assert.equal(new Set(ODDLING_FEATURE_CHARACTERS.map(({ id }) => id)).size, 40);
  const expected = ['head', 'neck', 'arm', 'leg', 'hand', 'foot', 'eye', 'mouth', 'ear', 'nose'];
  assert.deepEqual(ODDLING_FEATURE_SOURCES.map(({ id }) => id), expected.map((id) => id + '-sizes'));
  for (const [index, source] of ODDLING_FEATURE_SOURCES.entries()) {
    const characters = oddlingsForSource(source.id);
    const key = expected[index] + '_size';
    assert.deepEqual(characters.map(({ picks }) => picks[key]), sizes);
    assert.deepEqual(characters.map(({ id }) => id), source.ids);
    for (const character of characters) {
      assert.equal(ODDLING_ARCHETYPES.find(({ id }) => id === character.id), character);
      assert.deepEqual(sanitizeOddlingPicks(character.picks), character.picks);
      const selectedSizes = Object.keys(character.picks).filter((id) => id.endsWith('_size'));
      assert.deepEqual(selectedSizes, [key]);
      const phrase = CHARACTER_GROUPS.find(({ id }) => id === key).options.find(([value]) => value === character.picks[key])[1];
      for (const mode of ['portrait', 'motion']) {
        const prompt = buildOddlingStudioPrompt({ mode, picks: character.picks });
        assert.ok(prompt.includes(phrase), character.id + ' ' + mode);
        assert.ok(prompt.includes(character.name));
      }
      assert.ok(buildOddlingAnimationPrompt(character.id).includes(character.name));
      const data = new Map();
      const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
      assert.equal(saveOddlingToLibrary(storage, character.picks, '', 1000).ok, true);
      assert.deepEqual(readOddlingLibrary(storage)[0].picks, character.picks);
    }
  }
});
