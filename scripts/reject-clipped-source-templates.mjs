// Bounded, offline rejection of the reviewed clipped capture. No prompt edits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { templatesIn } from '../app/veyrnox/_lib/templates.js';
import { sourcePromptEnding } from './lib/source-prompt-endings.mjs';

const id = 'community-miniature-desktop-chase';
const hash = 'a252a7b07a5fdc4b37c598e3f187fe51ddea3799c13f5605591626e81d88410c';
const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (path, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (check) assert.equal(read(path), text, path + ': regenerate clipped rejection');
  else if (read(path) !== text) writeFileSync(new URL(path, root), text);
};
const path = 'docs/product/source-audit/higgsfield-300-exact-2026-11-05.json';
const audit = json(path);
const row = audit.records.find(r => r.id === id);
if (row) {
  assert.equal(sha(row.prompt), hash);
  assert.equal(sourcePromptEnding(row).status, 'clipped');
  assert.ok(templatesIn(row.category).length - 1 >= 10, 'Keep row if category minimum would fail');
  audit.rejected = [...(audit.rejected || []), {
    id, sourceRecordId: row.sourceRecordId, sourceVariantId: row.sourceVariantId,
    sourceMediaId: row.sourceMediaId, sourcePromptSha256: hash,
    sourceAssetSha256: row.sourceAssetSha256, localPreviewSha256: row.localPreviewSha256,
    localPosterSha256: row.localPosterSha256,
    reason: 'Incomplete source prompt ends with an unfinished environment/lighting list and a trailing comma.',
  }];
  audit.records = audit.records.filter(r => r.id !== id);
}
const rejected = audit.rejected.find(r => r.id === id);
assert.equal(rejected.sourcePromptSha256, hash);
audit.accepted = audit.records.length;
audit.addedBytes = audit.records.reduce((sum, r) => sum + r.localPreviewBytes + r.localPosterBytes, 0);
for (const key of Object.keys(audit.duplicateChecks)) audit.duplicateChecks[key] = audit.accepted;
const issues = {};
for (const r of audit.records) for (const issue of r.auditIssues) issues[issue] = (issues[issue] || 0) + 1;
audit.compatibility = { total: audit.accepted, compatible: audit.records.filter(r => r.auditCompatible).length,
  incompatible: audit.records.filter(r => !r.auditCompatible).length, issues };
write(path, audit);

for (const path of ['app/veyrnox/_lib/higgsfieldCommunityExpansion300Records.js',
  'app/veyrnox/_lib/sourceTemplateExpansion14Data.js', 'tests/fixtures/higgsfield300PromptHashes.mjs',
  'docs/product/showcase-clips.md']) {
  write(path, read(path).split('\n').filter(line => !line.includes('"' + id + '"') && !line.startsWith('| `' + id + '` |')).join('\n'));
}
const visualPath = 'tests/fixtures/exactOnlyVisualSignatures.json';
const visual = json(visualPath);
const baselinePath = 'tests/fixtures/categoryFillBaseline.json';
const baseline = json(baselinePath);
if (baseline.visualPlacementIds.includes(id)) {
  const old = Object.fromEntries(baseline.visualPlacementIds.map(key => [key, visual.placements[baseline.publicIdRenames[key]?.id || key] || baseline.rejectedVisualPlacements[key]]));
  assert.equal(sha(JSON.stringify(old)), baseline.visualPlacementsSha256, 'Verify original baseline before removing only the rejected placement');
  delete old[id];
  baseline.visualPlacementIds = baseline.visualPlacementIds.filter(key => key !== id);
  baseline.visualPlacementsSha256 = sha(JSON.stringify(old));
}
delete baseline.templates[id];
delete baseline.names[id];
baseline.retained = Object.keys(baseline.templates).length;
write(baselinePath, baseline);
delete visual.placements[id];
write(visualPath, visual);
const exactPath = 'tests/fixtures/exactOnlyBaseline.json';
const exact = json(exactPath);
delete exact.templates[id];
write(exactPath, exact);
for (const [ext, key] of [['mp4', 'localPreviewSha256'], ['jpg', 'localPosterSha256']]) {
  const file = new URL('public/showcase/creator-' + id + '.' + ext, root);
  if (existsSync(file)) {
    assert.equal(sha(readFileSync(file)), rejected[key], 'Refuse to remove changed media');
    assert.equal(check, false, 'Rejected media must be absent');
    rmSync(file);
  }
}
console.log('Clipped rejection verified: ' + id + '; retained capture records: ' + audit.accepted);
