// Owner-approved public identifier migration. No prompt edits, downloads or encoding.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { COMMUNITY_300_RECIPES } from '../app/veyrnox/_lib/sourceTemplateExpansion14Data.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { assertAvailablePublicIds } from './lib/template-public-id.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const checkOnly = process.argv.includes('--check');
const json = file => JSON.parse(readFileSync(resolve(root, file)));
const sha = data => createHash('sha256').update(data).digest('hex');
const write = (file, data) => {
  const path = resolve(root, file);
  if (checkOnly) assert.equal(readFileSync(path, 'utf8'), data, file + ': regenerate');
  else writeFileSync(path, data);
};
const writeJson = (file, data) => write(file, JSON.stringify(data, null, 2) + '\n');
const stageOneRenames = {
  'community-hoonigan-custom-swap': {id:'community-custom-drift-car-swap', name:'CUSTOM DRIFT CAR SWAP'},
  'community-vehicle-carjacking': {id:'community-chicken-bucket-swap', name:'CHICKEN BUCKET SWAP'},
};
const auditPath = 'docs/product/source-audit/higgsfield-300-exact-2026-11-05.json';
const audit = json(auditPath);
let recipes = COMMUNITY_300_RECIPES;
for (const [oldId, {id:newId, name:newName}] of Object.entries(stageOneRenames)) {
  const row = audit.records.find(r => r.id === oldId || r.id === newId);
  assert.ok(row);
  assertAvailablePublicIds([newId], Object.entries(SOURCE_PROMPT_RECORDS).filter(([, r]) => r.sourceMediaId === row.sourceMediaId).map(([id]) => id));
  assert.equal(sha(row.prompt), row.sourcePromptSha256);
  for (const [ext, hash] of [['mp4', row.localPreviewSha256], ['jpg', row.localPosterSha256]]) {
    const previous = resolve(root, `public/showcase/creator-${oldId}.${ext}`);
    const destination = resolve(root, `public/showcase/creator-${newId}.${ext}`);
    if (existsSync(previous)) {
      assert.equal(sha(readFileSync(previous)), hash);
      assert.equal(checkOnly, false, 'obsolete public media path');
      assert.equal(existsSync(destination), false, 'refusing to overwrite a second file');
      renameSync(previous, destination);
    }
    assert.equal(sha(readFileSync(destination)), hash);
  }
  row.id = newId;
  row.sourceSlug = oldId;
  row.publicName = newName;
  row.previewPath = `/showcase/creator-${newId}.mp4`;
  row.posterPath = `/showcase/creator-${newId}.jpg`;
  recipes = recipes.map(r => r.id === oldId || r.id === newId ? {...r, id:newId, name:newName} : r);

  for (const file of ['app/veyrnox/_lib/higgsfieldCommunityExpansion300Records.js', 'tests/fixtures/higgsfield300PromptHashes.mjs']) {
    const original = readFileSync(resolve(root, file), 'utf8');
    const updated = original.replace('  "' + oldId + '":', '  "' + newId + '":');
    assert.ok(updated.includes('  "' + newId + '":'));
    write(file, updated);
  }
  const showcasePath = 'docs/product/showcase-clips.md';
  write(showcasePath, readFileSync(resolve(root, showcasePath), 'utf8').replace('| `' + oldId + '` |', '| `' + newId + '` |'));
}
writeJson(auditPath, audit);
write('app/veyrnox/_lib/sourceTemplateExpansion14Data.js', '// Non-prompt metadata for the 300 captured community records.\nexport const COMMUNITY_300_RECIPES = Object.freeze([\n' + recipes.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]);\n');
const syntx = json('docs/product/source-audit/syntx-64-exact-2026-11-05.json');
const renames = Object.fromEntries(syntx.records.filter(r => r.id !== r.sourceSlug).map(r => [r.sourceSlug, {id:r.id, name:r.name}]));
assert.equal(Object.keys(renames).length, 11);
Object.assign(renames, stageOneRenames);
writeJson('tests/fixtures/publicTemplateIdRenames.json', renames);
const visualPath = 'tests/fixtures/exactOnlyVisualSignatures.json', visual = json(visualPath);
visual.placements = Object.fromEntries(Object.entries(visual.placements).map(([id, value]) => [renames[id]?.id || id, value]));
assert.equal(Object.keys(visual.placements).length, Object.keys(AUDIT_SHOWCASE_CLIPS).length);
writeJson(visualPath, visual);
// Keep historical hashes intact: tests reconstruct only these approved metadata
// differences before comparing against the frozen pre-change baseline.
for (const file of ['tests/fixtures/categoryFillBaseline.json', 'tests/fixtures/exactOnlyBaseline.json']) {
  const baseline = json(file);
  baseline.publicIdRenames = renames;
  writeJson(file, baseline);
}
const reviewedPath = 'tests/fixtures/exactOnlyReviewedMetadata.json', reviewed = json(reviewedPath);
for (const [old, current] of Object.entries(renames)) {
  if (old === 'community-hoonigan-custom-swap') reviewed[old] ||= {before:{name:'HOONIGAN CUSTOM SWAP'}, absentBefore:[], after:{name:current.name}};
  assert.ok(reviewed[old], old + ': rename must already have reviewed metadata');
  Object.assign(reviewed[old].before, {id:old, clipKey:old});
  Object.assign(reviewed[old].after, {id:current.id, clipKey:current.id});
}
writeJson(reviewedPath, reviewed);
console.log('Verified 13 neutral public identifiers; prompt/media hashes and frozen baseline hashes preserved.');
