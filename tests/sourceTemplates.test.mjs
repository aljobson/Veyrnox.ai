import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { GENJUTSU_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/genjutsuSourcePromptRecords.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { GENJUTSU_PROMPT_SHA256 } from './fixtures/genjutsuPromptHashes.mjs';
import { SYNTX_PROMPT_SHA256 } from './fixtures/syntxPromptHashes.mjs';
import { SYNTX_EXPANSION_SOURCE_ASSET_SHA256, SYNTX_RECOVERED_PREVIEW_SSIM } from './fixtures/syntxSourceAssetHashes.mjs';
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

const NEW_SYNTX_TEMPLATE_IDS = new Set([
  'beyond-gravity', 'chasing-you', 'cinematic-showcase-2', 'cinematic-showcase', 'basketball-3',
  'reality-shift', 'live-stage-performance', 'football', 'brixton', 'unforgettable',
  'natural-viral-makeover', 'freestyle', 'the-lost-chase', 'burning-bridges',
  'retro-hip-hop-spotlight', 'wheelie-rider', 'mystery-unboxing', 'whiskey-gun-trick',
  'cyber-mask-transformation', 'pizzeria-hide-and-seek',
]);

const UNATTRIBUTED_14_OCTOBER_WALL_IDS = [
  'agamemnon', 'blue-depth', 'cyclope', 'fairytale-castle',
  'infinite-clones', 'moonwalk', 'skatedog', 'windows',
];

function mp4DurationSeconds(data) {
  const offset = data.indexOf('mvhd', 0, 'ascii');
  assert.ok(offset > 0, 'MP4 must contain an mvhd movie header');
  const version = data[offset + 4];
  const timescale = data.readUInt32BE(offset + (version === 1 ? 24 : 16));
  const duration = version === 1 ? Number(data.readBigUInt64BE(offset + 28)) : data.readUInt32BE(offset + 20);
  return duration / timescale;
}

test('every imported clip has its own matching recipe and a supported video model', () => {
  assert.equal(SOURCE_TEMPLATES.length, 275);
  assert.equal(new Set(SOURCE_TEMPLATES.map((p) => p.clipKey)).size, 275);
  for (const preset of SOURCE_TEMPLATES) {
    const clip = SHOWCASE_CLIPS[preset.clipKey];
    assert.ok(clip, preset.id);
    assert.equal(clip.title.toUpperCase(), preset.name, preset.id);
    assert.ok(clip.video.endsWith(`-${preset.id}.mp4`), preset.id);
    assert.equal(MODELS.find((m) => m.id === modelIdForName(preset.model))?.kind, 'video');
    assert.ok(preset.prompt.length > 100 && preset.prompt.length <= 2000);
    assert.doesNotMatch(preset.prompt, /@(image|video)\d/, 'unsupported source reference slots must not leak into runnable prompts');
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

test('Genjutsu templates preserve every published source prompt exactly', () => {
  const community = SOURCE_TEMPLATES.filter((preset) => SHOWCASE_CLIPS[preset.clipKey].video.startsWith('/showcase/creator-'));
  const otherTemplates = SOURCE_TEMPLATES.filter((preset) => !community.includes(preset));
  const exact = community.filter((preset) => GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id]?.sourcePromptAvailable);
  const derived = community.filter((preset) => !GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id]?.sourcePromptAvailable);
  assert.equal(Object.keys(GENJUTSU_SOURCE_PROMPT_RECORDS).length, 100);
  assert.equal(exact.length, 57);
  assert.equal(derived.length, 43);
  assert.equal(Object.keys(GENJUTSU_PROMPT_SHA256).length, 57);
  assert.equal(new Set(exact.map((preset) => GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id].prompt)).size, 57);
  assert.ok(SOURCE_TEMPLATES.every((preset) => !Object.hasOwn(preset, 'sourcePrompt')));
  assert.ok(SOURCE_TEMPLATES.every((preset) => !Object.hasOwn(preset, 'sourcePromptOrigin')));
  assert.ok(otherTemplates.every((preset) => GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id] == null));

  for (const preset of community) {
    const source = GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id];
    assert.ok(source, preset.id);
    if (source.sourcePromptAvailable) {
      assert.equal(createHash('sha256').update(source.prompt).digest('hex'), GENJUTSU_PROMPT_SHA256[preset.id], preset.id);
    } else {
      assert.equal(preset.promptOrigin, 'veyrnox-adaptation', preset.id);
      assert.equal(source.prompt, null, preset.id);
      assert.equal(GENJUTSU_PROMPT_SHA256[preset.id], undefined, preset.id);
    }
  }
});

