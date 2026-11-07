import { HF_REPLACEMENTS_RECORDS } from '../app/veyrnox/_lib/higgsfieldReplacementRecords.js';
import { SYNTX_REPLACEMENTS_RECORDS } from '../app/veyrnox/_lib/syntxReplacementRecords.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicPromptHygiene, promptHygieneKinds } from '../scripts/lib/public-prompt-hygiene.mjs';
import { HIGGSFIELD_300_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/higgsfieldCommunityExpansion300Records.js';
import { SYNTX_64_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptExpansion64Records.js';
import { HIGGSFIELD_CATEGORY_FILL_RECORDS } from '../app/veyrnox/_lib/higgsfieldCategoryFillRecords.js';
import { referenceCount } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { sourceReferenceGaps, sourceReferenceGapKinds } from '../scripts/lib/source-reference-gaps.mjs';
import { sourcePromptEnding, sourcePromptEndingReview } from '../scripts/lib/source-prompt-endings.mjs';
import { REVIEWED_AMBIGUOUS_ENDINGS } from '../scripts/lib/reviewed-ambiguous-endings.mjs';

test('every detected raw-prompt hygiene match is inventoried without altering captured text', () => {
  for (const [name, records, count] of [
    ['higgsfield-300-exact', HIGGSFIELD_300_SOURCE_PROMPT_RECORDS, 299],
    ['syntx-64-exact', SYNTX_64_SOURCE_PROMPT_RECORDS, 63],
    ['higgsfield-category-fill-30', HIGGSFIELD_CATEGORY_FILL_RECORDS, 28],
    ['higgsfield-replacements-12', HF_REPLACEMENTS_RECORDS, 11],
    ['syntx-replacements-4', SYNTX_REPLACEMENTS_RECORDS, 3],
  ]) {
    assert.equal(Object.keys(records).length, count);
    const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/' + name + (name.includes('replacements') ? '-2026-11-07.json' : '-2026-11-05.json'), import.meta.url)));
    assert.deepEqual(audit.publicPromptHygiene, publicPromptHygiene(Object.entries(records).map(([id, r]) => ({id, prompt:r.prompt}))), name);
  }
  assert.deepEqual(promptHygieneKinds(HIGGSFIELD_300_SOURCE_PROMPT_RECORDS['community-interactive-ar-showroom'].prompt), ['address', 'handle']);
  assert.deepEqual(promptHygieneKinds(HIGGSFIELD_CATEGORY_FILL_RECORDS['community-macro-product-montage'].prompt), ['domain', 'promo code']);
  assert.deepEqual(promptHygieneKinds('@example_person social.person https://example.com Boelckestr. 38, 55252 Mainz-Kastel license plate KZ 669 BJP 02 Code: example20 upload.jpg'), ['address', 'domain', 'handle', 'plate', 'promo code', 'upload filename']);
  assert.deepEqual(promptHygieneKinds('@image1 @Video <<<image_2>>> pattern.No lens.Horizontal'), []);
});

test('shared source audit parser includes all four reference-number conventions', () => {
  for (const text of ['@image3', '<<<image_3>>>', 'image 3', 'image_3.png']) assert.equal(referenceCount(text, 'image'), 3);
  assert.equal(referenceCount('video_2.mov', 'video'), 2);
});

test('source-reference-gaps inventory equals the detector across all five captures', () => {
  const ids = [];
  for (const [name, records, expected] of [
    ['higgsfield-300-exact', HIGGSFIELD_300_SOURCE_PROMPT_RECORDS, 17],
    ['syntx-64-exact', SYNTX_64_SOURCE_PROMPT_RECORDS, 1],
    ['higgsfield-category-fill-30', HIGGSFIELD_CATEGORY_FILL_RECORDS, 2],
    ['higgsfield-replacements-12', HF_REPLACEMENTS_RECORDS, 0],
    ['syntx-replacements-4', SYNTX_REPLACEMENTS_RECORDS, 0],
  ]) {
    const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/' + name + (name.includes('replacements') ? '-2026-11-07.json' : '-2026-11-05.json'), import.meta.url)));
    const input = audit.records.map(r => ({ id: r.id, prompt: records[r.id].prompt, inputAssetCount: r.inputAssetCount }));
    assert.deepEqual(audit['source-reference-gaps'], sourceReferenceGaps(input), name);
    assert.equal(audit['source-reference-gaps'].count, expected, name);
    ids.push(...audit['source-reference-gaps'].inventory.map(r => r.id));
  }
  for (const id of ['grab-heist', 'community-cabin-rhythm-duo', 'community-tactical-gear-montage', 'community-model-vehicle-swap']) assert.ok(ids.includes(id), id);
  for (const text of ['face from .', 'man with ,', 'composition of .', '= CHARACTER 1', 'If already contains glasses', 'Replace the man in with person']) assert.ok(sourceReferenceGapKinds(text).length, text);
  for (const text of ['Slow push-in. Fade-in and pan.', 'Use the man from @image1.', 'Eight uploaded references show the same face.']) assert.deepEqual(sourceReferenceGapKinds(text), [], text);
  assert.deepEqual(sourceReferenceGaps([{ id: 'valid', prompt: 'Use the uploaded image.', inputAssetCount: 8 }]).inventory, [], 'asset count alone never invents a gap');
});

test('ending triage keeps ambiguous and origin-stripped endings and rejects only the reviewed clipped list', () => {
  const records = [HIGGSFIELD_300_SOURCE_PROMPT_RECORDS, SYNTX_64_SOURCE_PROMPT_RECORDS, HIGGSFIELD_CATEGORY_FILL_RECORDS, HF_REPLACEMENTS_RECORDS, SYNTX_REPLACEMENTS_RECORDS];
  const endings = records.flatMap(batch => sourcePromptEndingReview(Object.entries(batch).map(([id, r]) => ({ id, prompt: r.prompt }))).inventory);
  assert.deepEqual(endings.filter(r => r.status === 'clipped'), []);
  const dragon = endings.find(r => r.id === 'community-dragon-summoner');
  assert.equal(dragon.status, 'ambiguous');
  assert.equal(dragon.tail, HIGGSFIELD_300_SOURCE_PROMPT_RECORDS[dragon.id].prompt.trimEnd().slice(-80));
  for (const id of ['community-skyline-delivery', 'community-formal-dance-swap', 'community-alleyway-dance-crew']) {
    assert.match(endings.find(r => r.id === id).reason, /origin-stripped/);
  }
  assert.equal(sourcePromptEnding({ id: 'clipped', prompt: 'Keep the environment, lighting,' }).status, 'clipped');
  assert.equal(sourcePromptEnding({ id: 'connector', prompt: 'Keep the lighting and' }).status, 'ambiguous');
  assert.deepEqual(sourceReferenceGapKinds('Keep the lighting and'), [], 'connector decision does not require an origin gap');
  assert.equal(sourcePromptEnding({ id: 'complete-list', prompt: 'Requirements:\n- No text anywhere' }), null);
  assert.equal(sourcePromptEnding({ id: dragon.id, prompt: HIGGSFIELD_300_SOURCE_PROMPT_RECORDS[dragon.id].prompt }), null, 'generic detector does not encode a named record judgment');
});

test('ending-review inventories equal the detector and reviewed list across all five captures', () => {
  let unpunctuated = 0;
  const reviewed = [];
  for (const [name, records] of [
    ['higgsfield-300-exact', HIGGSFIELD_300_SOURCE_PROMPT_RECORDS],
    ['syntx-64-exact', SYNTX_64_SOURCE_PROMPT_RECORDS],
    ['higgsfield-category-fill-30', HIGGSFIELD_CATEGORY_FILL_RECORDS],
    ['higgsfield-replacements-12', HF_REPLACEMENTS_RECORDS],
    ['syntx-replacements-4', SYNTX_REPLACEMENTS_RECORDS],
  ]) {
    const audit = JSON.parse(readFileSync(new URL('../docs/product/source-audit/' + name + (name.includes('replacements') ? '-2026-11-07.json' : '-2026-11-05.json'), import.meta.url)));
    const output = sourcePromptEndingReview(Object.entries(records).map(([id, r]) => ({ id, prompt: r.prompt })));
    assert.deepEqual(audit['ending-review'], output, name);
    unpunctuated += output.ambiguousUnpunctuatedCount;
    reviewed.push(...output.inventory.filter(r => r.kind === 'reviewed').map(({ id, reason }) => ({ id, reason })));
  }
  assert.equal(unpunctuated, 74);
  assert.deepEqual(reviewed, REVIEWED_AMBIGUOUS_ENDINGS, 'every separately reviewed ID is present exactly once');
});

for (const script of ['sync-template-corpus.mjs', 'sync-public-prompt-hygiene.mjs', 'reject-clipped-source-templates.mjs', 'sync-template-public-ids.mjs']) {
  test(script + ' --check keeps generated documentation and inventories current', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/' + script, import.meta.url)), '--check'], {
      cwd:fileURLToPath(new URL('../', import.meta.url)), encoding:'utf8', timeout:30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
