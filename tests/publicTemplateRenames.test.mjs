import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { PRESETS, LEGACY_TEMPLATE_IDS, templateById } from '../app/veyrnox/_lib/templates.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { templateCards, templateDetail } from '../lib/clientTemplates.js';
import { toPublicPresets } from '../lib/publicPresets.js';
const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const audit = read('../docs/product/source-audit/syntx-64-exact-2026-11-05.json');
const renames = read('./fixtures/publicTemplateIdRenames.json');
const sha = data => createHash('sha256').update(data).digest('hex');
// The sole source-slug allow-list: these values belong only in provenance.
const SOURCE_SLUG_ALLOWLIST = {
  'jenner':'crowd-choreography-recast',
  'gentle-monster-disney':'sculptural-sunglasses-ad',
  'the-matrix':'rooftop-agent-pursuit',
  'alice-in-wonderland':'curious-garden-journey',
  'wonka-world':'chocolate-factory-flight',
  'tomb-rider':'ruins-escape-run',
  'breaking-good':'underground-lab-transformation',
  'vice-city-freefall':'neon-city-freefall',
  'pov-avatar':'alien-forest-flight',
  'the-dune':'desert-worm-flight',
  'drakula-cruise':'vampire-voyage',
};
const FORBIDDEN_PUBLIC_TERMS = ['jenner', 'disney', 'gentle-monster', 'matrix', 'wonka', 'alice', 'tomb-rider', 'tomb rider', 'breaking-good', 'vice-city', 'avatar', 'dune', 'drakula', 'dracula'];
const noSourceTerms = value => {
  for (const term of FORBIDDEN_PUBLIC_TERMS) assert.equal(value.toLowerCase().includes(term), false, value + ': ' + term);
};

