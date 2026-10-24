import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_THEMES, PRESETS, effectThemeId, templatesInTheme } from '../app/veyrnox/_lib/templates.js';

test('every public template belongs to one effect theme', () => {
  assert.equal(EFFECT_THEMES.length, 11);
  for (const template of PRESETS) {
    const theme = effectThemeId(template);
    assert.ok(EFFECT_THEMES.some((entry) => entry.id === theme), `${template.id}: ${theme}`);
    assert.ok(templatesInTheme(theme).includes(template), template.id);
  }
});

test('every theme is useful and contains no source branding or media', () => {
  for (const theme of EFFECT_THEMES) assert.ok(templatesInTheme(theme.id).length >= 5, theme.id);
  assert.deepEqual(templatesInTheme('NOT A THEME'), []);
  assert.doesNotMatch(JSON.stringify(EFFECT_THEMES), /crun|kling|vidu|bytedance|https?:/i);
});
