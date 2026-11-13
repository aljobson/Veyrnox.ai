import { sourceMediaEntries, hasSourceMediaId } from './lib/source-record-media.mjs';
// Offline proof for the 2026-11-05 capture. Never downloads or encodes media.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { visualSignature } from './lib/source-visual-signature.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { HIGGSFIELD_300_PROMPT_SHA256 } from '../tests/fixtures/higgsfield300PromptHashes.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalizePrompt = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
export const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/higgsfield-300-exact-2026-11-05.json', import.meta.url)));
export const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/higgsfield300Baseline.json', import.meta.url)));
const visualFixture = JSON.parse(readFileSync(new URL('../tests/fixtures/exactOnlyVisualSignatures.json', import.meta.url)));
export const publicPath = path => resolve(root, 'public', path.replace(/^\//, '').replace(/-(?:higgs|syntx)-/, '-'));
// Unchanged pre-existing source-authentic duplicates, explicitly accepted by
// the host. The two additional pairs are allowed only after normalization;
// they must never become byte-identical or exempt any new record.
const EXACT_BASELINE_DUPLICATES = Object.freeze([
  'curtain-reveal|who-was-that-business',
  'event-character-swap|rap-takeover',
]);
export const BASELINE_SOURCE_AUTHENTIC_DUPLICATES = Object.freeze({
  promptHash: EXACT_BASELINE_DUPLICATES,
  normalizedPrompt: Object.freeze([
    ...EXACT_BASELINE_DUPLICATES,
    'i-am-here|somebody',
    'piano-vibe|wassup-freestyle',
  ]),
});

export function duplicateGroups(entries) {
  const groups = new Map();
  for (const [id, value] of entries) {
    if (value == null || value === '') continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(id);
  }
  return [...groups.values()].filter(ids => ids.length > 1).map(ids => ids.sort().join('|')).sort();
}

export function unexpectedDuplicateGroups(field, entries) {
  return duplicateGroups(entries).filter(group => !(
    BASELINE_SOURCE_AUTHENTIC_DUPLICATES[field]?.includes(group)
    && group.split('|').every(id => Object.hasOwn(baseline.templates, id)
      && !Object.hasOwn(HIGGSFIELD_300_PROMPT_SHA256, id))
  ));
}

export function uniquenessTables() {
  const records = SOURCE_TEMPLATES.map(t => [t.id, SOURCE_PROMPT_RECORDS[t.id]]).filter(([, r]) => r?.prompt);
  const knownMedia = new Map(sourceMediaEntries(SOURCE_PROMPT_RECORDS));
  for (const name of ['higgsfield-90-exact-2026-10-29', 'seedance-200-exact-2026-10-29', 'syntx-40-2026-10-29']) {
    const prior = JSON.parse(readFileSync(resolve(root, `docs/product/source-audit/${name}.json`)));
    for (const r of prior.records) if (hasSourceMediaId(r.sourceMediaId)) knownMedia.set(r.id, r.sourceMediaId);
  }
  const signatures = Object.fromEntries(Object.entries(visualFixture.placements).map(([id, row]) => [id, row.signature]));
  const tables = {
    id: SOURCE_TEMPLATES.map(t => [t.id, t.id]),
    name: SOURCE_TEMPLATES.map(t => [t.id, normalizePrompt(t.name)]),
    promptHash: records.map(([id, r]) => [id, sha256(r.prompt)]),
    normalizedPrompt: records.map(([id, r]) => [id, normalizePrompt(r.prompt)]),
    // The original 100 community UUIDs are recorded in showcase-clips.md,
    // not in their prompt table. Keep that evidence without title matching.
    mediaId: [...knownMedia, ...baseline.documentedCommunityMediaIds.map(id => [`documented:${id}`, id])],
    videoHash: Object.entries(AUDIT_SHOWCASE_CLIPS).map(([id, c]) => [id, sha256(readFileSync(publicPath(c.video)))]),
    posterHash: Object.entries(AUDIT_SHOWCASE_CLIPS).map(([id, c]) => [id, sha256(readFileSync(publicPath(c.poster)))]),
    visualSignature: Object.entries(signatures),
  };
  return Object.fromEntries(Object.entries(tables).map(([key, entries]) => [key, {
    checked: entries.length,
    unique: new Set(entries.map(([, value]) => value)).size,
    duplicates: duplicateGroups(entries),
    unexpected: unexpectedDuplicateGroups(key, entries),
  }]));
}

export function verifyNewHashes(inputDirectory) {
  let addedBytes = 0;
  for (const [id, hashes] of Object.entries(baseline.mediaHashes)) {
    for (const field of ['video', 'poster']) {
      assert.equal(sha256(readFileSync(publicPath(AUDIT_SHOWCASE_CLIPS[id][field]))), hashes[field], `${id}: original ${field} is unchanged`);
    }
  }
  const manifest = inputDirectory && JSON.parse(readFileSync(resolve(inputDirectory, 'manifest.json')));
  const encodes = inputDirectory && JSON.parse(readFileSync(resolve(inputDirectory, 'encode-report.json')));
  if (inputDirectory) {
    assert.equal(sha256(readFileSync(resolve(inputDirectory, 'manifest.json'))), audit.manifestSha256);
    assert.equal(sha256(readFileSync(resolve(inputDirectory, 'encode-report.json'))), audit.encodeReportSha256);
    assert.equal(manifest.length, 300);
    assert.equal(encodes.length, 300);
  }
  for (const r of audit.records) {
    assert.ok(!baseline.documentedCommunityMediaIds.includes(r.sourceMediaId), `${r.id}: already documented source media`);
    assert.equal(sha256(SOURCE_PROMPT_RECORDS[r.id].prompt), HIGGSFIELD_300_PROMPT_SHA256[r.id], `${r.id}: raw prompt`);
    assert.equal(sha256(r.prompt), HIGGSFIELD_300_PROMPT_SHA256[r.id], `${r.id}: audit prompt`);
    assert.equal(sha256(normalizePrompt(r.prompt)), r.normalizedPromptSha256, r.id);
    for (const [path, hash, bytes, cap] of [
      [r.previewPath, r.localPreviewSha256, r.localPreviewBytes, 6 * 1024 * 1024],
      [r.posterPath, r.localPosterSha256, r.localPosterBytes, 80 * 1024],
    ]) {
      const data = readFileSync(publicPath(path));
      assert.equal(sha256(data), hash, `${r.id}: shipped asset`);
      assert.equal(data.length, bytes, r.id);
      assert.ok(bytes <= cap, r.id);
      addedBytes += bytes;
    }
    if (inputDirectory) {
      const m = manifest.find(m => m.itemId === r.sourceRecordId);
      const e = encodes.find(e => e.mediaId === r.sourceMediaId);
      assert.ok(m && e, r.id);
      assert.equal(m.variantId, r.sourceVariantId, r.id);
      assert.equal(m.mediaId, r.sourceMediaId, r.id);
      assert.equal(m.prompt, r.prompt, r.id);
      assert.equal(m.promptSha256, HIGGSFIELD_300_PROMPT_SHA256[r.id], r.id);
      assert.equal(m.sourceVideoUrl, r.sourceMediaUrl, r.id);
      assert.equal(sha256(readFileSync(resolve(inputDirectory, 'media', m.videoFile))), r.sourceAssetSha256, r.id);
      assert.equal(e.sourceSha256, r.sourceAssetSha256, r.id);
      assert.equal(e.startSeconds, r.startSeconds, r.id);
      for (const [ext, key, expected] of [['mp4', 'videoSha256', r.localPreviewSha256], ['jpg', 'posterSha256', r.localPosterSha256]]) {
        assert.equal(e[key], expected, r.id);
        assert.equal(sha256(readFileSync(resolve(inputDirectory, 'encoded', `${r.sourceMediaId}.${ext}`))), expected, r.id);
      }
    }
  }
  assert.equal(addedBytes, audit.addedBytes);
  return addedBytes;
}

export function verifyVisualSignatures() {
  // The exact-only expansion uses the explicitly documented ffprobe-only method
  // across all placements. Earlier raw-frame hashes stay in their audit files.
  const actual = [];
  for (const [id, clip] of Object.entries(AUDIT_SHOWCASE_CLIPS)) {
    const value = visualSignature(publicPath(clip.video));
    assert.deepEqual(value, visualFixture.placements[id], `${id}: normalized visual signature`);
    actual.push([id, value.signature]);
    if (actual.length % 100 === 0) console.log(`Verified ${actual.length} visual signatures`);
  }
  assert.deepEqual(duplicateGroups(actual), []);
  return actual.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputIndex = process.argv.indexOf('--input');
  console.log(`Verified new hashes; added bytes: ${verifyNewHashes(inputIndex < 0 ? undefined : process.argv[inputIndex + 1])}`);
  if (process.argv.includes('--visual')) console.log(`Verified ${verifyVisualSignatures()} distinct visual signatures`);
  const tables = uniquenessTables();
  console.log(JSON.stringify(tables, null, 2));
  assert.deepEqual(Object.entries(tables).filter(([, value]) => value.unexpected.length), [], 'Unexpected corpus duplicates');
}
