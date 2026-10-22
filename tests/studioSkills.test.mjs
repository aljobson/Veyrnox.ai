import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILLS, SKILL_GROUPS, MAX_INSTRUCTIONS, MAX_INSTRUCTION_TOKENS, MAX_DRAFTS, MAX_DRAFT_PROMPT, MAX_SKILL_IDEA, MAX_SELECTED_SKILLS, estimateInstructionTokens, fittingSkills, fittingSkillsWithRequired, skillById, skillIdsFromSearch, skillOverview, skillLaunchFromSearch, personalSkillLaunchFromSearch, catalogLines, skillInstructions, skillsInstructions, parseStudioDrafts,
} from '../app/veyrnox/_lib/studioSkills.js';
import { STUDIO_SKILL_ICONS, studioSkillIcon } from '../app/veyrnox/_lib/studioSkillIcons.js';
import { STUDIO_WORKFLOWS, workflowById, workflowStartHref, workflowSteps } from '../app/veyrnox/_lib/studioWorkflows.js';
import { CHARACTER_GROUPS, ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import { oddlingCanonInstructions } from '../app/veyrnox/_lib/oddlingChatHandoff.js';

test('skill launches accept one known skill and one bounded idea', () => {
  const launch = skillLaunchFromSearch('?skill=prompt-writer&prompt=%20A+quiet+train+film%20');
  assert.deepEqual(launch, { skillId: 'prompt-writer', idea: 'A quiet train film' });
  assert.deepEqual(skillLaunchFromSearch('?skill=not-real&prompt=ignore+me'), { skillId: '', idea: '' });
  assert.equal(skillLaunchFromSearch(`?skill=prompt-writer&prompt=${'x'.repeat(MAX_SKILL_IDEA + 20)}`).idea.length, MAX_SKILL_IDEA);
});

test('multi-skill launches keep known unique skills in order and stay bounded', () => {
  assert.deepEqual(skillIdsFromSearch('?skill=prompt-writer&skill=storyboard&skill=prompt-writer'), ['prompt-writer', 'storyboard']);
  assert.deepEqual(skillIdsFromSearch('?skill=prompt-writer,add-sound,not-real'), ['prompt-writer', 'add-sound']);
  assert.equal(skillIdsFromSearch(`?${SKILLS.map((skill) => `skill=${skill.id}`).join('&')}`).length, MAX_SELECTED_SKILLS);
});

test('personal skill links open only the supported manager views', () => {
  assert.equal(personalSkillLaunchFromSearch('?personas=manage'), 'manage');
  assert.equal(personalSkillLaunchFromSearch('?personas=new'), 'new');
  assert.equal(personalSkillLaunchFromSearch('?personas=delete'), '');
  assert.equal(personalSkillLaunchFromSearch(''), '');
});

test('skill overviews describe the real start, review step and output', () => {
  const edit = skillOverview(skillById('edit-with-words'));
  assert.match(edit.introduction, /photo/i);
  assert.match(edit.howTo[0], /Attach/);
  assert.match(edit.howTo.at(-1), /Studio/);
  assert.match(edit.output, /source file/i);
  const film = skillOverview(skillById('film-shot-prompt'));
  assert.match(film.bestFor, /Film Studio/);
  assert.match(film.output, /stage-specific/);
  assert.equal(skillOverview(null), null);
});

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

test('Bring it to life works with either an attached image or an Oddling passport', () => {
  const body = skillById('bring-to-life').body;
  assert.match(body, /attached image/i);
  assert.match(body, /locked passport/i);
  assert.match(body, /ask for a source/i);
});

test('every Studio skill has one distinctive icon and no orphan icon remains', () => {
  assert.deepEqual(Object.keys(STUDIO_SKILL_ICONS).sort(), SKILLS.map((skill) => skill.id).sort());
  assert.equal(new Set(Object.values(STUDIO_SKILL_ICONS).map((icon) => icon.path)).size, SKILLS.length);
  for (const skill of SKILLS) {
    const icon = studioSkillIcon(skill.id);
    assert.match(icon.color, /^#[0-9a-f]{6}$/i, skill.id);
    assert.ok(icon.path.length > 12, skill.id);
  }
  assert.equal(studioSkillIcon('not-a-skill'), null);
});

test('guided workflows use only real skills and lead to a working first step', () => {
  assert.equal(new Set(STUDIO_WORKFLOWS.map((workflow) => workflow.id)).size, STUDIO_WORKFLOWS.length);
  for (const workflow of STUDIO_WORKFLOWS) {
    assert.ok(workflow.name && workflow.blurb && workflow.outcome && workflow.path, workflow.id);
    assert.ok(workflow.steps.length >= 3, `${workflow.id} has a useful sequence`);
    assert.equal(workflowSteps(workflow).length, workflow.steps.length, `${workflow.id} has no missing skills`);
    assert.match(workflowStartHref(workflow), /^\/app\/(chat\?skill=|film-studio|oddlings)/, workflow.id);
    if (!workflow.href) assert.equal(new URL(`https://veyrnox.test${workflowStartHref(workflow)}`).searchParams.getAll('skill').length, Math.min(MAX_SELECTED_SKILLS, workflow.steps.length));
    assert.equal(workflowById(workflow.id), workflow);
  }
  assert.equal(workflowStartHref(workflowById('oddling-series')), '/app/oddlings', 'the public workflow starts where a passport can be selected');
  assert.equal(workflowById('not-a-workflow'), null);
  assert.equal(workflowStartHref(null), '/app/skills');
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

test('multiple skills share one preamble and one model list while keeping every selected specialist complete', () => {
  const selected = [skillById('prompt-writer'), skillById('storyboard'), skillById('bring-to-life'), skillById('add-sound')];
  const text = skillsInstructions(selected, CATALOG);
  assert.equal(text.match(/You are Veyrnox\.ai's Studio assistant/g)?.length, 1);
  assert.equal(text.match(/Models \(id\|kind\|Credits per generation\):/g)?.length, 1);
  for (const skill of selected) assert.ok(text.includes(skill.body), skill.id);
  assert.ok(text.length <= MAX_INSTRUCTIONS);
  assert.equal(skillsInstructions([], CATALOG), '');
});

test('Oddling continuity composes locked canon without exceeding the Chat instruction limit', () => {
  const selected = ['oddling-continuity', 'storyboard', 'prompt-writer', 'bring-to-life'].map(skillById);
  const picks = Object.fromEntries(CHARACTER_GROUPS.map((group) => [group.id, group.options.at(-1)[0]]));
  Object.assign(picks, {
    oddling_name: 'N'.repeat(40), oddling_obsession: 'P'.repeat(140), oddling_rule: 'C'.repeat(160),
    oddling_voice: ODDLING_ARCHETYPES[0].picks.oddling_voice, oddling_show: ODDLING_ARCHETYPES[0].picks.oddling_show,
  });
  const context = oddlingCanonInstructions({ version: 2, savedAt: 1, ownerId: 'user-a', picks, mode: 'motion', scene: 'S'.repeat(300), referenceNote: 'R'.repeat(180) });
  const text = skillsInstructions(selected, CATALOG, context);
  for (const skill of selected) assert.ok(text.includes(skill.body), skill.id);
  assert.ok(text.includes(context));
  assert.match(text, /flux-2-pro\|image\|4/, 'the maximum passport still leaves a live model choice');
  assert.match(text, /kling-3\.0-i2v\|video\|34/, 'a motion model is reserved before extra image rows');
  assert.ok(text.length <= MAX_INSTRUCTIONS);
});

test('maximum multilingual canon is preserved and blocks instead of silently dropping scene or reference', () => {
  const selected = ['oddling-continuity', 'storyboard', 'prompt-writer', 'bring-to-life'].map(skillById);
  const picks = Object.fromEntries(CHARACTER_GROUPS.map((group) => [group.id, group.options.at(-1)[0]]));
  Object.assign(picks, {
    oddling_name: '界'.repeat(40), oddling_obsession: '界'.repeat(140), oddling_rule: '界'.repeat(160),
    oddling_voice: ODDLING_ARCHETYPES[0].picks.oddling_voice, oddling_show: ODDLING_ARCHETYPES[0].picks.oddling_show,
  });
  const context = oddlingCanonInstructions({ version: 2, savedAt: 1, ownerId: 'user-a', picks, mode: 'motion', motionId: 'micro-dance', scene: '界'.repeat(300), referenceNote: '界'.repeat(180) });
  const text = skillsInstructions(selected, CATALOG, context);
  assert.match(context, new RegExp(`Scene:${'界'.repeat(300)}`));
  assert.match(context, new RegExp(`Reference:${'界'.repeat(180)}`));
  assert.equal(text, '', 'a prompt that cannot retain the complete context is not saved or sent');
  assert.deepEqual(fittingSkills(selected, CATALOG, context), []);
});

test('a locked Oddling launch never keeps optional skills after continuity exceeds the budget', () => {
  const selected = ['oddling-continuity', 'bring-to-life', 'prompt-writer'].map(skillById);
  let boundary = '';
  for (let length = 1; length <= 2200; length += 1) {
    const context = '界'.repeat(length);
    const loose = fittingSkills(selected, CATALOG, context);
    if (loose.length && !loose.some((skill) => skill.id === 'oddling-continuity')) {
      boundary = context;
      break;
    }
  }
  assert.ok(boundary, 'the regression fixture reaches the mixed-fit token boundary');
  assert.deepEqual(fittingSkillsWithRequired(selected, CATALOG, boundary, 'oddling-continuity'), []);
});

test('multilingual canon that fits retains scene and reference in the saved prompt', () => {
  const picks = { ...ODDLING_ARCHETYPES[0].picks, oddling_name: '星の子', oddling_obsession: '夜の市場', oddling_rule: '青い帽子を変えない' };
  const context = oddlingCanonInstructions({ version: 2, savedAt: 1, ownerId: 'user-a', picks, mode: 'motion', motionId: 'micro-dance', scene: '月明かりの駅で踊る', referenceNote: '青と金の配色を守る' });
  const text = skillsInstructions([skillById('oddling-continuity')], CATALOG, context);
  assert.match(text, /Scene:月明かりの駅で踊る/);
  assert.match(text, /Reference:青と金の配色を守る/);
  assert.ok(estimateInstructionTokens(text) <= MAX_INSTRUCTION_TOKENS);
});

test('every allowed four-skill combination is whole, bounded, and reserves each available media kind', () => {
  const manyImages = Array.from({ length: 30 }, (_, index) => M({ id: `image-${index}`, credits: index + 1 }));
  const models = [...manyImages, ...CATALOG.filter((model) => ['video', 'audio'].includes(model.kind))];
  const context = 'x'.repeat(1850);
  for (let a = 0; a < SKILLS.length; a += 1) for (let b = a + 1; b < SKILLS.length; b += 1) {
    for (let c = b + 1; c < SKILLS.length; c += 1) for (let d = c + 1; d < SKILLS.length; d += 1) {
      const requested = [SKILLS[a], SKILLS[b], SKILLS[c], SKILLS[d]];
      const fitted = fittingSkills(requested, models, context);
      const text = skillsInstructions(requested, models, context);
      assert.ok(text.length <= MAX_INSTRUCTIONS, requested.map((skill) => skill.id).join(','));
      assert.ok(estimateInstructionTokens(text) <= MAX_INSTRUCTION_TOKENS, requested.map((skill) => skill.id).join(','));
      for (const skill of fitted) assert.ok(text.includes(skill.body), skill.id);
      for (const kind of ['image', 'video', 'audio']) assert.match(text, new RegExp(`\\|${kind}\\|`), `${kind}: ${requested.map((skill) => skill.id).join(',')}`);
    }
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

test('drafts: an aspect is kept only when Create offers it; a long prompt is cut; extra fields are ignored', () => {
  assert.equal(parseStudioDrafts(fence({ model: 'flux-2-pro', prompt: 'x', aspect: '9:16' }), CATALOG)[0].aspect, null, 'not an aspect this model takes');
  assert.equal(parseStudioDrafts(fence({ model: 'kling-3.0-i2v', prompt: 'x', aspect: '9:16' }), CATALOG)[0].aspect, null, 'a live model with no aspect input cannot promise one');
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
