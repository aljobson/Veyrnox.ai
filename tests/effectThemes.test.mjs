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
  // Hiding promptless rows intentionally reduces these two themes below five.
  // Pin their complete retained membership; do not reclassify unrelated exact
  // templates or restore hidden cards to satisfy the old gallery minimum.
  const retainedSmallThemes = {
    'AI GIFT': ['dandelion-ball', 'red-thread-story', 'meal-together'],
    FESTIVAL: ['enchanted-forest-selfie', 'pumpkin-night'],
  };
  for (const theme of EFFECT_THEMES) {
    const rows = templatesInTheme(theme.id);
    if (retainedSmallThemes[theme.id]) assert.deepEqual(rows.map(row => row.id), retainedSmallThemes[theme.id]);
    else assert.ok(rows.length >= 5, theme.id);
  }
  assert.deepEqual(templatesInTheme('NOT A THEME'), []);
  assert.doesNotMatch(JSON.stringify(EFFECT_THEMES), /crun|kling|vidu|bytedance|https?:/i);
});

test('every effect-theme override targets a published template', async () => {
  const {OVERRIDES} = await import('../app/veyrnox/_lib/effectThemes.js');
  const {templateById} = await import('../app/veyrnox/_lib/templates.js');
  for (const id of Object.values(OVERRIDES).flat()) assert.ok(templateById(id), id);
});