test('verbatim Genjutsu provenance preserves public attribution and feed-empty reference slots', () => {
  assert.match(GENJUTSU_SOURCE_PROMPT_RECORDS['community-noir-leading-role'].prompt, /^@Melisbekov:/);
  assert.match(GENJUTSU_SOURCE_PROMPT_RECORDS['identity-locked-performance'].prompt, /my face from \. The attached collage/);
  assert.match(GENJUTSU_SOURCE_PROMPT_RECORDS['community-kitchen-snack-heist'].prompt, /performer with \. for hair/);
  assert.equal(GENJUTSU_SOURCE_PROMPT_RECORDS['community-survivor-memory-shift'].sourcePromptTruncated, true);
  assert.match(GENJUTSU_SOURCE_PROMPT_RECORDS['community-survivor-memory-shift'].prompt, /\nAt$/);
});

test('every public template discloses an exact prompt, a source gap, or adaptation-only provenance', () => {
  const audit = PRESETS.map((preset) => [preset.id, sourcePromptAuditRecord(preset.id)]);
  const groups = Object.groupBy(audit, ([, record]) => record.status);
  assert.equal(groups.exact.length, 113);
  assert.equal(groups['exact-truncated'].length, 1);
  assert.equal(groups.unavailable.length, 44);
  assert.equal(groups['adaptation-only'].length, 117);
  assert.equal(audit.length, 275);
  assert.ok(audit.every(([, record]) => record.runnable === false));
  assert.equal(audit.filter(([, record]) => record.issues.includes('prompt-over-2000')).length, 67);
  assert.equal(audit.filter(([, record]) => record.issues.includes('more-than-two-reference-images')).length, 12);
  assert.equal(audit.filter(([, record]) => record.issues.includes('audio-preservation-not-supported')).length, 60);
  assert.equal(sourcePromptAuditRecord('community-survivor-memory-shift').status, 'exact-truncated');
  assert.equal(sourcePromptAuditRecord('keyboard-duo-swap').status, 'unavailable');
  assert.equal(sourcePromptAuditRecord('product-hero-360').status, 'adaptation-only');
  assert.equal(sourcePromptAuditRecord('curtain-reveal').duplicateOf, 'who-was-that-business');
  const report = readFileSync(new URL('../docs/product/template-prompt-audit-2026-10-29.md', import.meta.url), 'utf8');
  for (const source of ['Higgsfield', 'Syntx', 'CapCut', 'Buzzy.now', 'LipSync.video']) assert.match(report, new RegExp(source));
  const webRecipe = readFileSync(new URL('../app/veyrnox/_components/TemplateRecipe.js', import.meta.url), 'utf8');
  for (const key of ['sourcePromptUnavailable', 'sourcePromptNotRecorded', 'sourcePromptTruncated', 'sourcePromptDuplicate']) assert.match(webRecipe, new RegExp(key));
});

