import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_CONCEPTS } from '../app/veyrnox/_lib/effectConceptCatalog.js';
import { EFFECT_CONCEPT_TEMPLATES } from '../app/veyrnox/_lib/effectConceptTemplates.js';
import { EFFECT_THEMES, PRESETS, searchTemplates, templateById, templatesInTheme } from '../app/veyrnox/_lib/templates.js';

test('the complete effect inventory is deduplicated into the public Veyrnox gallery', () => {
  assert.equal(EFFECT_CONCEPTS.length, 1036);
  assert.equal(EFFECT_CONCEPT_TEMPLATES.length, 1036);
  assert.equal(PRESETS.length, 1178);
  assert.equal(new Set(PRESETS.map((preset) => preset.id)).size, PRESETS.length);
  assert.equal(new Set(EFFECT_CONCEPTS.map((concept) => concept.name)).size, EFFECT_CONCEPTS.length);
});

test('every effect concept is a runnable original Veyrnox recipe', () => {
  const themes = new Set(EFFECT_THEMES.map((theme) => theme.id));
  for (const preset of EFFECT_CONCEPT_TEMPLATES) {
    assert.equal(templateById(preset.id), preset, preset.id);
    assert.ok(themes.has(preset.theme), `${preset.id}: ${preset.theme}`);
    assert.ok(templatesInTheme(preset.theme).includes(preset), preset.id);
    assert.equal(preset.model, 'Kling 3.0 · I2V');
    assert.equal(preset.durationSeconds, 10);
    assert.equal(preset.promptOrigin, 'veyrnox-adaptation');
    assert.equal(preset.inspired, true);
    assert.equal(preset.clipKey, undefined);
    assert.ok(preset.prompt.length > 250 && preset.prompt.length < 1000, preset.id);
    assert.ok(preset.needs);
  }
});

test('effect catalog ships no source branding, prompts or media addresses', () => {
  const publicData = JSON.stringify(EFFECT_CONCEPTS);
  const publicNames = EFFECT_CONCEPTS.map((concept) => concept.name).join('\n');
  assert.doesNotMatch(publicData, /crun|kling|vidu|bytedance|https?:|preview|prompt|video_url|cover_url/i);
  assert.doesNotMatch(publicData, /barbie|ghibli|minecraft|superman|super mario|sexy\b|boob|chanel|ferrari|doraemon|hulk|captain america|squid game|demon slayer|neymar/i);
  assert.doesNotMatch(publicNames, /(?:360p|480p|720p|1080p|[-_ ](?:img|image|video))$/im);
});

test('search finds individual concepts inside the full catalog', () => {
  assert.deepEqual(searchTemplates(PRESETS, 'pet press conference').map((preset) => preset.id), ['effect-pet-press-conference']);
  assert.deepEqual(searchTemplates(PRESETS, 'voxel world').map((preset) => preset.id), ['effect-voxel-world']);
});
