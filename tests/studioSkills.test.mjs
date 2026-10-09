import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILLS, SKILL_GROUPS, MAX_INSTRUCTIONS, MAX_DRAFTS, MAX_DRAFT_PROMPT, skillById, catalogLines, skillInstructions, parseStudioDrafts,
} from '../app/veyrnox/_lib/studioSkills.js';

const M = (over = {}) => ({ id: 'flux-2-pro', name: 'Flux 2 Pro', kind: 'image', credits: 4, gated: false, aspects: ['1:1', '16:9'], media: {}, ...over });
const CATALOG = [
  M(),
  M({ id: 'kling-3.0-i2v', name: 'Kling 3.0', kind: 'video', credits: 34, aspects: null, media: { image: { required: true } } }),
  M({ id: 'mmaudio-v2-video', name: 'MMAudio v2', kind: 'audio', credits: 1, aspects: null, media: { video: { required: true } } }),
  M({ id: 'gated-model', name: 'Gated', gated: true }),
  M({ id: 'clip-editor', name: 'Clip Editor', isEdit: true }),
  M({ id: 'auto-short', name: 'Auto Short', takesTopic: true }),
];
const fence = (obj) => '```studio\n' + (typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n```';

test('skills: unique ids, a known group, a 1-Credit chat model, and a starter and blurb each', () => {
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, SKILLS.length);
  for (const s of SKILLS) {
    assert.ok(SKILL_GROUPS.includes(s.group), s.id);
    assert.equal(s.model, 'chat-gpt-6-luna', `${s.id} uses the cheap model that reads images`);
    assert.ok(s.blurb && s.starter && s.body, s.id);
    assert.equal(skillById(s.id), s);
  }
  assert.equal(skillById('nope'), null);
});

test('skills: no skill text states a Credit price, because the model list and the Studio carry the live ones', () => {
  for (const s of SKILLS) assert.doesNotMatch(s.body, /\d+\s*(credits?|cr)\b/i, `${s.id} hard-codes a price`);
});

test('the model list is open models only, cheapest first within a kind, and marks what needs a source file', () => {
  assert.deepEqual(catalogLines(CATALOG), ['flux-2-pro|image|4', 'kling-3.0-i2v|video|34|needs image', 'mmaudio-v2-video|audio|1|needs video']);
  assert.deepEqual(catalogLines([]), []);
  assert.deepEqual(catalogLines(null), []);
});

test('instructions: preamble, skill and live list, and never over the chat limit however large the catalog', () => {
  const small = skillInstructions(SKILLS[0], CATALOG);
  assert.match(small, /Studio assistant/);
  assert.match(small, /Skill: Prompt writer/);
  assert.match(small, /flux-2-pro\|image\|4/);
  assert.doesNotMatch(small, /gated-model|clip-editor|auto-short/);
  const huge = Array.from({ length: 400 }, (_, i) => M({ id: `a-very-long-model-identifier-number-${i}`, credits: i }));
  for (const s of SKILLS) {
    const text = skillInstructions(s, huge);
    assert.ok(text.length <= MAX_INSTRUCTIONS, `${s.id}: ${text.length}`);
    assert.ok(text.endsWith('|image|0') || /\|image\|\d+$/.test(text), `${s.id}: whole lines only`);
  }
  const realistic = Array.from({ length: 33 }, (_, i) => M({ id: `model-with-id-${i}-xyz`, kind: ['image', 'video', 'audio'][i % 3], credits: 3 + i }));
  for (const s of SKILLS) {
    const text = skillInstructions(s, realistic);
    assert.equal(text.split('\n').filter((l) => /^\S+\|(image|video|audio)\|\d+/.test(l)).length, 33, `${s.id}: all 33 models fit`);
  }
});

test('drafts: a valid block becomes a draft priced from the catalog, never from the text', () => {
  const [d] = parseStudioDrafts(`Here you go.\n${fence({ model: 'flux-2-pro', prompt: '  a lighthouse at dusk  ', aspect: '16:9', credits: 0 })}`, CATALOG);
  assert.deepEqual(d, { model: 'flux-2-pro', name: 'Flux 2 Pro', kind: 'image', credits: 4, prompt: 'a lighthouse at dusk', aspect: '16:9', needs: [] });
  const [v] = parseStudioDrafts(fence({ model: 'kling-3.0-i2v', prompt: 'slow push in' }), CATALOG);
  assert.deepEqual(v.needs, ['image']);
  assert.equal(v.credits, 34);
});

test('drafts: an unknown, gated or editor-only model, a bad block or an empty prompt offers nothing', () => {
  const bad = [
    fence({ model: 'made-up', prompt: 'x' }), fence({ model: 'gated-model', prompt: 'x' }), fence({ model: 'clip-editor', prompt: 'x' }),
    fence({ model: 'auto-short', prompt: 'x' }), fence({ model: 'flux-2-pro', prompt: '' }), fence({ model: 'flux-2-pro', prompt: '   ' }),
    fence({ model: 'flux-2-pro' }), fence({ prompt: 'x' }), fence({ model: 5, prompt: 'x' }), fence({ model: 'flux-2-pro', prompt: 5 }),
    fence('not json'), fence('[1,2]'), fence('null'), '```json\n{"model":"flux-2-pro","prompt":"x"}\n```', 'no fence at all',
  ];
  for (const text of bad) assert.deepEqual(parseStudioDrafts(text, CATALOG), [], text.slice(0, 50));
  assert.deepEqual(parseStudioDrafts(fence({ model: 'flux-2-pro', prompt: 'x' }), []), []);
  assert.deepEqual(parseStudioDrafts(undefined, CATALOG), []);
});

test('drafts: an aspect is kept only when the model takes it; a long prompt is cut; extra fields are ignored', () => {
  assert.equal(parseStudioDrafts(fence({ model: 'flux-2-pro', prompt: 'x', aspect: '9:16' }), CATALOG)[0].aspect, null, 'not an aspect this model takes');
  assert.equal(parseStudioDrafts(fence({ model: 'kling-3.0-i2v', prompt: 'x', aspect: '16:9' }), CATALOG)[0].aspect, null, 'a model with no aspects takes none');
  assert.equal(parseStudioDrafts(fence({ model: 'flux-2-pro', prompt: 'x', aspect: 16 }), CATALOG)[0].aspect, null);
  const long = parseStudioDrafts(fence({ model: 'flux-2-pro', prompt: 'y'.repeat(5000) }), CATALOG)[0];
  assert.equal(long.prompt.length, MAX_DRAFT_PROMPT);
  const extra = parseStudioDrafts(fence({ model: 'flux-2-pro', prompt: 'x', url: 'https://evil.example', credits: 0, js: 'alert(1)' }), CATALOG)[0];
  assert.deepEqual(Object.keys(extra).sort(), ['aspect', 'credits', 'kind', 'model', 'name', 'needs', 'prompt']);
});

test('drafts: several blocks make several drafts in order, skipping the bad ones, capped at six', () => {
  const text = [fence({ model: 'flux-2-pro', prompt: 'one' }), 'between', fence('oops'), fence({ model: 'kling-3.0-i2v', prompt: 'two' })].join('\n');
  assert.deepEqual(parseStudioDrafts(text, CATALOG).map((d) => d.prompt), ['one', 'two']);
  const many = Array.from({ length: 10 }, (_, i) => fence({ model: 'flux-2-pro', prompt: `shot ${i}` })).join('\n');
  assert.equal(parseStudioDrafts(many, CATALOG).length, MAX_DRAFTS);
});
