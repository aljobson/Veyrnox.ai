import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VEYRNOX_ORIGINALS } from '../app/veyrnox/_lib/originalTemplates.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every remaining original has enough data for a distinct non-blank poster', () => {
  for (const preset of VEYRNOX_ORIGINALS) {
    assert.ok(preset.id);
    assert.match(preset.bg, /^linear-gradient\(/, preset.id);
    assert.ok(preset.previewAspect || preset.aspect, preset.id);
    assert.ok(preset.category, preset.id);
    assert.ok(preset.model, preset.id);
  }
});

test('gallery cards and recipe pages use the shared original artwork', () => {
  const component = read('app/veyrnox/_components/OriginalTemplateArtwork.js');
  assert.match(component, /data-original-art=\{preset\.id\}/);
  assert.match(component, /preset\.category/);
  assert.match(component, /preset\.model/);
  assert.match(read('app/veyrnox/_components/PresetCard.js'), /<OriginalTemplateArtwork/);
  assert.match(read('app/veyrnox/presets/[id]/page.js'), /<OriginalTemplateArtwork/);
});