test('Syntx templates preserve every currently published source prompt exactly', () => {
  const records = Object.entries(SYNTX_SOURCE_PROMPT_RECORDS);
  const exact = records.filter(([, source]) => source.sourcePromptAvailable);
  const unresolved = records.filter(([, source]) => !source.sourcePromptAvailable);

  assert.equal(records.length, 58);
  assert.equal(exact.length, 57);
  assert.deepEqual(unresolved.map(([id]) => id), ['keyboard-duo-swap']);
  assert.equal(Object.keys(SYNTX_PROMPT_SHA256).length, 57);
  assert.equal(Object.keys(SYNTX_EXPANSION_SOURCE_ASSET_SHA256).length, 29);
  assert.ok(records.every(([id]) => SOURCE_TEMPLATES.some((preset) => preset.id === id)));
  assert.equal(new Set(records.map(([, source]) => source.sourceMediaId)).size, 58, 'each Syntx record identifies a different licensed media variant');
  assert.deepEqual(
    Object.keys(SYNTX_SOURCE_PROMPT_RECORDS).filter((id) => Object.hasOwn(GENJUTSU_SOURCE_PROMPT_RECORDS, id)),
    [],
    'source maps must not override one another when combined',
  );
  const genjutsuHashes = new Set(Object.values(GENJUTSU_PROMPT_SHA256));
  assert.ok(Object.values(SYNTX_PROMPT_SHA256).every((hash) => !genjutsuHashes.has(hash)), 'Syntx prompts must not duplicate the Genjutsu exact-prompt corpus');
  const capturedAssetHashes = Object.entries(SYNTX_SOURCE_PROMPT_RECORDS)
    .filter(([, source]) => source.sourceAssetSha256)
    .map(([id, source]) => {
      assert.equal(source.sourceAssetSha256, SYNTX_EXPANSION_SOURCE_ASSET_SHA256[id], id);
      return source.sourceAssetSha256;
    });
  assert.equal(capturedAssetHashes.length, 29);
  assert.equal(new Set(capturedAssetHashes).size, 29, 'the recovered and new source downloads must be byte-unique');
  assert.equal(Object.keys(SYNTX_RECOVERED_PREVIEW_SSIM).length, 9);
  assert.ok(Object.values(SYNTX_RECOVERED_PREVIEW_SSIM).every((score) => score > 0.95), 'every historical preview must perceptually match its recovered Syntx variant');

  const provenance = readFileSync(new URL('../docs/product/showcase-clips.md', import.meta.url), 'utf8');
  const audit = readFileSync(new URL('../docs/product/syntx-template-prompt-audit-2026-10-29.md', import.meta.url), 'utf8');
  for (const [id, source] of records) {
    const template = SOURCE_TEMPLATES.find((preset) => preset.id === id);
    const row = provenance.split('\n').find((line) => line.startsWith(`| \`${template.clipKey}\` |`) && line.includes('[SYNTX]('));
    assert.ok(row, `${id} is missing its Syntx provenance row`);
    assert.equal(row.match(/\/variants\/([A-Za-z0-9]+)\.(?:mp4|webm)/)?.[1], source.sourceMediaId, `${id} must stay matched by media ID`);
  }
  const syntxRows = provenance.split('\n').filter((line) => /^\| `[^`]+` \|/.test(line) && line.includes('[SYNTX]('));
  assert.equal(syntxRows.length, records.length);
  for (const row of syntxRows) {
    const clipKey = row.match(/^\| `([^`]+)` \|/)?.[1];
    const template = SOURCE_TEMPLATES.find((preset) => preset.clipKey === clipKey);
    assert.ok(template, `${clipKey} must resolve to a template`);
    const source = SYNTX_SOURCE_PROMPT_RECORDS[template.id];
    assert.ok(source, `${template.id} must have a Syntx source record`);
    assert.equal(row.match(/\/variants\/([A-Za-z0-9]+)\.(?:mp4|webm)/)?.[1], source.sourceMediaId, `${template.id} reverse media-ID match`);
  }
  const detailPage = readFileSync(new URL('../app/veyrnox/presets/[id]/page.js', import.meta.url), 'utf8');
  assert.match(detailPage, /exactSourcePromptRecord\(template\.id\)/, 'detail pages must use the combined exact-prompt source map');
  assert.equal(exactSourcePromptRecord('chasing-you'), SYNTX_SOURCE_PROMPT_RECORDS['chasing-you']);
  assert.equal(exactSourcePromptRecord('keyboard-duo-swap'), null, 'unresolved source prompts must stay off detail pages');
  assert.equal(exactSourcePromptRecord('fairytale-castle'), null, 'unattributed historical previews must stay off detail pages');
  for (const id of UNATTRIBUTED_14_OCTOBER_WALL_IDS) {
    assert.equal(SYNTX_SOURCE_PROMPT_RECORDS[id], undefined, `${id} must not be attributed to Syntx without source-media evidence`);
    assert.match(audit, new RegExp(`\`${id}\``), `${id} must remain documented as an audited exclusion`);
  }

  for (const [id, source] of exact) {
    assert.equal(source.sourceAuditStatus, 'verified-2026-10-29', id);
    assert.equal(createHash('sha256').update(source.prompt).digest('hex'), SYNTX_PROMPT_SHA256[id], id);
  }

  const duplicateGroups = Object.values(Object.groupBy(exact, ([, source]) => createHash('sha256').update(source.prompt).digest('hex')))
    .filter((group) => group.length > 1)
    .map((group) => group.map(([id]) => id));
  assert.deepEqual(duplicateGroups, [
    ['who-was-that-business', 'curtain-reveal'],
    ['event-character-swap', 'rap-takeover'],
  ]);
  assert.equal(SYNTX_SOURCE_PROMPT_RECORDS['curtain-reveal'].sourcePromptDuplicateOf, 'who-was-that-business');
  assert.equal(SYNTX_SOURCE_PROMPT_RECORDS['rap-takeover'].sourcePromptDuplicateOf, 'event-character-swap');

  const missing = SYNTX_SOURCE_PROMPT_RECORDS['keyboard-duo-swap'];
  assert.equal(missing.prompt, null);
  assert.equal(missing.sourceAuditStatus, 'unresolved-public-record-unavailable');

  assert.equal(SYNTX_SOURCE_PROMPT_RECORDS['event-character-swap'].sourceTitle, 'Viral Rap Takeover');
  assert.equal(SYNTX_SOURCE_PROMPT_RECORDS['character-takeover'].sourceTitle, 'Rich in 30 Days');
  assert.equal(SYNTX_SOURCE_PROMPT_RECORDS['blood-moon-dance'].sourceTitle, 'Vampire Blood Moon');

  const previewHashes = records.map(([id]) => {
    const template = SOURCE_TEMPLATES.find((preset) => preset.id === id);
    const video = SHOWCASE_CLIPS[template.clipKey].video;
    const data = readFileSync(new URL(`../public${video}`, import.meta.url));
    let offset = 0;
    while ((offset = data.indexOf('hdlr', offset, 'ascii')) !== -1) {
      assert.notEqual(data.toString('ascii', offset + 12, offset + 16), 'soun', `${video} must not retain source audio`);
      offset += 4;
    }
    if (NEW_SYNTX_TEMPLATE_IDS.has(id)) {
      assert.ok(Math.abs(mp4DurationSeconds(data) - 5) < 0.11, `${video} must remain a five-second preview`);
    }
    return createHash('sha256').update(data).digest('hex');
  });
  assert.equal(new Set(previewHashes).size, 58, 'every licensed Syntx preview remains byte-unique');
});

