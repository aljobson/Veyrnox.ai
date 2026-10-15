import test from 'node:test';
import assert from 'node:assert/strict';
import { characterOptionLabel, changeCharacterPick, CHARACTER_SIZE_GROUPS } from '../app/veyrnox/_lib/characterOptions.js';
import { buildCharacterPrompt, readOddlingDraft, writeOddlingDraft, sanitizeOddlingPicks, CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { randomizeOddlingStyle, saveOddlingToLibrary, readOddlingLibrary } from '../app/veyrnox/_lib/oddlingStudio.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('saved characters retain their legacy choices while all trait views use neutral labels', () => {
  const picks = { character_type: 'Human', body_type: 'Fat', left_arm: 'Normal', eye_color: 'Blind / Empty', ethnicity_origin_base: 'Asian' };
  const saved = storage();
  assert.equal(writeOddlingDraft(saved, picks, 123), true);
  assert.deepEqual(readOddlingDraft(saved).picks, picks);
  assert.equal(characterOptionLabel('body_type', picks.body_type), 'Full-bodied');
  assert.equal(characterOptionLabel('left_arm', picks.left_arm), 'Biological');
  assert.equal(characterOptionLabel('eye_color', picks.eye_color), 'Pupil-free white');
  assert.equal(characterOptionLabel('ethnicity_origin_base', picks.ethnicity_origin_base), 'East Asian');
  assert.equal(characterOptionLabel('body_type', 'Very Skinny'), 'Very slender');
  assert.doesNotMatch(buildCharacterPrompt('', picks), /\b(fat|normal|blind|empty)\b/i);
  for (const group of CHARACTER_GROUPS) for (const [value] of group.options) {
    assert.doesNotMatch(characterOptionLabel(group.id, value), /^(Fat|Skinny|Very Skinny|Normal|Blind \/ Empty)$/);
  }
});

test('all size choices reach prompts, survive saving, and stay deliberate during styling remixes', () => {
  for (const group of CHARACTER_SIZE_GROUPS) for (const [size, phrase] of group.options) {
    const picks = { character_type: 'Human', body_type: 'Slim', hand_size: 'Small', foot_size: 'Extra Large', ear_size: 'Extra Large', nose_size: 'Small', eye_size: 'Small', mouth_size: 'Extra Large', [group.id]: size };
    assert.deepEqual(sanitizeOddlingPicks(picks), picks);
    assert.ok(buildCharacterPrompt('Full-body portrait', picks).includes(phrase));
    assert.ok(buildCharacterPrompt('', picks).includes('both feet fully visible'));
    const saved = storage();
    assert.equal(saveOddlingToLibrary(saved, picks, '', 123).ok, true);
    assert.deepEqual(readOddlingLibrary(saved)[0].picks, picks);
    assert.equal(writeOddlingDraft(saved, picks, 123), true);
    assert.deepEqual(readOddlingDraft(saved).picks, picks);
    const remixed = randomizeOddlingStyle(picks, () => 0.5);
    assert.equal(remixed.foot_size, picks.foot_size);
    assert.equal(remixed.hand_size, picks.hand_size);
    assert.equal(remixed.ear_size, picks.ear_size);
    assert.equal(remixed.nose_size, picks.nose_size);
    assert.equal(remixed.eye_size, picks.eye_size);
    assert.equal(remixed.mouth_size, picks.mouth_size);
  }
  assert.deepEqual(sanitizeOddlingPicks({ foot_size: 'gigantic unbounded value', ear_size: 'invalid', nose_size: 'invalid', eye_size: 'invalid', mouth_size: 'invalid' }), {});
});

test('all face size controls offer the same size range as hands and feet', () => {
  for (const id of ['ear_size', 'nose_size', 'eye_size', 'mouth_size', 'hand_size', 'foot_size']) {
    const group = CHARACTER_GROUPS.find((item) => item.id === id);
    assert.deepEqual(group.options.map(([value]) => value), ['Small', 'Medium', 'Large', 'Extra Large']);
    assert.equal(group.tab, ['hand_size', 'foot_size'].includes(id) ? 'Body' : 'Face');
  }
});

