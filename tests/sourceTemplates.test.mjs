import './helpers/exactOnlyAssertions.mjs';
import './helpers/higgsfield300Assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { GENJUTSU_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/genjutsuSourcePromptRecords.js';
import { HIGGSFIELD_90_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/higgsfieldCommunityExpansion90Records.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { SEEDANCE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/seedanceSourcePromptRecords.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { GENJUTSU_PROMPT_SHA256 } from './fixtures/genjutsuPromptHashes.mjs';
import { SYNTX_PROMPT_SHA256 } from './fixtures/syntxPromptHashes.mjs';
import { SYNTX_EXPANSION_SOURCE_ASSET_SHA256, SYNTX_RECOVERED_PREVIEW_SSIM } from './fixtures/syntxSourceAssetHashes.mjs';
import { SYNTX_40_VIDEO_SIGNATURES } from './fixtures/syntx40SourceAssetHashes.mjs';
import { SYNTX_40_TEMPLATE_IDS } from '../app/veyrnox/_lib/sourceTemplateExpansion11.js';
import {
  HIGGSFIELD_90_TEMPLATE_IDS,
  REPLACED_HIGGSFIELD_TEMPLATE_IDS,
} from '../app/veyrnox/_lib/sourceTemplateExpansion12.js';
import { HIGGSFIELD_90_PROMPT_SHA256 } from './fixtures/higgsfield90PromptHashes.mjs';
import {
  HIGGSFIELD_90_PREVIEW_SHA256,
  HIGGSFIELD_90_SOURCE_ASSET_SHA256,
  HIGGSFIELD_90_VIDEO_SIGNATURES,
} from './fixtures/higgsfield90SourceAssetHashes.mjs';
import { ALL_TEMPLATES, PRESETS, REMOVED_PROMPT_GAP_TEMPLATE_IDS, WALL_PRESETS, templateById } from '../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName, presetCredits, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { AUDIT_SHOWCASE_CLIPS, SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';
import { templateStartId } from '../lib/templateStart.js';
import { SEEDANCE_200_TEMPLATE_METADATA } from '../app/veyrnox/_lib/seedanceTemplateMetadata.js';
import { SEEDANCE_REFERENCE_MODEL, takesReferenceModel } from '../app/veyrnox/_lib/seedanceReference.js';

// Audit records keep the original media paths; the files are published without the source-platform name.
const publishedMediaPath = (path) => path.replace(/-(?:higgs|syntx)-/, '-');

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
  ...SYNTX_40_TEMPLATE_IDS,
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
  assert.equal(SOURCE_TEMPLATES.length, 841);
  assert.equal(new Set(SOURCE_TEMPLATES.map((p) => p.clipKey)).size, 841);
  for (const preset of SOURCE_TEMPLATES) {
    const clip = AUDIT_SHOWCASE_CLIPS[preset.clipKey];
    assert.ok(clip, preset.id);
    assert.equal(clip.title.toUpperCase(), preset.name, preset.id);
    assert.ok(clip.video.endsWith(`-${preset.id}.mp4`), preset.id);
    const model = MODELS.find((m) => m.id === modelIdForName(preset.model));
    assert.equal(model?.kind, 'video');
    assert.ok(model.durations.includes(preset.durationSeconds), preset.id);
    if (preset.aspect && model.aspects) assert.ok(model.aspects?.includes(preset.aspect), preset.id);
    if (preset.needs == null) {
      assert.equal(preset.model, 'Seedance 2.0 Fast', preset.id);
      assert.equal(preset.durationSeconds, 5, preset.id);
    }
    if (sourcePromptAuditRecord(preset.id).status === 'exact') {
      assert.equal(preset.promptOrigin, 'community-source-exact', preset.id);
      assert.equal(preset.prompt, exactSourcePromptRecord(preset.id).prompt, preset.id);
      assert.equal(preset.sourcePrompt, preset.prompt, preset.id);
    } else {
      assert.equal(preset.prompt, null, preset.id);
      assert.equal(preset.sourcePrompt, null, preset.id);
    }
  }
});