test('multi-subject community recipes require every identity in one starting image', () => {
  for (const id of [
    'costume-dance-duo',
    'outdoor-duo-dance',
    'studio-rap-duo',
    'community-urban-trio-performance',
    'community-suit-exchange-dance',
    'community-cast-carpool',
    'community-corporate-duo-jam',
    'community-monster-street-dance',
    'community-balcony-club-encounter',
    'basketball-3',
    'football',
    'unforgettable',
    'natural-viral-makeover',
    'freestyle',
    'the-lost-chase',
    'burning-bridges',
    'mystery-unboxing',
    'cyber-mask-transformation',
  ]) {
    const preset = SOURCE_TEMPLATES.find((entry) => entry.id === id);
    assert.equal(preset?.needsKey, 'community.group', id);
    assert.match(preset?.needs || '', /every subject/i, id);
  }
});

test('generated ensembles keep single-subject starting-image guidance', () => {
  for (const id of ['community-ensemble-performance-recast', 'community-street-dance-ensemble', 'community-suit-choir-groove']) {
    const preset = SOURCE_TEMPLATES.find((entry) => entry.id === id);
    assert.notEqual(preset?.needsKey, 'community.group', id);
    assert.doesNotMatch(preset?.needs || '', /every subject/i, id);
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
  assert.equal(PRESETS.length, 275);
  assert.equal(WALL_PRESETS.length, 24);
  const visible = [...PRESETS, ...WALL_PRESETS];
  assert.equal(new Set(visible.map((p) => p.clipKey).filter(Boolean)).size, 275);
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

test('source-backed generation prompts match the published preview behaviour', () => {
  const byId = Object.fromEntries(SOURCE_TEMPLATES.map((preset) => [preset.id, preset]));
  const prompts = Object.fromEntries(Object.entries(byId).map(([id, preset]) => [id, preset.prompt]));
  assert.match(prompts['high-flip'], /transform both the person and location/i);
  assert.doesNotMatch(byId['high-flip'].negativePrompt, /identity|character blending/i);
  assert.match(prompts['earth-zoom'], /Begin on the uploaded outdoor subject.+Earth is visible from orbit.+plunge.+lands back on the subject/s);
  assert.match(prompts.pigeons, /one pigeon forms beneath each foot.+roller skates/s);
  assert.match(prompts['raven-transition'], /three distinct coordinated looks.+ravens/s);
  assert.match(prompts['motion-tracking'], /free of text and brand marks/i);
  assert.doesNotMatch(prompts['motion-tracking'], /labels/i);
});

test('all source-backed generation prompts remain distinct', () => {
  const prompts = SOURCE_TEMPLATES.map((preset) => preset.prompt.trim().replace(/\s+/g, ' '));
  assert.equal(new Set(prompts).size, prompts.length);
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
  assert.equal(clips.length, 275);
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
