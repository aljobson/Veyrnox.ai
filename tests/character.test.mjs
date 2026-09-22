import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterPrompt, characterTraits, CHARACTER_BASE, CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';

test('the portrait always asks for an original adult, then the traits, then the user text', () => {
    const out = buildCharacterPrompt(' waving at the camera ', { gender: 'Female', rendering_style: 'Anime', horns: 'Antlers' });
    assert.ok(out.startsWith(CHARACTER_BASE));
    assert.match(CHARACTER_BASE, /original adult character, not a real person/);
    assert.ok(out.endsWith(', female, deer antlers on head, anime art style, waving at the camera'));
});

test('origin options use neutral heritage wording, not upstream\'s supermodel phrasing', () => {
    const origin = CHARACTER_GROUPS.find((g) => g.id === 'ethnicity_origin_base');
    for (const [, phrase] of origin.options) assert.doesNotMatch(phrase, /supermodel|idol|phenotype/i, phrase);
});

test('unknown picks add nothing, and the result fits the gateway limit', () => {
    assert.deepEqual(characterTraits({ gender: '<script>', nope: 'x' }), []);
    assert.equal(buildCharacterPrompt('', {}), CHARACTER_BASE);
    assert.equal(buildCharacterPrompt('x'.repeat(5000), { gender: 'Male' }).length, 2000);
});