test('Genjutsu-inspired recipes describe source framing without claiming provider aspect support', () => {
  const community = SOURCE_TEMPLATES.filter((preset) => AUDIT_SHOWCASE_CLIPS[preset.clipKey].video.startsWith('/showcase/creator-') && !preset.sourceModel);
  assert.equal(community.length, 438);
  assert.equal(community.filter(p => p.needsKey === null).length, 9);
  for (const preset of community) {
    assert.equal(Object.hasOwn(preset, 'aspect'), false, preset.id);
    assert.match(preset.sourceAspect, /^(?:1:1|9:16|16:9)$/);
    // Amendment 2 adds nine explicitly reviewed text-only routes; their complete
    // per-id tuples are locked independently in replacementTemplates.test.mjs.
    if (preset.needsKey === null) {
      assert.equal(preset.needs, null, preset.id);
      assert.equal(preset.model, 'Seedance 2.0 Fast', preset.id);
      assert.equal(preset.durationSeconds, 5, preset.id);
    } else assert.match(preset.needsKey, /^community\.(?:cartoons|cinematic|fashion|movies|products|ugc|vfx|group|copyOnly)$/);
  }
  const detail = readFileSync(new URL('../app/veyrnox/presets/[id]/page.js', import.meta.url), 'utf8');
  const handoff = readFileSync(new URL('../app/veyrnox/_components/TemplateHandoffCard.js', import.meta.url), 'utf8');
  assert.match(detail, /presets\.detail\.sourceAspect/);
  assert.match(handoff, /presets\.detail\.sourceAspect/);
});

