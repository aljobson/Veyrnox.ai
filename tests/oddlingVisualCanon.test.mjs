import test from 'node:test';
import assert from 'node:assert/strict';
import { ODDLING_ARCHETYPES, buildCharacterPrompt, oddlingIdentity } from '../app/veyrnox/_lib/character.js';
import { buildOddlingStudioPrompt, randomizeOddlingStyle } from '../app/veyrnox/_lib/oddlingStudio.js';

const preset = (id) => ODDLING_ARCHETYPES.find((item) => item.id === id).picks;
const canon = (picks) => oddlingIdentity(picks).find((part) => part.startsWith('immutable visual canon:')) || '';

test('edited Duchess Needle/Shelf/Office drops inherited body and outfit contradictions in Studio and Create', () => {
  const original = preset('duchess-volume');
  const edited = { ...original, oddling_name: 'QA Clockwork Finch', body_type: 'Very Skinny', hair: 'Shelf Cut', wardrobe_style: 'Office Surrealist' };
  for (const prompt of [buildCharacterPrompt('cobalt studio', edited), buildOddlingStudioPrompt({ picks: edited, scene: 'cobalt studio' })]) {
    assert.match(prompt, /very slender adult build/);
    assert.match(prompt, /horizontal shelf haircut/);
    assert.match(prompt, /surreal corporate tailoring/);
    assert.doesNotMatch(prompt, /large soft body|circular ivory quilted couture/);
    assert.match(prompt, /miniature silver handbag, tiny crown, pearl details/);
    assert.match(prompt, /fictional creator named QA Clockwork Finch/);
    assert.ok(prompt.includes(original.oddling_obsession));
    assert.match(prompt, /cobalt studio/);
  }
  assert.equal(original.body_type, 'Fat');
  assert.match(original.oddling_rule, /large soft body/);
});

test('unchanged preset and a renamed identity retain their complete visual canon', () => {
  for (const original of ODDLING_ARCHETYPES.map((item) => item.picks)) {
    assert.equal(canon(original), `immutable visual canon: ${original.oddling_rule.slice(0, 160)}`);
    assert.equal(canon({ ...original, oddling_name: 'A new stage name' }), canon(original));
  }
});

test('only changed visual categories are removed, with whole words protecting unrelated canon', () => {
  const duchess = preset('duchess-volume');
  assert.equal(canon({ ...duchess, body_type: 'Pear' }), 'immutable visual canon: circular ivory quilted couture, miniature silver handbag, tiny crown, pearl details');
  assert.equal(canon({ ...duchess, wardrobe_style: 'Office Surrealist' }), 'immutable visual canon: large soft body, miniature silver handbag, tiny crown, pearl details');
  const pam = preset('pam-bouffant');
  const bodyEdited = canon({ ...pam, body_type: 'Pear' });
  assert.match(bodyEdited, /hair three times wider than shoulders/);
  assert.match(bodyEdited, /powder-blue cloud suit/);
  const hairEdited = canon({ ...pam, hair: 'Shelf Cut' });
  assert.doesNotMatch(hairEdited, /platinum hair/);
  assert.match(hairEdited, /tiny sunglasses, powder-blue cloud suit, miniature wind meter/);
});

test('styling randomization cannot reinstate replaced canon and leaves identity and body deliberate', () => {
  const picks = { ...preset('duchess-volume'), body_type: 'Very Skinny' };
  const randomized = randomizeOddlingStyle(picks, () => 0);
  assert.equal(randomized.body_type, 'Very Skinny');
  assert.equal(randomized.oddling_name, picks.oddling_name);
  assert.equal(randomized.oddling_obsession, picks.oddling_obsession);
  assert.doesNotMatch(buildCharacterPrompt('', randomized), /large soft body|circular ivory quilted couture/);
});

test('mixed body/hair clauses and compound wardrobe words cannot retain obsolete preset traits', () => {
  const bloom = { ...preset('bloom-service'), body_type: 'Hyper-Muscular' };
  assert.doesNotMatch(canon(bloom), /tiny compact human/);
  assert.match(buildCharacterPrompt('', bloom), /hyper-muscular bodybuilder physique/);
  for (const [id, oldOutfit] of [['taffy-tessa', 'bubble raincoat'], ['disco-anvil', 'ceremonial tracksuit'], ['colonel-crumb', 'gigantic cream sleeves']]) {
    assert.ok(!canon({ ...preset(id), wardrobe_style: 'Office Surrealist' }).includes(oldOutfit), id);
  }
});

test('a custom user-authored canon is retained rather than heuristically rewriting free text', () => {
  const picks = { ...preset('duchess-volume'), body_type: 'Very Skinny', oddling_rule: 'pearl body jewellery, hair-shaped handbag, ceremonial family pin' };
  assert.equal(canon(picks), `immutable visual canon: ${picks.oddling_rule}`);
});