test('explicit mouth sizes replace legacy mouth sizes without resetting teeth or other face sizes', () => {
  for (const mouth of ['Small Mouth', 'Large Mouth']) {
    assert.deepEqual(changeCharacterPick({ mouth, eye_size: 'Small' }, 'mouth_size', 'Extra Large'),
      { eye_size: 'Small', mouth_size: 'Extra Large' });
    assert.deepEqual(changeCharacterPick({ mouth_size: 'Extra Large', eye_size: 'Small' }, 'mouth', mouth),
      { mouth, eye_size: 'Small' });
    const saved = storage();
    assert.equal(writeOddlingDraft(saved, { mouth }, 123), true);
    assert.deepEqual(readOddlingDraft(saved).picks, { mouth });
  }
  assert.deepEqual(changeCharacterPick({ mouth: 'Sharp Teeth' }, 'mouth_size', 'Extra Large'),
    { mouth: 'Sharp Teeth', mouth_size: 'Extra Large' });
  assert.deepEqual(changeCharacterPick({ mouth_size: 'Large' }, 'mouth', 'Unique Teeth'),
    { mouth: 'Unique Teeth', mouth_size: 'Large' });
  assert.deepEqual(changeCharacterPick({ mouth: 'Sharp Teeth', mouth_size: 'Large' }, 'mouth_size', ''),
    { mouth: 'Sharp Teeth' });
});

test('eye shape and type remain independent from eye size', () => {
  const picks = changeCharacterPick({ eye_shape: 'Round', eyes_type: 'Mechanical', mouth_size: 'Extra Large' }, 'eye_size', 'Small');
  const prompt = buildCharacterPrompt('', picks);
  assert.match(prompt, /round eye shape/);
  assert.match(prompt, /mechanical cyborg eyes/);
  assert.match(prompt, /small eyes relative to the face/);
  assert.match(prompt, /extra-large mouth relative to the face/);
  assert.doesNotMatch(prompt, /large round eye shape/);
});

test('ear size stays independent of ear type and nose size without contradicting no visible ears', () => {
  assert.deepEqual(changeCharacterPick({ ears: 'Elf Ears', nose_size: 'Small' }, 'ear_size', 'Extra Large'),
    { ears: 'Elf Ears', nose_size: 'Small', ear_size: 'Extra Large' });
  assert.deepEqual(changeCharacterPick({ ears: 'No Ears', nose_size: 'Large' }, 'ear_size', 'Extra Large'),
    { nose_size: 'Large', ear_size: 'Extra Large' });
  assert.deepEqual(changeCharacterPick({ ear_size: 'Large', nose_size: 'Extra Large' }, 'ears', 'No Ears'),
    { ears: 'No Ears', nose_size: 'Extra Large' });
  assert.deepEqual(changeCharacterPick({ ears: 'Wing Ears', ear_size: 'Small' }, 'ear_size', ''),
    { ears: 'Wing Ears' });
});

test('explicit hand sizes cannot conflict with a legacy hand proportion choice', () => {
  assert.deepEqual(changeCharacterPick({ proportions: 'Huge Hands', foot_size: 'Large' }, 'hand_size', 'Small'),
    { foot_size: 'Large', hand_size: 'Small' });
  assert.deepEqual(changeCharacterPick({ hand_size: 'Large', foot_size: 'Small' }, 'proportions', 'Tiny Hands'),
    { foot_size: 'Small', proportions: 'Tiny Hands' });
  assert.deepEqual(changeCharacterPick({ proportions: 'Long Torso' }, 'foot_size', 'Extra Large'),
    { proportions: 'Long Torso', foot_size: 'Extra Large' });
});
