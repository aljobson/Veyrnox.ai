import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { IMAGE_TEMPLATES } from '../app/veyrnox/_lib/imageTemplates.js';
import { IMAGE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/imageSourcePromptRecords.js';
import { SYNTX_100_VIDEO_RECORDS } from '../app/veyrnox/_lib/syntx100VideoRecords.js';
import { SYNTX_100_IMAGE_RECORDS } from '../app/veyrnox/_lib/syntx100ImageRecords.js';
import { validateInputs } from '../lib/generationInputValidation.js';
import { CATALOGS } from '../lib/i18n/catalogs.mjs';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { templateContract } from '../lib/templateContract.js';
import { auditTemplate } from '../scripts/audit-template-fidelity.mjs';
import { publicPromptHygiene } from '../scripts/lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from '../scripts/lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from '../scripts/lib/source-prompt-endings.mjs';
import { VISUAL_SIGNATURE_METHOD } from '../scripts/lib/source-visual-signature.mjs';
const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const audit = json('../docs/product/source-audit/syntx-100-exact-2026-11-13.json');
const pins = json('./fixtures/syntx100PromptHashes.json');
const visual = json('./fixtures/exactOnlyVisualSignatures.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const normalized = prompt => sha(prompt.trim().replace(/\s+/g, ' ').toLowerCase());
const added = { ...SYNTX_100_VIDEO_RECORDS, ...SYNTX_100_IMAGE_RECORDS };

test('96 new source prompts are byte-exact against independent frozen hash pins', () => {
  assert.equal(Object.keys(pins).length, 96);
  assert.equal(Object.keys(SYNTX_100_VIDEO_RECORDS).length, 46);
  assert.equal(Object.keys(SYNTX_100_IMAGE_RECORDS).length, 50);
  assert.deepEqual(Object.keys(added).sort(), Object.keys(pins).sort());
  for (const [id, hash] of Object.entries(pins)) {
    const raw = added[id], row = audit.records.find(r => r.id === id);
    const template = [...SOURCE_TEMPLATES, ...IMAGE_TEMPLATES].find(t => t.id === id);
    for (const prompt of [raw.prompt, row.prompt, template.prompt, exactSourcePromptRecord(id).prompt]) assert.equal(sha(prompt), hash, id);
    assert.equal(raw.promptSha256, hash);
    assert.equal(row.sourcePromptSha256, hash);
    assert.equal(template.promptOrigin, 'community-source-exact');
    assert.doesNotMatch(raw.prompt, /syntx/i);
    for (const key of ['sourceRecordId', 'sourceMediaId', 'sourceTitle', 'sourceSlug', 'sourceMinFiles', 'sourceAspect', 'sourceModel']) assert.deepEqual(raw[key], row[key], `${id}: ${key}`);
    assert.deepEqual(raw.sourceGenerationSettings, row.sourceSettings);
  }
});

test('all record modules and shared provenance contain no identity or normalized-prompt collision with the 96', async () => {
  const corpus = [];
  for (const file of readdirSync(new URL('../app/veyrnox/_lib/', import.meta.url)).filter(f => f.endsWith('Records.js'))) {
    const recordModule = await import(new URL('../app/veyrnox/_lib/' + file, import.meta.url));
    for (const records of Object.values(recordModule)) if (records && typeof records === 'object') {
      for (const [id, r] of Object.entries(records)) if (typeof r?.prompt === 'string') corpus.push([id, r]);
    }
  }
  const hashes = new Map([...new Set([...corpus.map(([, r]) => r), ...Object.values(added)])].map(r => [r, normalized(r.prompt)]));
  for (const [id, record] of Object.entries(added)) {
    for (const [otherId, other] of corpus) {
      if (otherId === id) { assert.deepEqual(other, record); continue; }
      assert.notEqual(record.sourceRecordId, other.sourceRecordId, `${id}/${otherId}: source record`);
      assert.notEqual(record.sourceMediaId, other.sourceMediaId, `${id}/${otherId}: media`);
      if (other.prompt) assert.notEqual(hashes.get(record), hashes.get(other), `${id}/${otherId}: normalized prompt`);
    }
  }
  const captured = Object.entries(SOURCE_PROMPT_RECORDS).filter(([, r]) => r.sourcePromptAvailable && typeof r.prompt === 'string');
  assert.equal(captured.filter(([id]) => Object.hasOwn(IMAGE_SOURCE_PROMPT_RECORDS, id)).length, 52);
  assert.equal(captured.filter(([id]) => !Object.hasOwn(IMAGE_SOURCE_PROMPT_RECORDS, id)).length, 772 + 46);
  assert.equal(captured.length, 774 + 96);
});

test('image photo policy, source aspects, translated categories and catalog models are preserved', () => {
  const images = IMAGE_TEMPLATES.filter(t => Object.hasOwn(SYNTX_100_IMAGE_RECORDS, t.id));
  assert.equal(images.filter(t => t.photo).length, 37);
  assert.equal(images.filter(t => !t.photo).length, 13);
  const overrides = { 'the-glass': 'USE THE OBJECT/PRODUCT EXACTLY FROM THE REFERENCE IMAGE', 'a-clear-bottle': 'exactly like the provided photo' };
  assert.deepEqual(audit.reviewedImagePhotoOverrides, overrides);
  const photoAspects = capabilityFor('grsai:nano-banana-pro-edit').inputs.aspect_ratio.values;
  const textAspects = fallbackCapabilitiesFor('nano-banana-kie').inputs.aspect_ratio.values;
  for (const image of images) {
    const raw = added[image.id];
    assert.ok([0, 1].includes(raw.sourceMinFiles));
    const needsPhoto = raw.sourceMinFiles === 1 || Object.hasOwn(overrides, raw.sourceSlug);
    if (overrides[raw.sourceSlug]) assert.ok(raw.prompt.includes(overrides[raw.sourceSlug]));
    assert.deepEqual(image.photo, needsPhoto ? { required: true, count: 1 } : undefined);
    assert.equal(image.model, needsPhoto ? 'nano-banana-pro-edit-grsai' : 'nano-banana-kie');
    assert.equal(image.aspect, raw.sourceAspect === '2:3' ? '3:4' : raw.sourceAspect);
    const row = audit.records.find(r => r.id === image.id);
    assert.equal(image.previewImage, `/showcase/images/${image.id}.webp`);
    assert.equal(image.previewImage, row.previewPath);
    assert.ok(existsSync(new URL('../public' + image.previewImage, import.meta.url)));
    assert.equal(image.name, row.name);
    assert.equal(image.previewAspect, row.previewAspect);
    assert.ok((needsPhoto ? photoAspects : textAspects).includes(image.aspect));
    assert.equal(image.category, audit.reviewedImageCategories[raw.sourceSlug]);
    for (const [locale, catalog] of Object.entries(CATALOGS)) assert.ok(catalog[`presets.cat.${image.category}`], `${locale}/${image.category}`);
    for (const key of ['credits', 'durationSeconds', 'clipKey']) assert.equal(key in image, false);
  }
});

test('original-media provenance and all 142 shipped previews are hash-locked within budgets', () => {
  assert.equal(audit.manifestSha256, '30ffbe337444154e657c0b87b6bb09155ac33054757b35881b82855f28f4dc29');
  assert.equal(audit.encodeReportSha256, 'caa71828da3f718968fe7af71ce3f526500b4a5abf4b45fd58afa6948dac997f');
  let bytes = 0, files = 0;
  for (const r of audit.records) {
    assert.equal(r.sourceMedia.sha256, r.sourceAssetSha256);
    assert.equal(r.encode.sourceSha256, r.sourceAssetSha256);
    const outputs = [[r.previewPath, r.localPreviewSha256, r.localPreviewBytes, r.kind === 'video' ? 6 * 1024 * 1024 : 250 * 1024]];
    if (r.kind === 'video') {
      assert.equal(r.startSeconds, 0);
      assert.equal(r.encode.audio, false);
      outputs.push([r.posterPath, r.localPosterSha256, r.localPosterBytes, 80 * 1024]);
      assert.deepEqual(visual.placements[r.id], { frames: r.signatureFrameCount, signature: r.sourceVideoSignature });
    } else assert.ok(Math.max(r.encode.width, r.encode.height) <= 1080);
    for (const [path, hash, size, cap] of outputs) {
      const data = readFileSync(new URL('../public' + path, import.meta.url));
      assert.equal(sha(data), hash, r.id); assert.equal(data.length, size); assert.ok(size <= cap);
      bytes += size; files++;
    }
  }
  assert.equal(files, 46 * 2 + 50); assert.equal(bytes, 65619847); // Sum of revised host videoBytes + unchanged posterBytes/imageBytes.
  assert.equal(visual.method, VISUAL_SIGNATURE_METHOD);
  assert.equal(new Set(Object.values(visual.placements).map(r => r.signature)).size, 931 + 46);
});

test('all new videos pass through the unchanged fidelity classifier', () => {
  const classes = {};
  for (const t of SOURCE_TEMPLATES.filter(t => Object.hasOwn(SYNTX_100_VIDEO_RECORDS, t.id))) {
    const expected = auditTemplate(t), actual = templateContract(t.id);
    assert.equal(actual.class, expected.class, t.id);
    assert.equal(actual.modelId, expected.modelId, t.id);
    assert.equal(actual.sourcePrompt, t.prompt, t.id);
    classes[actual.class] = (classes[actual.class] || 0) + 1;
  }
  assert.deepEqual(classes, { 'blocked-needs-video': 37, bound: 9 });
  const videos = audit.records.filter(r => r.kind === 'video');
  assert.equal(videos.filter(r => r.sourceMinFiles === 2).length, 35);
  assert.equal(videos.filter(r => r.sourceMinFiles === 3).length, 5);
  assert.equal(videos.filter(r => /@(?:image|video)/i.test(r.prompt)).length, 46);
});

test('hygiene inventories, reviewed renames and the eleven host drops remain explicit', () => {
  assert.deepEqual(audit.publicPromptHygiene, publicPromptHygiene(audit.records));
  assert.deepEqual(audit['source-reference-gaps'], sourceReferenceGaps(audit.records));
  assert.deepEqual(audit['ending-review'], sourcePromptEndingReview(audit.records));
  assert.equal(audit.rejected.length, 4);
  const refused = json('../scripts/lib/refused-source-records.json');
  assert.equal(refused.length, 6);
  for (const row of audit.records) assert.ok(!refused.some(r => r.sourceRecordId === row.sourceRecordId));
  for (const row of audit.rejected) assert.ok(refused.some(r => r.sourceRecordId === row.sourceRecordId && r.reason === row.reason));
  assert.equal(audit['source-reference-gaps'].count, 2);
  assert.equal(audit['ending-review'].ambiguousUnpunctuatedCount, 16);
  assert.equal(Object.keys(audit.droppedForSyntxBranding).length, 11);
  for (const slug of ['rig-it-right-for-gta', 'home-alone-again', '500-days-of-summer', 'gta-vi-style', 'sims-style', 'lego-style', 'gta-sa-style', 'football-legends', 'lil-tjan', 'rumpelstiltskin', 'iphone-blurry-effect']) {
    const row = audit.records.find(r => r.sourceSlug === slug);
    assert.notEqual(row.id, slug); assert.equal(row.name, row.id.replaceAll('-', ' ').toUpperCase());
    assert.ok(!Object.hasOwn(SOURCE_PROMPT_RECORDS, slug));
  }
  for (const file of ['imageTemplates.js', 'imageTemplatesSyntx100.js', 'syntx100ImageRecords.js', 'syntx100VideoRecords.js', 'sourceTemplateExpansion19.js']) {
    assert.ok(readFileSync(new URL('../app/veyrnox/_lib/' + file, import.meta.url), 'utf8').split('\n').length < 500, file);
  }
});



test('reviewed public ids and display names are independently pinned', () => {
  assert.deepEqual(audit.publicIds, {
  "rig-it-right-for-gta": "game-character-rig",
  "home-alone-again": "holiday-home-recast",
  "500-days-of-summer": "summer-romance-recast",
  "gta-vi-style": "neon-city-game-portrait",
  "sims-style": "life-simulation-portrait",
  "lego-style": "toy-brick-portrait",
  "gta-sa-style": "retro-game-loading-portrait",
  "football-legends": "football-duo-recast",
  "lil-tjan": "stage-performer-recast",
  "rumpelstiltskin": "fairytale-villain-recast",
  "iphone-blurry-effect": "handheld-blur-effect",
  "bad-santa-run": "holiday-heist-run",
  "reality-in-wonderland": "storybook-reality-recast",
  "black-white-2": "shadow-beard-portrait",
  "black-white": "ripple-light-portrait",
  "helicopter-jump-2": "helicopter-jump-two"
});
  assert.deepEqual(audit.publicNames, {
  "rig-it-right-for-gta": "GAME CHARACTER RIG",
  "home-alone-again": "HOLIDAY HOME RECAST",
  "500-days-of-summer": "SUMMER ROMANCE RECAST",
  "gta-vi-style": "NEON CITY GAME PORTRAIT",
  "sims-style": "LIFE SIMULATION PORTRAIT",
  "lego-style": "TOY BRICK PORTRAIT",
  "gta-sa-style": "RETRO GAME LOADING PORTRAIT",
  "football-legends": "FOOTBALL DUO RECAST",
  "lil-tjan": "STAGE PERFORMER RECAST",
  "rumpelstiltskin": "FAIRYTALE VILLAIN RECAST",
  "iphone-blurry-effect": "HANDHELD BLUR EFFECT",
  "bad-santa-run": "HOLIDAY HEIST RUN",
  "reality-in-wonderland": "STORYBOOK REALITY RECAST",
  "black-white-2": "SHADOW BEARD PORTRAIT",
  "black-white": "RIPPLE LIGHT PORTRAIT",
  "helicopter-jump-2": "HELICOPTER JUMP TWO"
});
  const forbidden = /syntx|higgs|gta|sims|lego|football-legends|lil-tjan|rumpelstiltskin|iphone|home-alone|500-days/i;
  for (const row of audit.records) {
    for (const value of [row.id, row.name, row.previewPath, row.posterPath].filter(Boolean)) assert.doesNotMatch(value, forbidden);
    if (row.kind === 'video' && row.id.length >= 10) assert.doesNotMatch(row.id, /[0-9]/);
  }
});

test('every image recipe passes the generation gateway aspect check', () => {
  for (const t of IMAGE_TEMPLATES) assert.deepEqual(validateInputs({ prompt: t.prompt, aspect_ratio: t.aspect }), { ok: true }, t.id);
});

// Parse ISO BMFF lengths, including extended-size and remainder boxes.
function boxes(data, start = 0, end = data.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    assert.ok(offset + 8 <= end);
    let size = data.readUInt32BE(offset), header = 8;
    if (size === 1) { size = Number(data.readBigUInt64BE(offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    assert.ok(size >= header && offset + size <= end);
    result.push({ type: data.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
test('each retained MP4 has exactly one track box', () => {
  for (const row of audit.records.filter(r => r.kind === 'video')) {
    const data = readFileSync(new URL('../public' + row.previewPath, import.meta.url));
    const movies = boxes(data).filter(b => b.type === 'moov');
    assert.equal(movies.length, 1, row.id);
    assert.equal(boxes(data, movies[0].start, movies[0].end).filter(b => b.type === 'trak').length, 1, row.id);
  }
});

test('video review categories and model labels are explicit while raw model ids stay provenance', () => {
  const labels = { 'seedance-2.0': 'Seedance 2.0', 'seedance-2.5': 'Seedance 2.5', kling_4_omni: 'Kling 4 Omni', wan_30_omni: 'Wan 3.0 Omni', wan_30_reference: 'Wan 3.0 Reference', grok_i2v: 'Grok I2V' };
  const counts = {};
  for (const row of audit.records.filter(r => r.kind === 'video')) {
    const recipe = SOURCE_TEMPLATES.find(t => t.id === row.id);
    assert.equal(recipe.sourceModel, labels[row.sourceModel]);
    assert.equal(recipe.category, audit.reviewedVideoCategories[row.sourceSlug]);
    counts[recipe.category] = (counts[recipe.category] || 0) + 1;
  }
  assert.deepEqual(counts, { MOVIES: 6, CINEMATIC: 15, REALISTIC: 23, FASHION: 1, CARTOONS: 1 });
  assert.deepEqual(audit.records.filter(r => r.kind === 'image' && r.aspect !== r.sourceAspect).map(r => r.id).sort(), ['2000s-filter', 'moody-filter', 'particle-filter', 'red-light-filter', 'retro-game-loading-portrait', 'silhouette', 'viral-doodle']);
});

test('every content-screen match has exactly its reviewed decision', () => {
  const expected = { 'retro-groove': 'minor', 'bad-santa-run': 'children', 'ugly-and-funny-doodle-2': 'child' };
  assert.deepEqual(Object.fromEntries(Object.entries(audit.contentScreen.reviewed).map(([slug, r]) => [slug, r.term])), expected);
  assert.equal(audit.contentScreen.block, "\\b(nude|naked|nsfw|porn|erotic|sex(?:ual|y)?|lingerie|topless|bikini|strip(?:per|tease)|fetish|boob|breast|nipple|underage|minor|child(?:ren)?|kid|toddler|baby|teen(?:ager)?|schoolgirl|loli|rape|gore|beheaded|blood(?:y)?|suicide|nazi|hitler|swastika|terroris|isis|kkk|slur|crypto|bitcoin|wallet|airdrop|nft)\\b");
  assert.equal(audit.contentScreen.real, "\\b(trump|biden|obama|putin|zelensk|elon musk|taylor swift|beyonc|kardashian|messi|ronaldo|mbapp|neymar|lebron|drake|eminem|rihanna|kanye|diddy|epstein)\\b");
  for (const row of audit.records) {
    const text = row.prompt + '\n' + row.sourceTitle;
    assert.doesNotMatch(text, new RegExp(audit.contentScreen.real, 'i'));
    for (const match of text.matchAll(new RegExp(audit.contentScreen.block, 'gi'))) assert.equal(match[0].toLowerCase(), expected[row.sourceSlug], row.id);
  }
});
