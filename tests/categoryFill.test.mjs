import { GENJUTSU_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/genjutsuSourcePromptRecords.js';
import { HIGGSFIELD_90_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/higgsfieldCommunityExpansion90Records.js';
import { HIGGSFIELD_300_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/higgsfieldCommunityExpansion300Records.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { SEEDANCE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/seedanceSourcePromptRecords.js';
import { SYNTX_64_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptExpansion64Records.js';
import { HIGGSFIELD_CATEGORY_FILL_RECORDS } from '../app/veyrnox/_lib/higgsfieldCategoryFillRecords.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { CATEGORY_FILL_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplateExpansion16.js';
import { templateById, hasTemplateVideo } from '../app/veyrnox/_lib/templates.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const audit = json('../docs/product/source-audit/higgsfield-category-fill-30-2026-11-05.json');
const hashes = json('./fixtures/categoryFillPromptHashes.json');
const baseline = json('./fixtures/categoryFillBaseline.json');
const visual = json('./fixtures/exactOnlyVisualSignatures.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const reviewed = json('./fixtures/exactOnlyReviewedMetadata.json');
const ids = new Set(audit.records.map(r => r.id));

test('category fill preserves the 800 surviving baseline templates and their visual signatures', () => {
  // There were 801 templates before Amendment 1. The stage-1 row
  // community-miniature-desktop-chase was rejected afterwards; this rewritten
  // baseline contains the 800 that remained.
  assert.equal(baseline.retained, 800);
  assert.equal(Object.keys(baseline.templates).length, 800);
  for (const [id, hash] of Object.entries(baseline.templates)) {
    if (id === 'dark-couture') { assert.equal(SOURCE_TEMPLATES.some(t => t.id === id), false); continue; }
    const current = SOURCE_TEMPLATES.find(t => t.id === (baseline.publicIdRenames[id]?.id || id));
    const original = {...current};
    if (reviewed[id]) {
      for (const [key, value] of Object.entries(reviewed[id].after)) assert.deepEqual(current[key], value, id + ': approved ' + key);
      Object.assign(original, reviewed[id].before);
      for (const key of reviewed[id].absentBefore) delete original[key];
    }
    assert.equal(sha(JSON.stringify(original)), hash, id);
  }
  assert.equal(baseline.visualPlacementIds.length, 890);
  const oldPlacements = Object.fromEntries(baseline.visualPlacementIds.map(id => [id, visual.placements[baseline.publicIdRenames[id]?.id || id] || baseline.rejectedVisualPlacements[id]]));
  assert.equal(sha(JSON.stringify(oldPlacements)), baseline.visualPlacementsSha256);
  assert.deepEqual(Object.keys(visual.placements).sort(), Object.keys(AUDIT_SHOWCASE_CLIPS).sort());
  assert.equal(new Set(Object.values(visual.placements).map(v => v.signature)).size, 917);
});

test('28 accepted category records preserve exact text, manifest categories and existing model guidance', () => {
  assert.equal(audit.requested, 30);
  assert.equal(audit.accepted, 28);
  assert.equal(audit.records.length, 28);
  assert.equal(CATEGORY_FILL_TEMPLATES.length, 28);
  assert.equal(Object.keys(hashes).length, 28);
  assert.deepEqual(Object.fromEntries(['ANIME', 'ADS', 'YOUR PHOTO'].map(category =>
    [category, audit.records.filter(r => r.category === category).length])), { ANIME: 6, ADS: 11, 'YOUR PHOTO': 10 });
  let bytes = 0;
  for (const r of audit.records) {
    const raw = SOURCE_PROMPT_RECORDS[r.id], template = templateById(r.id);
    assert.equal(sha(raw.prompt), hashes[r.id], r.id);
    assert.equal(sha(r.prompt), hashes[r.id], r.id);
    assert.equal(r.sourcePromptSha256, hashes[r.id], r.id);
    assert.equal(sha(r.prompt.trim().replace(/\s+/g, ' ').toLowerCase()), r.normalizedPromptSha256, r.id);
    for (const field of ['sourceRecordId', 'sourceVariantId', 'sourceMediaId', 'sourceTitle']) assert.equal(raw[field], r[field], r.id);
    assert.equal(template.category, r.category, r.id);
    assert.equal(template.model, 'Kling 3.0 · I2V', r.id);
    assert.equal(template.credits, 32, r.id);
    assert.equal(template.durationSeconds, 10, r.id);
    assert.equal(template.sourceAspect, r.sourceAspect, r.id);
    assert.equal(template.previewAspect, r.previewAspect, r.id);
    assert.equal(template.needsKey, r.needsKey, r.id);
    assert.equal(template.needs, {
      'community.group': 'One starting image containing every subject in their intended positions',
      'community.products': 'A clear image of the subject and featured vehicle or product',
      'community.cartoons': 'A clear full-body animal or original character image',
      'community.cinematic': 'A clear full-body portrait with room for cinematic movement',
    }[r.needsKey], r.id);
    if (r.group) assert.equal(r.needsKey, 'community.group', r.id);
    else if (r.category === 'ADS') assert.equal(r.needsKey, 'community.products', r.id);
    assert.equal(template.prompt, exactSourcePromptRecord(r.id).prompt, r.id);
    assert.equal(templateDetail(r.id).prompt, template.prompt, r.id);
    assert.equal(template.sourcePrompt, template.prompt, r.id);
    assert.equal(template.promptOrigin, 'community-source-exact', r.id);
    assert.equal(template.sourcePromptOrigin, 'community-source-exact', r.id);
    assert.equal(template.negativePrompt, undefined, r.id);
    assert.ok(hasTemplateVideo(template), r.id);
    const sourceAudit = sourcePromptAuditRecord(r.id);
    assert.equal(sourceAudit.referenceImageCount, r.referenceImageCount, r.id);
    assert.equal(sourceAudit.referenceVideoCount, r.referenceVideoCount, r.id);
    assert.equal(r.sourceVideoSignature, visual.placements[r.id].signature, r.id);
    assert.equal(r.signatureFrameCount, 5, r.id);
    for (const [path, hash, size, cap] of [[r.previewPath, r.localPreviewSha256, r.localPreviewBytes, 6 * 1024 * 1024], [r.posterPath, r.localPosterSha256, r.localPosterBytes, 80 * 1024]]) {
      const data = readFileSync(new URL('../public' + path, import.meta.url));
      assert.equal(sha(data), hash, r.id);
      assert.equal(data.length, size, r.id);
      assert.ok(size <= cap, r.id);
      bytes += size;
    }
    const media = readFileSync(new URL('../public' + r.previewPath, import.meta.url));
    const pos = media.indexOf('mvhd');
    assert.ok(pos > 0, r.id);
    const version = media[pos + 4];
    const timescale = media.readUInt32BE(pos + (version === 1 ? 24 : 16));
    const duration = version === 1 ? Number(media.readBigUInt64BE(pos + 28)) : media.readUInt32BE(pos + 20);
    assert.ok(Math.abs(duration / timescale - 5) < 0.11, r.id);
    let offset = 0, videoHandlers = 0;
    while ((offset = media.indexOf('hdlr', offset)) !== -1) {
      const handler = media.toString('ascii', offset + 12, offset + 16);
      assert.notEqual(handler, 'soun', r.id);
      if (handler === 'vide') videoHandlers++;
      offset += 4;
    }
    assert.equal(videoHandlers, 1, r.id);
    assert.equal(r.startSeconds, 0, r.id);
  }
  assert.equal(bytes, audit.addedBytes);
});

test('the category batch joins no existing prompt, record, media, name or visual duplicate', () => {
  const previousAudits = ['higgsfield-90-exact-2026-10-29', 'seedance-200-exact-2026-10-29', 'syntx-40-2026-10-29', 'higgsfield-300-exact-2026-11-05', 'syntx-64-exact-2026-11-05']
    .flatMap(name => json('../docs/product/source-audit/' + name + '.json').records);
  const previousRecords = Object.entries(SOURCE_PROMPT_RECORDS).filter(([id]) => !ids.has(id)).map(([, r]) => r);
  for (const field of ['sourceRecordId', 'sourceVariantId', 'sourceMediaId', 'sourceAssetSha256', 'localPreviewSha256', 'localPosterSha256']) {
    const known = new Set([...previousAudits, ...previousRecords].map(r => r[field]).filter(Boolean));
    assert.equal(new Set(audit.records.map(r => r[field])).size, 28, field);
    for (const r of audit.records) assert.equal(known.has(r[field]), false, r.id + ': ' + field);
  }
  for (const normalize of [value => value, value => value.trim().replace(/\s+/g, ' ').toLowerCase()]) {
    const known = new Set(previousRecords.filter(r => r.prompt).map(r => sha(normalize(r.prompt))));
    const added = new Set();
    for (const r of audit.records) {
      const hash = sha(normalize(r.prompt));
      assert.equal(known.has(hash) || added.has(hash), false, r.id);
      added.add(hash);
    }
  }
  for (const field of ['id', 'name']) {
    const previous = [...Object.entries(baseline.names).map(([id, name]) => ({id, name})), ...baseline.independentNames];
    const known = new Set(previous.map(r => r[field].toLowerCase()));
    const added = new Set();
    for (const r of CATEGORY_FILL_TEMPLATES) {
      const value = r[field].toLowerCase();
      assert.equal(known.has(value) || added.has(value), false, r.id + ': ' + field);
      added.add(value);
    }
  }
});

test('the incomplete record remains rejected, with hashes but no prompt or media copied', () => {
  assert.deepEqual(audit.rejected.map(r => r.id).sort(), ['community-anime-court-match', 'community-archery-face-swap']);
  for (const rejected of audit.rejected) {
  assert.match(rejected.reason, /Incomplete/);
  assert.equal(Object.hasOwn(rejected, 'prompt'), false);
  assert.equal(Object.hasOwn(SOURCE_PROMPT_RECORDS, rejected.id), false);
  assert.equal(templateById(rejected.id), null);
  for (const ext of ['mp4', 'jpg']) assert.equal(existsSync(new URL('../public/showcase/creator-' + rejected.id + '.' + ext, import.meta.url)), false);
  }
});

test('source record registry contains every module key without collisions', () => {
  const modules = [GENJUTSU_SOURCE_PROMPT_RECORDS, HIGGSFIELD_90_SOURCE_PROMPT_RECORDS, HIGGSFIELD_300_SOURCE_PROMPT_RECORDS, SYNTX_SOURCE_PROMPT_RECORDS, SEEDANCE_SOURCE_PROMPT_RECORDS, SYNTX_64_SOURCE_PROMPT_RECORDS, HIGGSFIELD_CATEGORY_FILL_RECORDS];
  assert.equal(Object.keys(SOURCE_PROMPT_RECORDS).length, modules.reduce((sum, records) => sum + Object.keys(records).length, 0));
});
