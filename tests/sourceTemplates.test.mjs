import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { ALL_TEMPLATES, PRESETS, WALL_PRESETS, templateById } from '../app/veyrnox/_lib/templates.js';
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
  assert.equal(SOURCE_TEMPLATES.length, 255);
  assert.equal(new Set(SOURCE_TEMPLATES.map((p) => p.clipKey)).size, 255);
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

test('Genjutsu-inspired I2V recipes describe source framing without claiming provider aspect support', () => {
  const community = SOURCE_TEMPLATES.filter((preset) => SHOWCASE_CLIPS[preset.clipKey].video.startsWith('/showcase/creator-'));
  assert.equal(community.length, 100);
  for (const preset of community) {
    assert.equal(Object.hasOwn(preset, 'aspect'), false, preset.id);
    assert.match(preset.sourceAspect, /^(?:1:1|9:16|16:9)$/);
    assert.match(preset.needsKey, /^community\.(?:cartoons|cinematic|fashion|movies|products|ugc|vfx|group)$/);
  }
  const detail = readFileSync(new URL('../app/veyrnox/presets/[id]/page.js', import.meta.url), 'utf8');
  const handoff = readFileSync(new URL('../app/veyrnox/_components/TemplateHandoffCard.js', import.meta.url), 'utf8');
  assert.match(detail, /presets\.detail\.sourceAspect/);
  assert.match(handoff, /presets\.detail\.sourceAspect/);
});

test('multi-subject community recipes require every identity in one starting image', () => {
  for (const id of ['costume-dance-duo', 'outdoor-duo-dance', 'studio-rap-duo', 'community-urban-trio-performance', 'community-suit-exchange-dance', 'community-cast-carpool']) {
    const preset = SOURCE_TEMPLATES.find((entry) => entry.id === id);
    assert.equal(preset?.needsKey, 'community.group', id);
    assert.match(preset?.needs || '', /every subject/i, id);
  }
});

test('source-aspect orientation agrees with every community preview', () => {
  for (const preset of SOURCE_TEMPLATES.filter((entry) => SHOWCASE_CLIPS[entry.clipKey].video.startsWith('/showcase/creator-'))) {
    const [w, h] = SHOWCASE_CLIPS[preset.clipKey].aspectRatio.split('/').map(Number);
    const ratio = w / h;
    if (preset.sourceAspect === '1:1') assert.ok(Math.abs(Math.log(ratio)) < 0.16, `${preset.id} should be approximately square`);
    else if (preset.sourceAspect === '16:9') assert.ok(ratio > 1, `${preset.id} should be landscape`);
    else assert.ok(ratio < 1, `${preset.id} should be portrait`);
  }
});

test('gallery and homepage templates have reachable recipe URLs', () => {
  assert.equal(PRESETS.length, 255);
  assert.equal(WALL_PRESETS.length, 24);
  const visible = [...PRESETS, ...WALL_PRESETS];
  assert.equal(new Set(visible.map((p) => p.clipKey).filter(Boolean)).size, 255);
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

test('removed legacy recipes stay unavailable while effect recipes are addressable', () => {
  assert.equal(new Set(ALL_TEMPLATES.map((p) => p.id)).size, ALL_TEMPLATES.length);
  for (const id of ['cctv-night', 'warm-portrait']) {
    assert.equal(templateById(id), null, id);
    assert.equal(isUnknownStaticPage(`/presets/${id}`), true, id);
  }
  for (const id of ['effect-pet-press-conference', 'effect-voxel-world']) {
    assert.ok(templateById(id), id);
    assert.equal(isUnknownStaticPage(`/presets/${id}`), false, id);
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
  assert.equal(clips.length, 255);
  for (const field of ['video', 'poster']) {
    const paths = clips.map((clip) => clip[field]);
    assert.equal(new Set(paths).size, paths.length, `${field} paths must be unique`);
    const hashes = paths.map((path) => createHash('sha256').update(
      readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url))),
    ).digest('hex'));
    assert.equal(new Set(hashes).size, hashes.length, `${field} contents must be unique`);
  }
});

test('community inspiration previews contain no audio track', () => {
  const videos = Object.values(SHOWCASE_CLIPS).map((clip) => clip.video).filter((path) => path.startsWith('/showcase/creator-'));
  assert.equal(videos.length, 100);
  for (const path of videos) {
    const data = readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url)));
    let offset = 0;
    while ((offset = data.indexOf('hdlr', offset, 'ascii')) !== -1) {
      assert.notEqual(data.toString('ascii', offset + 12, offset + 16), 'soun', `${path} must not retain community audio`);
      offset += 4;
    }
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
