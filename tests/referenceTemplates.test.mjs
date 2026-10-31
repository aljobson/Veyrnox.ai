import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { dataInventory } from '../scripts/lib/data-i18n.mjs';
import { REFERENCE_TEMPLATES } from '../app/veyrnox/_lib/referenceTemplates.js';
import { ALL_TEMPLATES, PRESETS, templateById, hasTemplateVideo } from '../app/veyrnox/_lib/templates.js';
import { modelIdForName, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { PRESET_STEP_KEYS } from '../lib/i18n/presetSteps.mjs';
import { CATALOGS, translator } from '../lib/i18n/translate.mjs';
import { templateStartId } from '../lib/templateStart.js';

test('the reference audit exempts only canonical prompts and the fixed model, retaining display checks', () => {
  const file = 'app/veyrnox/_lib/referenceTemplates.js';
  const inventory = source => dataInventory(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), file, CATALOGS.en);
  const rows = inventory(readFileSync(file, 'utf8'));
  assert.deepEqual(rows.filter(row => row.status === 'unresolved'), []);
  assert.equal(rows.filter(row => row.field === 'prompt' && row.status === 'allowlisted').length, 6);
  assert.equal(rows.filter(row => row.field === 'model' && row.status === 'allowlisted').length, 1);
  assert.ok(rows.some(row => row.field === 'needs' && row.status === 'translated'));
  assert.equal(rows.filter(row => row.field === 'steps' && row.status === 'translated').length, 3);
  const changed = inventory(`
    const COMMON = { model: 'A different model display name', needs: 'New untranslated upload guidance here.', steps: ['New untranslated step goes here.'] };
    export const REFERENCE_TEMPLATES = [{ ...COMMON, prompt: 'Canonical provider instructions remain verbatim.', description: 'New untranslated description goes here.', label: 'New untranslated display label here.', name: 'New untranslated recipe title here.' }];
  `);
  assert.deepEqual(changed.filter(row => row.status === 'unresolved').map(row => row.field).sort(), ['description', 'label', 'model', 'name', 'needs', 'steps']);
  assert.equal(changed.find(row => row.field === 'prompt').status, 'allowlisted');
});

test('six original reference recipes preserve the ordered two-picture prompt contract', () => {
  assert.equal(REFERENCE_TEMPLATES.length, 6);
  assert.equal(new Set(ALL_TEMPLATES.map(p => p.id)).size, ALL_TEMPLATES.length);
  const categories = new Set(['CARTOONS', 'PRODUCTS', 'FANTASY', 'CINEMATIC', 'VFX', 'REALISTIC']);
  for (const preset of REFERENCE_TEMPLATES) {
    assert.match(preset.id, /^ref-/);
    assert.ok(categories.has(preset.category));
    assert.equal(preset.model, 'Kling O1 · Reference');
    assert.equal(preset.credits, 47);
    assert.equal(preset.durationSeconds, 5);
    assert.equal(preset.promptOrigin, 'veyrnox-adaptation');
    assert.equal(preset.needsKey, 'reference.video-two-pictures');
    assert.equal(preset.needs, 'One video (3–10 s, at least 720p) and two reference pictures');
    assert.ok(preset.prompt.length >= 100 && preset.prompt.length <= 2000);
    assert.match(preset.prompt, /@Image1/);
    assert.match(preset.prompt, /@Image2/);
    assert.match(preset.prompt, /source video/i);
    assert.doesNotMatch(preset.prompt, /@Image[3-9]|@Video|https?:/i);
    assert.doesNotMatch(preset.prompt, /barbie|ghibli|minecraft|superman|super mario|sexy\b|boob|chanel|ferrari|doraemon|hulk|captain america|squid game|demon slayer|neymar/i);
    assert.doesNotMatch(JSON.stringify(preset), /buzzy|higgsfield|syntx|capcut|film\.fun|cliptrend|trendai|vynoa|viralance/i);
    assert.ok(preset.steps.every(step => PRESET_STEP_KEYS[step]));
  }
});

test('reference templates resolve direct Create links but stay out of preview-only discovery', () => {
  for (const preset of REFERENCE_TEMPLATES) {
    assert.deepEqual(templateById(preset.id), preset);
    assert.equal(templateStartId(preset.id, 'kling-o1-reference'), preset.id);
    assert.equal(templateStartId(preset.id, 'kling-3.0-i2v'), null);
    assert.equal(modelIdForName(preset.model), 'kling-o1-reference');
    assert.match(presetHref(preset), new RegExp(`[?&]preset=${preset.id}(?:&|$)`));
    assert.equal(hasTemplateVideo(preset), false);
    assert.equal(PRESETS.some((listed) => listed.id === preset.id), false);
    assert.equal(preset.clipKey, undefined);
  }
});

test('reference picture slot labels are translated in all eleven root catalogs', () => {
  assert.equal(Object.keys(CATALOGS).length, 11);
  for (const locale of Object.keys(CATALOGS)) {
    const label = translator(locale)('label.Reference pictures');
    assert.ok(label && label !== 'label.Reference pictures');
    assert.equal(label === 'Reference pictures', locale === 'en');
  }
});