test('all 63 Syntx public IDs, clip keys and shipped filenames are neutral; original slugs remain provenance', () => {
  assert.equal(audit.records.length, 63);
  assert.equal(Object.keys(SOURCE_SLUG_ALLOWLIST).length, 11);
  assert.deepEqual(Object.fromEntries(audit.records.filter(r => r.id !== r.sourceSlug).map(r => [r.sourceSlug, r.id])),
    Object.fromEntries(Object.entries(SOURCE_SLUG_ALLOWLIST).sort((a, b) => audit.records.findIndex(r => r.sourceSlug === a[0]) - audit.records.findIndex(r => r.sourceSlug === b[0]))));
  const files = readdirSync(new URL('../public/showcase/', import.meta.url));
  const projections = [PRESETS, templateCards(), toPublicPresets([])];
  for (const row of audit.records) {
    const template = SOURCE_TEMPLATES.find(t => t.id === row.id);
    const record = SOURCE_PROMPT_RECORDS[row.id];
    const clip = AUDIT_SHOWCASE_CLIPS[row.id];
    noSourceTerms(row.id); noSourceTerms(template.clipKey); noSourceTerms(template.name);
    assert.equal(template.clipKey, row.id);
    assert.equal(record.sourceSlug, row.sourceSlug);
    assert.equal(record.sourceTitle, row.sourceTitle);
    assert.equal(record.sourceMediaId, row.sourceMediaId);
    assert.equal(template.sourceUrl, 'https://syntx.ai/trends/' + row.sourceSlug);
    assert.equal(sha(record.prompt), row.sourcePromptSha256);
    for (const projection of projections) assert.ok(projection.some(t => t.id === row.id));
    assert.equal(templateDetail(row.id).id, row.id);
    for (const [ext, field, hash] of [['mp4', 'video', row.localPreviewSha256], ['jpg', 'poster', row.localPosterSha256]]) {
      const filename = 'creator-' + row.id + '.' + ext;
      noSourceTerms(filename);
      assert.ok(files.includes(filename));
      assert.equal(clip[field], '/showcase/' + filename);
      assert.equal(sha(readFileSync(new URL('../public/showcase/' + filename, import.meta.url))), hash);
    }
  }
  for (const [old, id] of Object.entries(SOURCE_SLUG_ALLOWLIST)) {
    assert.equal(renames[old].id, id);
    const row = audit.records.find(r => r.id === id);
    assert.equal(id, row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    assert.equal(row.sourceSlug, old);
    assert.equal(templateById(old), null);
    assert.equal(SOURCE_PROMPT_RECORDS[old], undefined);
    assert.equal(AUDIT_SHOWCASE_CLIPS[old], undefined);
    assert.equal(LEGACY_TEMPLATE_IDS.includes(old), false);
    for (const ext of ['mp4', 'jpg']) assert.equal(files.includes('creator-' + old + '.' + ext), false);
  }
});

test('the additional brand found in the 300-row scan has a neutral ID and name with unchanged source evidence', () => {
  const old = 'community-hoonigan-custom-swap', id = 'community-custom-drift-car-swap';
  const row = read('../docs/product/source-audit/higgsfield-300-exact-2026-11-05.json').records.find(r => r.id === id);
  assert.equal(templateById(id).name, 'CUSTOM DRIFT CAR SWAP');
  assert.equal(row.sourceTitle, 'Hoonigan Custom Swap');
  assert.equal(row.sourceSlug, old);
  assert.equal(sha(SOURCE_PROMPT_RECORDS[id].prompt), row.sourcePromptSha256);
  assert.equal(templateById(old), null);
  assert.equal(SOURCE_PROMPT_RECORDS[old], undefined);
  for (const [ext, hash] of [['mp4', row.localPreviewSha256], ['jpg', row.localPosterSha256]]) {
    assert.equal(existsSync(new URL('../public/showcase/creator-' + old + '.' + ext, import.meta.url)), false);
    assert.equal(sha(readFileSync(new URL('../public/showcase/creator-' + id + '.' + ext, import.meta.url))), hash);
  }
});

test('the chicken-bucket swap has a neutral public ID and unchanged source/media evidence', () => {
  const old = 'community-vehicle-carjacking', id = 'community-chicken-bucket-swap';
  const row = read('../docs/product/source-audit/higgsfield-300-exact-2026-11-05.json').records.find(r => r.id === id);
  assert.deepEqual(renames[old], {id, name:'CHICKEN BUCKET SWAP'});
  assert.equal(templateById(id).name, 'CHICKEN BUCKET SWAP');
  assert.equal(templateById(id).clipKey, id);
  assert.equal(row.sourceSlug, old);
  assert.equal(sha(SOURCE_PROMPT_RECORDS[id].prompt), row.sourcePromptSha256);
  assert.equal(templateById(old), null);
  assert.equal(SOURCE_PROMPT_RECORDS[old], undefined);
  assert.equal(AUDIT_SHOWCASE_CLIPS[old], undefined);
  for (const [ext, hash] of [['mp4', row.localPreviewSha256], ['jpg', row.localPosterSha256]]) {
    assert.equal(existsSync(new URL('../public/showcase/creator-' + old + '.' + ext, import.meta.url)), false);
    assert.equal(sha(readFileSync(new URL('../public/showcase/creator-' + id + '.' + ext, import.meta.url))), hash);
  }
});

test('public ID collision checks include aliases of Seedance metadata keys', async () => {
  const {assertAvailablePublicIds} = await import('../scripts/lib/template-public-id.mjs');
  const {SEEDANCE_200_TEMPLATE_METADATA} = await import('../app/veyrnox/_lib/seedanceTemplateMetadata.js');
  const {publicTemplateId} = await import('../app/veyrnox/_lib/templateIds.js');
  const keys = Object.keys(SEEDANCE_200_TEMPLATE_METADATA).filter(key => publicTemplateId(key) !== key);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.throws(() => assertAvailablePublicIds([publicTemplateId(key)], []), /collision/);
});
