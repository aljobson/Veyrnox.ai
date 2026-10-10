import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { ALL_TEMPLATES, LEGACY_PRESETS, PRESETS, WALL_PRESETS, templateById } from '../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName, presetCredits, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';
import { templateStartId } from '../lib/templateStart.js';

test('every imported clip has its own matching recipe and a supported video model', () => {
  assert.equal(SOURCE_TEMPLATES.length, 37);
  assert.equal(new Set(SOURCE_TEMPLATES.map((p) => p.clipKey)).size, 37);
  for (const preset of SOURCE_TEMPLATES) {
    const clip = SHOWCASE_CLIPS[preset.clipKey];
    assert.ok(clip, preset.id);
    assert.equal(clip.title.toUpperCase(), preset.name, preset.id);
    assert.ok(clip.video.endsWith(`-${preset.id}.mp4`), preset.id);
    assert.equal(MODELS.find((m) => m.id === modelIdForName(preset.model))?.kind, 'video');
    assert.ok(preset.prompt.length > 100 && preset.prompt.length <= 2000);
    assert.doesNotMatch(preset.prompt, /@(image|video)\d/, 'unsupported source reference slots must not leak into runnable prompt');
    assert.equal(preset.promptOrigin, 'veyrnox-adaptation');
    assert.ok(preset.needs);
    assert.ok([5, 10].includes(preset.durationSeconds));
  }
});

test('gallery and homepage templates describe separate footage, with reachable recipe URLs', () => {
  assert.equal(PRESETS.length, 22);
  assert.equal(WALL_PRESETS.length, 7);
  const visible = [...PRESETS, ...WALL_PRESETS];
  assert.equal(new Set(visible.map((p) => p.clipKey)).size, 29);
  for (const preset of visible) {
    assert.equal(templateById(preset.id), preset);
    assert.equal(isUnknownStaticPage(`/presets/${preset.id}`), false);
    assert.equal(templateStartId(preset.id, modelIdForName(preset.model)), preset.id);
  }
});

test('old template bookmarks retain their original recipe without unrelated video', () => {
  assert.equal(new Set(ALL_TEMPLATES.map((p) => p.id)).size, ALL_TEMPLATES.length);
  assert.equal(LEGACY_PRESETS.length, 22);
  assert.match(templateById('cctv-night').prompt, /security camera/);
  for (const preset of LEGACY_PRESETS) {
    assert.equal(templateById(preset.id), preset);
    assert.equal(preset.clipKey, undefined);
    assert.equal(isUnknownStaticPage(`/presets/${preset.id}`), false);
  }
});

test('published prompts and private effect workflows are clearly distinguished', () => {
  const syntx = SOURCE_TEMPLATES.filter((p) => p.sourceRecipe.name === 'SYNTX');
  assert.equal(syntx.length, 11);
  for (const { sourceRecipe: source } of syntx) {
    assert.equal(source.promptOrigin, 'published');
    assert.ok(source.prompt.length > 100);
    assert.equal(createHash('sha256').update(source.prompt).digest('hex'), source.promptSha256);
    for (const ref of source.references) assert.match(ref.url, /^https:\/\/r2\.syntx\.ai\//);
  }
  for (const { sourceRecipe: source } of SOURCE_TEMPLATES.filter((p) => p.sourceRecipe.name === 'Higgsfield')) {
    assert.equal(source.prompt, null);
    assert.equal(source.promptOrigin, 'not-public');
    assert.match(source.url, /^https:\/\/higgsfield\.ai\/effects\/use\//);
    assert.ok(source.inputs.some((input) => input.kind === 'image' && input.required));
  }
});

test('ten-second recipes quote and hand off the same doubled cost', () => {
  for (const preset of SOURCE_TEMPLATES.filter((p) => p.durationSeconds === 10)) {
    assert.equal(presetCredits(preset, []), preset.credits * 2);
    assert.equal(presetCredits(preset, [{ id: modelIdForName(preset.model), credits: 41 }]), 82);
    assert.match(presetHref(preset), /&duration=10s$/);
  }
});
