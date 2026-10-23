import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_THEMES, PRESETS, effectThemeId, templatesInTheme } from '../app/veyrnox/_lib/templates.js';

test('every production template belongs to one original Veyrnox effect theme', () => {
  assert.deepEqual(EFFECT_THEMES.map((theme) => theme.id), [
    'CREATURES', 'TRANSFORM', 'DANCE', 'ACTION', 'POWERS',
    'CAMERA', 'ART STYLES', 'BRAND', 'CELEBRATE', 'STORY',
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

test('theme navigation remains source-platform neutral', () => {
  assert.doesNotMatch(JSON.stringify(EFFECT_THEMES), /crun|kling|vidu|bytedance/i);
});
