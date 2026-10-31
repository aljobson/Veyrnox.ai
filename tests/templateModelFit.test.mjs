import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PRESETS, templateById } from '../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName, presetCredits, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { fallbackCapabilitiesFor, FALLBACK_MODEL_ENDPOINTS } from '../lib/fallbackModelCapabilities.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { SEEDANCE_200_TEMPLATE_METADATA } from '../app/veyrnox/_lib/seedanceTemplateMetadata.js';
import { fitSeedanceTemplate, templateModelFitRule } from '../scripts/import-seedance-source-templates.mjs';
import * as React from 'react';
import { fixture as renderFixture } from './helpers/publicSiteRender.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/catalogTemplateModels.json', import.meta.url)));
const catalog = fixture.models;
const optionalIds = ['epic-train-doorway-scene', 'the-push', 'dreamworks-castle', 'a-moment-between-strangers', 'the-last-stagecoach'];
const changedIds = [...Object.keys(SEEDANCE_200_TEMPLATE_METADATA), 'city-trailer', 'curtain-reveal'];
const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, sixty: 60 };

function violations(preset, contract) {
  const issues = [];
  const duration = preset.durationSeconds ?? 5;
  if (!contract?.durations.includes(duration)) issues.push('duration');
  // Independent of the importer's classifier: include semantic picture wording.
  if (!/optional|^Copy the exact prompt;/i.test(preset.needs || '')
      && /picture|photo|portrait|image|starting frame|character references?/i.test(preset.needs || '')
      && !contract?.media?.image) issues.push('required-image');
  if (preset.promptOrigin === 'veyrnox-adaptation') {
    const pattern = new RegExp(`\\b(\\d{1,3}(?:\\.\\d+)?|${Object.keys(numberWords).join('|')})[-\\s]*(?:seconds?|secs?|s)\\b`, 'gi');
    for (const [, token] of preset.prompt.matchAll(pattern)) {
      if ((numberWords[token.toLowerCase()] ?? Number(token)) !== duration) issues.push('prompt-duration');
    }
  }
  return issues;
}

test('every public template and API row fits both the offline contract and fallback', () => {
  const fallbackCatalog = MODELS.map(model => ({ ...model, media: fallbackCapabilitiesFor(model.id)?.media || {} }));
  for (const rows of [PRESETS, toPublicPresets(fallbackCatalog)]) {
    for (const preset of rows) {
      const id = preset.modelId || modelIdForName(preset.model);
      const fallback = fallbackCatalog.find(model => model.id === id);
      const captured = catalog.find(model => model.id === id);
      assert.ok(captured, `${preset.id}: no offline model contract for ${id}`);
      assert.deepEqual(violations(preset, captured), [], `${preset.id}: offline contract`);
      assert.deepEqual(violations(preset, fallback), [], `${preset.id}: fallback contract`);
    }
  }
});

test('Seedance fallback uses the Crun contract; both fallback surfaces agree with the fixture', () => {
  assert.equal(FALLBACK_MODEL_ENDPOINTS['seedance-2.0-fast'], 'crun:bytedance/seedance2-0-fast-t2v');
  assert.equal(fallbackCapabilitiesFor('seedance-2.0-fast').inputs.prompt.max, 30000);
  for (const captured of catalog) {
    const model = MODELS.find(model => model.id === captured.id);
    const capability = fallbackCapabilitiesFor(captured.id);
    assert.deepEqual(model.durations, captured.durations);
    assert.deepEqual(capability.lengths, captured.durations);
    for (const media of [model.media || {}, capability.media]) {
      assert.deepEqual(Object.keys(media).sort(), Object.keys(captured.media).sort());
      for (const slot of Object.keys(captured.media)) assert.equal(media[slot].required, captured.media[slot].required);
    }
    assert.equal(model.credits, captured.credits);
  }
});

test('guard rejects the old Seedance duration and required-picture regressions', () => {
  const seedance = catalog.find(model => model.id === 'seedance-2.0-fast');
  assert.deepEqual(violations({ durationSeconds: 10 }, seedance), ['duration']);
  for (const needs of ['A clear portrait', 'A starting image', 'A city starting frame', 'two character references']) {
    assert.deepEqual(violations({ needs }, seedance), ['required-image']);
  }
  for (const length of ['ten-second', '10-second', '10 s', 'ten seconds', '8 seconds']) {
    assert.deepEqual(violations({ promptOrigin: 'veyrnox-adaptation', prompt: `Create a ${length} video.` }, seedance), ['prompt-duration']);
  }
  assert.deepEqual(violations({ needs: 'An optional starting image' }, seedance), []);
  assert.deepEqual(violations({ needs: 'Copy the exact prompt; its required image is not wired' }, seedance), []);
});

