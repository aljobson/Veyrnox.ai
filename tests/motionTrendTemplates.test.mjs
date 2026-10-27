import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION_TREND_TEMPLATES } from '../app/veyrnox/_lib/motionTrendTemplates.js';
import { EFFECT_THEMES, PRESETS, templateById, templatesInTheme } from '../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';

test('motion trend recipes are runnable prompt-only Veyrnox templates', () => {
  assert.equal(MOTION_TREND_TEMPLATES.length, 20);
  const themes = new Set(EFFECT_THEMES.map((theme) => theme.id));
  for (const preset of MOTION_TREND_TEMPLATES) {
    assert.equal(templateById(preset.id), preset, preset.id);
    assert.ok(PRESETS.includes(preset), preset.id);
    assert.ok(themes.has(preset.theme), preset.id);
    assert.ok(templatesInTheme(preset.theme).includes(preset), preset.id);
    const model = MODELS.find((m) => m.id === modelIdForName(preset.model));
    assert.equal(model?.kind, 'video');
    assert.ok(model.durations.includes(preset.durationSeconds));
    if (model.aspects) assert.ok(model.aspects.includes(preset.aspect), preset.id);
    assert.equal(preset.clipKey, undefined);
    assert.equal(preset.promptOrigin, 'veyrnox-adaptation');
    assert.ok(preset.prompt.length > 250 && preset.prompt.length < 1000, preset.id);
    assert.ok(preset.needs && preset.needsKey, preset.id);
  }
});

test('motion trend recipes carry no source brand, name or media address', () => {
  const data = JSON.stringify(MOTION_TREND_TEMPLATES);
  assert.doesNotMatch(data, /higgsfield|genjutsu|recast|https?:|\.mp4|cloudfront/i);
});
