import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { ALL_TEMPLATES, LEGACY_PRESETS, PRESETS, WALL_PRESETS, templateById } from '../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName, presetCredits, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';
import { templateStartId } from '../lib/templateStart.js';

const REMOVED_ORIGINAL_IDS = [
  'elevator-one-take', 'desert-radio', 'last-train-signal', 'wrong-doorbell', 'empty-place-setting',
  'laser-chorus', 'vinyl-dreamscape', 'rooftop-session', 'rain-platform', 'mecha-launch',
  'pocket-detectives', 'clay-breakfast', 'orbital-western', 'moon-market', 'giant-library',
  'rainy-commuter', 'artisan-at-work', 'chrome-couture', 'coastal-linen', 'serum-splash',
  'watch-macro', 'floating-trainer', 'gravity-reverse', 'paper-city-fold', 'morning-routine',
  'honest-first-look', 'citrus-launch', 'late-night-coffee', 'kinetic-feature-list',
  'workflow-blocks', 'magazine-cover-edit',
];

test('every imported clip has its own matching recipe and a supported video model', () => {
  assert.equal(SOURCE_TEMPLATES.length, 142);
  assert.equal(new Set(SOURCE_TEMPLATES.map((p) => p.clipKey)).size, 142);
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
    assert.equal(preset.durationSeconds, 10);
    const model = MODELS.find((m) => m.id === modelIdForName(preset.model));
    assert.ok(model?.durations?.includes(10));
    if (preset.aspect && model?.aspects) assert.ok(model.aspects.includes(preset.aspect), `${preset.id} uses unsupported ${preset.aspect}`);
  }
});

test('gallery and homepage templates have reachable recipe URLs', () => {
  assert.equal(PRESETS.length, 1178);
  assert.equal(WALL_PRESETS.length, 24);
  const visible = [...PRESETS, ...WALL_PRESETS];
  assert.equal(new Set(visible.map((p) => p.clipKey).filter(Boolean)).size, 142);
  for (const preset of visible) {
    assert.equal(templateById(preset.id), preset);
    assert.equal(isUnknownStaticPage(`/presets/${preset.id}`), false);
    assert.equal(templateStartId(preset.id, modelIdForName(preset.model)), preset.id);
  }
});

test('removed Veyrnox Originals are no longer addressable', () => {
  assert.equal(REMOVED_ORIGINAL_IDS.length, 31);
  for (const id of REMOVED_ORIGINAL_IDS) {
    assert.equal(templateById(id), null, id);
    assert.equal(isUnknownStaticPage(`/presets/${id}`), true, id);
  }
  assert.ok(ALL_TEMPLATES.every((preset) => preset.original !== true));
  assert.ok(ALL_TEMPLATES.every((preset) => preset.promptOrigin !== 'veyrnox-original'));
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

test('public template data and media paths are source-platform neutral', () => {
  for (const preset of SOURCE_TEMPLATES) {
    assert.equal(preset.inspired, true, preset.id);
    assert.ok(!Object.hasOwn(preset, 'sourceRecipe'), preset.id);
  }
  const publicData = JSON.stringify({ SOURCE_TEMPLATES, SHOWCASE_CLIPS });
  assert.doesNotMatch(publicData, /buzzy|higgsfield|syntx|capcut|film\.fun|cliptrend|trendai|vynoa|viralance/i);
  for (const clip of Object.values(SHOWCASE_CLIPS)) {
    assert.doesNotMatch(clip.video, /buzzy|higgsfield|syntx|capcut|film\.fun|cliptrend|trendai|vynoa|viralance/i);
    assert.doesNotMatch(clip.poster, /buzzy|higgsfield|syntx|capcut|film\.fun|cliptrend|trendai|vynoa|viralance/i);
  }
});

test('every public video and poster is a unique local asset', () => {
  const clips = Object.values(SHOWCASE_CLIPS);
  assert.equal(clips.length, 142);
  for (const field of ['video', 'poster']) {
    const paths = clips.map((clip) => clip[field]);
    assert.equal(new Set(paths).size, paths.length, `${field} paths must be unique`);
    const hashes = paths.map((path) => createHash('sha256').update(
      readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url))),
    ).digest('hex'));
    assert.equal(new Set(hashes).size, hashes.length, `${field} contents must be unique`);
  }
});

test('ten-second recipes quote and hand off the same doubled cost', () => {
  for (const preset of SOURCE_TEMPLATES.filter((p) => p.durationSeconds === 10)) {
    assert.equal(presetCredits(preset, []), preset.credits * 2);
    assert.equal(presetCredits(preset, [{ id: modelIdForName(preset.model), credits: 41 }]), 82);
    assert.match(presetHref(preset), /&duration=10s$/);
  }
});

test('kids birthday is a dedicated collection with twelve long-film-ready ideas', () => {
  const birthday = PRESETS.filter((preset) => preset.category === 'KIDS BIRTHDAY');
  assert.equal(birthday.length, 12);
  assert.equal(new Set(birthday.map((preset) => preset.id)).size, 12);
  assert.ok(birthday.every((preset) => preset.steps.some((step) => /30–120s/.test(step))));
  assert.ok(birthday.every((preset) => !Object.hasOwn(preset, 'action')));
});