test('all 202 affected templates follow R1–R4 and preserve exact source records', () => {
  const counts = { R1: 0, R2: 0, R3: 0, R4: 0 };
  const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/seedance-200-exact-2026-10-29.json', import.meta.url)));
  for (const id of changedIds) {
    const preset = templateById(id);
    const rule = optionalIds.includes(id) ? 'R2' : templateModelFitRule(preset);
    counts[rule]++;
    assert.equal(preset.model, rule === 'R1' ? 'Kling 3.0 · I2V' : 'Seedance 2.0 Fast', id);
    assert.equal(preset.durationSeconds, rule === 'R1' ? 10 : 5, id);
    if (rule !== 'R3') {
      assert.equal(preset.promptOrigin, 'veyrnox-adaptation', id);
      assert.equal(preset.preferAdaptedPrompt, true, id);
      assert.notEqual(preset.prompt, exactSourcePromptRecord(id)?.prompt, id);
      assert.match(presetHref(preset), /^\/app\/create\?model=/);
    }
    if (rule === 'R1') {
      assert.match(preset.prompt, /\b(?:uploaded|supplied)\b/i, id);
      assert.doesNotMatch(preset.prompt, /seedance/i, id);
    }
    const source = audit.records.find(record => record.id === id);
    if (source) {
      assert.equal(exactSourcePromptRecord(id).prompt, source.prompt, `${id}: immutable exact prompt`);
      for (const field of ['sourcePlatform', 'sourceModel', 'sourceUrl']) assert.equal(preset[field], source[field], id);
      assert.equal(SEEDANCE_200_TEMPLATE_METADATA[id].runnableModel, preset.model, id);
    }
  }
  assert.deepEqual(counts, { R1: 71, R2: 5, R3: 44, R4: 82 });
});

test('optional-picture recipes have no upload dependency in prompts, needs or steps', () => {
  for (const id of optionalIds) {
    const preset = templateById(id);
    assert.equal(preset.needs, null, id);
    assert.doesNotMatch([preset.prompt, ...preset.steps].join(' '), /upload|supplied|starting image|reference (?:image|photo)|ten-second|10\s*s\b/i, id);
    assert.match(preset.prompt, /five-second/);
  }
});

test('generated text-only sources remain text-only five-second adaptations', () => {
  const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/seedance-200-exact-2026-10-29.json', import.meta.url)));
  const textOnly = audit.records.filter(record => !record.existing && record.referenceImageCount === 0 && sourcePromptAuditRecord(record.id).runnable);
  assert.equal(textOnly.length, 78);
  for (const record of textOnly) {
    const preset = templateById(record.id);
    assert.equal(preset.model, 'Seedance 2.0 Fast', record.id);
    assert.equal(preset.durationSeconds, 5, record.id);
    assert.equal(preset.needs, null, record.id);
    assert.equal(preset.needsKey, null, record.id);
    assert.equal(preset.promptOrigin, 'veyrnox-adaptation', record.id);
    assert.match(preset.prompt, /^Create a five-second video\./, record.id);
    assert.doesNotMatch([preset.prompt, ...preset.steps].join(' '), /upload|supplied|starting image|reference image/i, record.id);
    assert.equal(exactSourcePromptRecord(record.id).prompt, record.prompt, record.id);
  }
});

test('hand-written recipes whose source used no reference image are text-only five-second adaptations', () => {
  for (const id of ['tentacle-breakout', 'blood-moon-dance', 'red-thread-story', 'meal-together']) {
    const preset = templateById(id);
    assert.equal(preset.model, 'Seedance 2.0 Fast', id);
    assert.equal(preset.durationSeconds, 5, id);
    assert.equal(preset.needs, null, id);
    assert.equal(preset.needsKey, null, id);
    assert.match(preset.prompt, /^Create a five-second /, id);
    assert.doesNotMatch([preset.prompt, ...preset.steps].join(' '), /upload|supplied|starting image|reference (?:image|photo)|ten-second|10\s*s\b/i, id);
  }
});

test('the fashion recipe requests one combined starting image', () => {
  for (const id of ['fashion-catch']) {
    const preset = templateById(id);
    assert.equal(preset.model, 'Kling 3.0 · I2V', id);
    assert.match(preset.needs, /^One starting image showing /, id);
    assert.doesNotMatch([preset.needs, preset.prompt, ...preset.steps].join(' '), /separate.*image|two.*references|uploaded garment/i, id);
  }
  assert.match(templateById('fashion-catch').needs, /model wearing the garment or accessory/);
});

