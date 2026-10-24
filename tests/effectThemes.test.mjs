import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EFFECT_THEMES } from '../app/veyrnox/_lib/effectThemes.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';

test('the public gallery no longer exposes media-less effect-theme collections', () => {
  assert.equal(PRESETS.some((template) => template.theme), false);
  const gallery = readFileSync(new URL('../app/veyrnox/_components/PresetGallery.js', import.meta.url), 'utf8');
  assert.doesNotMatch(gallery, /EFFECT_THEMES|templatesInTheme|preset-theme-title/);
});

test('retained internal theme metadata contains no source branding or media', () => {
  assert.doesNotMatch(JSON.stringify(EFFECT_THEMES), /crun|kling|vidu|bytedance|https?:/i);
});
