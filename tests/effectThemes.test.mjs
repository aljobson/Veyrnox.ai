import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_THEMES, PRESETS, effectThemeId, templatesInTheme } from '../app/veyrnox/_lib/templates.js';

test('every production template belongs to one source-inspired effect theme', () => {
  assert.deepEqual(EFFECT_THEMES.map((theme) => theme.id), [
    'PET', 'STYLE', 'QUIRK LAB', 'MORPH ME', 'AI DANCE', 'SOCCER FEVER',
    'SUPER POWER', 'E-COMMERCE', 'SHOT LANGUAGE', 'AI GIFT', 'FESTIVAL',
  ]);
  for (const template of PRESETS) {
    const theme = effectThemeId(template);
    assert.ok(EFFECT_THEMES.some((entry) => entry.id === theme), `${template.id}: ${theme}`);
    assert.ok(templatesInTheme(theme).includes(template), template.id);
  }
});

test('every effect theme is a useful collection and invalid themes fail closed', () => {
  for (const theme of EFFECT_THEMES) assert.ok(templatesInTheme(theme.id).length >= 5, theme.id);
  assert.deepEqual(templatesInTheme('NOT A THEME'), []);
});

test('theme navigation contains no source branding or media', () => {
  assert.doesNotMatch(JSON.stringify(EFFECT_THEMES), /crun|kling|vidu|bytedance|https?:/i);
});