test('web recipe runs its designated adaptation even when the exact prompt is runnable', () => {
  const template = templateById('seedance-higgs-868ea6d0');
  const row = toPublicPresets(catalog, [template])[0];
  assert.equal(row.sourcePromptRunnable, true, 'regression requires an independently runnable exact prompt');
  const preset = { ...template, ...row };
  let handoff;
  const f = renderFixture('en', `/presets/${preset.id}`, { moduleMocks: {
    './UseTemplate': { UseTemplate: props => { handoff = props; return null; } },
  } });
  const html = f.render(React.createElement(f.load('app/veyrnox/_components/TemplateRecipe.js').TemplateRecipe, { preset }));
  assert.ok(html.includes(row.sourcePrompt), 'exact source remains visible byte-for-byte');
  assert.equal(handoff.prompt, template.prompt);
  assert.equal(handoff.preset.prompt, template.prompt);
  assert.equal(handoff.generationBlocked, false);
  assert.match(presetHref(handoff.preset), /model=seedance-2.0-fast/);
  assert.doesNotMatch(presetHref(handoff.preset), /duration=10s/);
});

test('phone parsing and handoff retain adaptations and hide copy-only recipes', () => {
  const moduleMocks = {
    './i18n': { t: key => key }, './api': { API_BASE: 'https://veyrnox.test', ApiError: Error },
  };
  const f = renderFixture('en', '/presets', { moduleMocks });
  moduleMocks['./templateHandoff'] = f.load('apps/mobile/src/lib/templateHandoff.ts');
  const mobile = f.load('apps/mobile/src/lib/presets.ts');
  const rows = mobile.parsePresets({ presets: toPublicPresets(catalog) });
  assert.equal(rows.length, PRESETS.length);
  for (const id of changedIds) {
    const row = rows.find(preset => preset.id === id);
    const template = templateById(id);
    if (template.promptOrigin === 'community-source-exact') {
      assert.equal(mobile.isCopyOnlyPreset(row), true, id);
      continue;
    }
    assert.equal(mobile.isCopyOnlyPreset(row), false, id);
    const handoff = mobile.presetHref(row);
    assert.equal(handoff.pathname, '/create/[modelId]', id);
    assert.equal(handoff.params.prompt, template.prompt, id);
    assert.equal(handoff.params.modelId, modelIdForName(template.model), id);
    assert.equal(handoff.params.duration, String(template.durationSeconds), id);
  }
});

test('R1 assembled and missing-catalog prices use the Kling 10s quote', () => {
  const kling = catalog.find(model => model.id === 'kling-3.0-i2v');
  for (const id of changedIds.filter(id => templateById(id).model === 'Kling 3.0 · I2V')) {
    const preset = templateById(id);
    assert.equal(preset.credits, kling.credits, id);
    assert.equal(presetCredits(preset, catalog), kling.credits * 2, id);
    assert.equal(presetCredits(preset, []), kling.credits * 2, id);
    const fallback = toPublicPresets([], [preset])[0];
    assert.equal(fallback.available, false);
    assert.equal(fallback.credits, kling.credits * 2, id);
  }
});

test('import rules cover all branches without changing exact copy-only text', () => {
  const base = { model: 'Seedance 2.0 Fast', durationSeconds: 10, prompt: 'Create a ten-second cinematic video.', promptOrigin: 'veyrnox-adaptation' };
  const required = fitSeedanceTemplate({ ...base, needs: 'A portrait' });
  assert.equal(required.model, 'Kling 3.0 · I2V');
  const optional = fitSeedanceTemplate({ ...base, needs: 'An optional image', prompt: `${base.prompt} The uploaded person looks left. Use the uploaded start image for the characters and composition when supplied.` });
  assert.equal(optional.needs, null);
  assert.doesNotMatch(optional.prompt, /uploaded|ten-second/);
  const copyOnly = { ...base, needs: 'Copy the exact prompt; its required image is not wired', promptOrigin: 'community-source-exact' };
  assert.deepEqual(fitSeedanceTemplate(copyOnly), { ...copyOnly, durationSeconds: 5, credits: 19 });
  assert.equal(fitSeedanceTemplate(base).durationSeconds, 5);
  assert.match(fitSeedanceTemplate(base).prompt, /five-second/);
  for (const intro of ['Animate the uploaded reference', 'Animate the uploaded image', 'Animate the supplied portrait']) {
    const prompt = `${intro} into a ten-second scene.`;
    assert.equal(fitSeedanceTemplate({ ...base, needs: 'A portrait', prompt }).prompt, prompt, 'existing image intro is not duplicated');
  }
});

test('committed generated metadata and recipes match an offline re-import', () => {
  execFileSync(process.execPath, ['scripts/import-seedance-source-templates.mjs', '--check'], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
});