test('Genjutsu templates preserve every published source prompt exactly', () => {
  const community = SOURCE_TEMPLATES.filter((preset) => Object.hasOwn(GENJUTSU_SOURCE_PROMPT_RECORDS, preset.id));
  const otherTemplates = SOURCE_TEMPLATES.filter((preset) => !community.includes(preset));
  const exact = community.filter((preset) => GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id]?.sourcePromptAvailable);
  const derived = community.filter((preset) => !GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id]?.sourcePromptAvailable);
  assert.equal(Object.keys(GENJUTSU_SOURCE_PROMPT_RECORDS).length, 100);
  assert.equal(exact.length, 59);
  assert.equal(derived.length, 41);
  assert.equal(Object.keys(GENJUTSU_PROMPT_SHA256).length, 59);
  assert.equal(new Set(exact.map((preset) => GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id].prompt)).size, 59);
  assert.ok(SOURCE_TEMPLATES.every(preset => preset.sourcePrompt === preset.prompt));
  assert.ok(SOURCE_TEMPLATES.every(preset => preset.sourcePromptOrigin === preset.promptOrigin));
  assert.ok(otherTemplates.every((preset) => GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id] == null));

  for (const preset of community) {
    const source = GENJUTSU_SOURCE_PROMPT_RECORDS[preset.id];
    assert.ok(source, preset.id);
    if (source.sourcePromptAvailable) {
      assert.equal(createHash('sha256').update(source.prompt).digest('hex'), GENJUTSU_PROMPT_SHA256[preset.id], preset.id);
    } else {
      assert.equal(preset.promptOrigin, null, preset.id);
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

test('the 90 replacement Higgsfield templates preserve exact same-record prompts and unique videos', () => {
  const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/higgsfield-90-exact-2026-10-29.json', import.meta.url)));
  const auditById = Object.fromEntries(audit.records.map((record) => [record.id, record]));
  const oldPromptHashes = new Set(Object.values({
    ...GENJUTSU_SOURCE_PROMPT_RECORDS,
    ...SYNTX_SOURCE_PROMPT_RECORDS,
  }).filter((record) => record.sourcePromptAvailable && typeof record.prompt === 'string')
    .map((record) => createHash('sha256').update(record.prompt).digest('hex')));

  assert.equal(HIGGSFIELD_90_TEMPLATE_IDS.length, 90);
  assert.equal(REPLACED_HIGGSFIELD_TEMPLATE_IDS.length, 90);
  assert.equal(Object.keys(HIGGSFIELD_90_SOURCE_PROMPT_RECORDS).length, 90);
  assert.equal(Object.keys(HIGGSFIELD_90_PROMPT_SHA256).length, 90);
  assert.equal(Object.keys(HIGGSFIELD_90_SOURCE_ASSET_SHA256).length, 90);
  assert.equal(new Set(Object.values(HIGGSFIELD_90_VIDEO_SIGNATURES)).size, 90);
  assert.equal(new Set(Object.values(HIGGSFIELD_90_PREVIEW_SHA256)).size, 90);
  assert.equal(audit.requested, 90);
  assert.equal(audit.accepted, 90);
  assert.deepEqual(audit.duplicateChecks, {
    uniquePromptHashes: 90,
    uniqueSourceMediaIds: 90,
    uniqueSourceAssetHashes: 90,
    uniquePreviewHashes: 90,
    uniqueNormalizedVideoSignatures: 90,
  });

  const publicIds = new Set(SOURCE_TEMPLATES.map(({ id }) => id));
  for (const replacedId of REPLACED_HIGGSFIELD_TEMPLATE_IDS) assert.equal(publicIds.has(replacedId), false, replacedId);
  for (const id of HIGGSFIELD_90_TEMPLATE_IDS) {
    const source = HIGGSFIELD_90_SOURCE_PROMPT_RECORDS[id];
    const record = auditById[id];
    const template = SOURCE_TEMPLATES.find((candidate) => candidate.id === id);
    const promptHash = createHash('sha256').update(source.prompt).digest('hex');
    assert.ok(template, id);
    assert.equal(source.sourcePromptAvailable, true, id);
    assert.equal(source.prompt, record.prompt, id);
    assert.equal(promptHash, HIGGSFIELD_90_PROMPT_SHA256[id], id);
    assert.equal(oldPromptHashes.has(promptHash), false, `${id} duplicates an earlier exact prompt`);
    assert.equal(record.sourceAssetSha256, HIGGSFIELD_90_SOURCE_ASSET_SHA256[id], id);
    assert.equal(record.sourceVideoSignature, HIGGSFIELD_90_VIDEO_SIGNATURES[id], id);
    const localPreviewHash = createHash('sha256').update(readFileSync(
      fileURLToPath(new URL(`../public/showcase/viral-${id}.mp4`, import.meta.url)),
    )).digest('hex');
    assert.equal(localPreviewHash, record.localPreviewSha256, id);
    assert.equal(localPreviewHash, HIGGSFIELD_90_PREVIEW_SHA256[id], id);
    const localPoster = readFileSync(fileURLToPath(new URL(`../public/showcase/viral-${id}.jpg`, import.meta.url)));
    assert.equal(createHash('sha256').update(localPoster).digest('hex'), record.localPosterSha256, id);
    assert.equal(localPoster.byteLength, record.localPosterBytes, id);
  }
});

test('the 200 Seedance templates preserve full prompts and paired unique videos', () => {
  const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/seedance-200-exact-2026-10-29.json', import.meta.url)));
  assert.equal(audit.requested, 200);
  assert.equal(audit.accepted, 200);
  assert.deepEqual(audit.sourceCounts, { Higgsfield: 79, Syntx: 121 });
  assert.deepEqual(audit.changeCounts, { correctedExisting: 78, added: 122 });
  assert.deepEqual(audit.duplicateChecks, {
    uniqueTemplateIds: 200,
    uniquePromptHashes: 200,
    uniqueSourceMediaUrls: 200,
    uniqueNormalizedVideoSignatures: 200,
  });

  const promptHashes = new Set();
  const videoSignatures = new Set();
  const promptAudits = [];
  for (const record of audit.records) {
    const template = SOURCE_TEMPLATES.find((candidate) => candidate.id === record.id);
    const exact = exactSourcePromptRecord(record.id);
    assert.ok(template, record.id);
    assert.ok(exact, record.id);
    assert.equal(exact.prompt, record.prompt, `${record.id}: full prompt changed`);
    assert.equal(createHash('sha256').update(exact.prompt).digest('hex'), record.sourcePromptSha256, record.id);
    assert.equal(template.sourcePlatform, record.sourcePlatform, record.id);
    assert.equal(template.sourceModel, record.sourceModel, record.id);
    assert.equal(template.sourceUrl, record.sourceUrl, record.id);
    const textOnly = template.needs == null || /^Copy the exact prompt;/.test(template.needs);
    const reference = !textOnly && takesReferenceModel(SEEDANCE_200_TEMPLATE_METADATA[record.id]);
    assert.equal(template.model, textOnly ? 'Seedance 2.0 Fast' : reference ? SEEDANCE_REFERENCE_MODEL : 'Kling 3.0 · I2V', record.id);
    assert.equal(template.credits, textOnly ? 19 : reference ? 85 : 32, record.id);
    assert.equal(template.durationSeconds, textOnly ? 5 : 10, record.id);
    assert.equal(template.promptOrigin, 'community-source-exact', record.id);
    assert.equal(template.sourcePromptOrigin, 'community-source-exact', record.id);
    assert.equal(template.prompt, record.prompt, record.id);
    assert.equal(template.sourcePrompt, record.prompt, record.id);
    assert.equal(template.preferAdaptedPrompt, undefined, record.id);
    const promptAudit = sourcePromptAuditRecord(record.id);
    promptAudits.push(promptAudit);
    if (record.referenceImageCount > 0 || record.referenceVideoCount > 0 || promptAudit.issues.includes('audio-preservation-not-supported')) {
      assert.equal(promptAudit.runnable, false, `${record.id}: unsupported source slots must block generation`);
      assert.ok(promptAudit.issues.includes('source-input-contract-not-wired'), record.id);
    }

    const preview = readFileSync(fileURLToPath(new URL(`../public${publishedMediaPath(record.previewPath)}`, import.meta.url)));
    const poster = readFileSync(fileURLToPath(new URL(`../public${publishedMediaPath(record.posterPath)}`, import.meta.url)));
    assert.equal(createHash('sha256').update(preview).digest('hex'), record.localPreviewSha256, record.id);
    assert.equal(createHash('sha256').update(poster).digest('hex'), record.localPosterSha256, record.id);
    promptHashes.add(record.sourcePromptSha256);
    videoSignatures.add(record.sourceVideoSignature);
  }
  assert.equal(promptHashes.size, 200);
  assert.equal(videoSignatures.size, 200);
  assert.equal(promptAudits.filter((record) => record.runnable).length, 79);
  assert.equal(promptAudits.filter((record) => !record.runnable).length, 121);
});

test('public community templates are exact and all source-gap records are removed', () => {
  const audit = PRESETS.map((preset) => [preset.id, sourcePromptAuditRecord(preset.id)]);
  const groups = Object.groupBy(audit, ([, record]) => record.status);
  assert.equal(groups.exact.length, 771);
  assert.equal(groups['adaptation-only'], undefined);
  assert.equal(groups['exact-truncated'], undefined);
  assert.equal(groups.unavailable, undefined);
  assert.equal(audit.length, 771);
  assert.ok(audit.some(([, record]) => record.runnable === true));
  assert.ok(audit.some(([, record]) => record.runnable === false));
  assert.equal(audit.filter(([, record]) => record.issues.includes('prompt-over-30000')).length, 0);
  assert.equal(audit.filter(([, record]) => record.issues.includes('more-than-two-reference-images')).length, 102);
  assert.equal(audit.filter(([, record]) => record.issues.includes('audio-preservation-not-supported')).length, 224);
  assert.equal(sourcePromptAuditRecord('community-survivor-memory-shift').status, 'exact-truncated');
  assert.equal(sourcePromptAuditRecord('keyboard-duo-swap').status, 'unavailable');
  assert.equal(REMOVED_PROMPT_GAP_TEMPLATE_IDS.length, 70);
  const removedGroups = Object.groupBy(REMOVED_PROMPT_GAP_TEMPLATE_IDS, (id) => sourcePromptAuditRecord(id).status);
  assert.equal(removedGroups['exact-truncated'].length, 1);
  assert.equal(removedGroups.unavailable.length, 42);
  assert.equal(removedGroups['adaptation-only'].length, 27);
  for (const id of REMOVED_PROMPT_GAP_TEMPLATE_IDS) {
    assert.equal(templateById(id), null, id);
    assert.equal(PRESETS.some((preset) => preset.id === id), false, id);
    assert.equal(isUnknownStaticPage(`/presets/${id}`), true, id);
  }
  assert.equal(sourcePromptAuditRecord('product-hero-360').status, 'adaptation-only');
  assert.equal(sourcePromptAuditRecord('curtain-reveal').duplicateOf, 'who-was-that-business');
  const report = readFileSync(new URL('../docs/product/template-prompt-audit-2026-10-29.md', import.meta.url), 'utf8');
  for (const source of ['Higgsfield', 'Syntx', 'CapCut', 'Buzzy.now', 'LipSync.video']) assert.match(report, new RegExp(source));
  const webRecipe = readFileSync(new URL('../app/veyrnox/_components/TemplateRecipe.js', import.meta.url), 'utf8');
  for (const key of ['sourcePromptUnavailable', 'sourcePromptNotRecorded', 'sourcePromptTruncated', 'sourcePromptDuplicate']) assert.match(webRecipe, new RegExp(key));
  assert.doesNotMatch(webRecipe, /generationBlocked=\{sourcePromptBlocked\}|sourcePromptCopyOnly|sourcePromptModelLimitCopyOnly/);
  assert.doesNotMatch(webRecipe, /data-runnable-adaptation|hasRunnableAdaptation/);
  const mobileRecipe = readFileSync(new URL('../apps/mobile/src/app/(app)/templates/[id].tsx', import.meta.url), 'utf8');
  assert.match(mobileRecipe, /disabled=\{tooLong \|\| !prompt\.trim\(\)\}/);
  assert.doesNotMatch(mobileRecipe, /TemplateRecipe\.generationPrompt|hasRunnableAdaptation|sourcePromptCopyOnly|sourcePromptModelLimitCopyOnly/);
});

test('Syntx templates preserve every currently published source prompt exactly', () => {
  const records = Object.entries(SYNTX_SOURCE_PROMPT_RECORDS);
  const exact = records.filter(([, source]) => source.sourcePromptAvailable);
  const unresolved = records.filter(([, source]) => !source.sourcePromptAvailable);

  assert.equal(records.length, 98);
  assert.equal(exact.length, 97);
  assert.deepEqual(unresolved.map(([id]) => id), ['keyboard-duo-swap']);
  assert.equal(Object.keys(SYNTX_PROMPT_SHA256).length, 97);
  assert.equal(Object.keys(SYNTX_EXPANSION_SOURCE_ASSET_SHA256).length, 69);
  assert.equal(Object.keys(SYNTX_40_VIDEO_SIGNATURES).length, 40);
  assert.equal(new Set(Object.values(SYNTX_40_VIDEO_SIGNATURES)).size, 40, 'normalized new-video signatures must be unique');
  assert.ok(records.every(([id]) => SOURCE_TEMPLATES.some((preset) => preset.id === id)));
  assert.equal(new Set(records.map(([, source]) => source.sourceMediaId)).size, 98, 'each Syntx record identifies a different licensed media variant');
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
  assert.equal(capturedAssetHashes.length, 69);
  assert.equal(new Set(capturedAssetHashes).size, 69, 'the recovered and new source downloads must be byte-unique');
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
    const video = AUDIT_SHOWCASE_CLIPS[template.clipKey].video;
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
  assert.equal(new Set(previewHashes).size, 98, 'every licensed Syntx preview remains byte-unique');
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
  for (const preset of SOURCE_TEMPLATES.filter((entry) => AUDIT_SHOWCASE_CLIPS[entry.clipKey].video.startsWith('/showcase/creator-'))) {
    const [w, h] = AUDIT_SHOWCASE_CLIPS[preset.clipKey].aspectRatio.split('/').map(Number);
    const ratio = w / h;
    if (preset.sourceAspect === '1:1') assert.ok(Math.abs(Math.log(ratio)) < 0.16, `${preset.id} should be approximately square`);
    else if (preset.sourceAspect === '16:9') assert.ok(ratio > 1, `${preset.id} should be landscape`);
    else assert.ok(ratio < 1, `${preset.id} should be portrait`);
  }
});

test('gallery and homepage templates have reachable recipe URLs', () => {
  assert.equal(PRESETS.length, 771);
  assert.equal(WALL_PRESETS.length, 14);
  const visible = [...PRESETS, ...WALL_PRESETS];
  assert.equal(new Set(visible.map((p) => p.clipKey).filter(Boolean)).size, 771);
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

test('source-backed generation prompts equal their captured published text', () => {
  for (const preset of PRESETS) {
    assert.equal(preset.prompt, exactSourcePromptRecord(preset.id).prompt, preset.id);
    assert.equal(preset.sourcePrompt, preset.prompt, preset.id);
  }
});

test('retained source templates expose provenance only for the verified Seedance collection', () => {
  for (const preset of SOURCE_TEMPLATES) {
    if (preset.sourceModel) {
      assert.ok(['Syntx', 'Higgsfield'].includes(preset.sourcePlatform), preset.id);
      assert.match(preset.sourceUrl, /^https:\/\//, preset.id);
    } else {
      assert.equal(preset.inspired, true, preset.id);
      assert.equal(preset.sourcePlatform, undefined, preset.id);
    }
    assert.ok(!Object.hasOwn(preset, 'sourceRecipe'), preset.id);
  }
  for (const clip of Object.values(AUDIT_SHOWCASE_CLIPS)) {
    assert.doesNotMatch(clip.video, /buzzy|capcut|film\.fun|cliptrend|trendai|vynoa|viralance/i);
    assert.doesNotMatch(clip.poster, /buzzy|capcut|film\.fun|cliptrend|trendai|vynoa|viralance/i);
    if (/higgsfield|syntx/i.test(clip.video)) assert.match(clip.video, /^\/showcase\/viral-seedance-(?:higgs|syntx)-/);
    if (/higgsfield|syntx/i.test(clip.poster)) assert.match(clip.poster, /^\/showcase\/viral-seedance-(?:higgs|syntx)-/);
  }
  for (const clip of Object.values(SHOWCASE_CLIPS)) {
    assert.doesNotMatch(`${clip.video} ${clip.poster}`, /higgs|syntx/i, 'published media paths name no source platform');
  }
});

test('every retained source video and poster is a unique local asset', () => {
  const clips = Object.values(AUDIT_SHOWCASE_CLIPS);
  assert.equal(clips.length, Object.keys(JSON.parse(readFileSync(new URL('./fixtures/exactOnlyVisualSignatures.json', import.meta.url))).placements).length);
  for (const field of ['video', 'poster']) {
    const paths = clips.map((clip) => publishedMediaPath(clip[field]));
    assert.equal(new Set(paths).size, paths.length, `${field} paths must be unique`);
    const hashes = paths.map((path) => createHash('sha256').update(
      readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url))),
    ).digest('hex'));
    assert.equal(new Set(hashes).size, hashes.length, `${field} contents must be unique`);
  }
});

test('community inspiration previews contain no audio track', () => {
  const videos = Object.values(AUDIT_SHOWCASE_CLIPS).map((clip) => clip.video)
    .filter((path) => path.startsWith('/showcase/creator-') || path.startsWith('/showcase/viral-community-'));
  assert.equal(videos.length, 594);
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

test('twelve promptless birthday previews remain audit-only', () => {
  const birthday = SOURCE_TEMPLATES.filter(preset => preset.category === 'KIDS BIRTHDAY');
  assert.equal(birthday.length, 12);
  for (const preset of birthday) {
    assert.equal(templateById(preset.id), null, preset.id);
    assert.equal(preset.prompt, null, preset.id);
    assert.ok(preset.steps.some(step => /30–120s/.test(step)), preset.id);
  }
});
