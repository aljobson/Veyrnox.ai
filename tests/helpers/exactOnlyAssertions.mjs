import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SOURCE_TEMPLATES } from '../../app/veyrnox/_lib/sourceTemplates.js';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../../app/veyrnox/_lib/sourcePromptRecords.js';
import { ALL_TEMPLATES, PRESETS, WALL_PRESETS, WALL_CLIP_KEYS, REMOVED_PROMPT_GAP_TEMPLATE_IDS, templateById, hasTemplateVideo } from '../../app/veyrnox/_lib/templates.js';
import { EFFECT_CONCEPT_TEMPLATES } from '../../app/veyrnox/_lib/effectConceptTemplates.js';
import { REFERENCE_TEMPLATES } from '../../app/veyrnox/_lib/referenceTemplates.js';
import { AUDIT_SHOWCASE_CLIPS, SHOWCASE_CLIPS, WALL_SHOWCASE_KEYS } from '../../app/veyrnox/_lib/showcase.js';
import { templateDetail, templateCards, searchTemplateIds } from '../../lib/clientTemplates.js';
import { toPublicPresets } from '../../lib/publicPresets.js';
import { isUnknownStaticPage } from '../../lib/unknownStaticPage.js';
import { runnableTemplates } from '../../app/veyrnox/_lib/runnableTemplates.js';
import { MODELS, FEATURE_CARDS } from '../../app/veyrnox/_lib/tokens.js';
import { publicTemplateId } from '../../app/veyrnox/_lib/templateIds.js';
import { fixture } from './publicSiteRender.mjs';
import { duplicateGroups, unexpectedDuplicateGroups, publicPath } from '../../scripts/audit-higgsfield-300.mjs';
const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');
const audit = json('../../docs/product/source-audit/syntx-64-exact-2026-11-05.json');
const hashes = json('../fixtures/syntx64PromptHashes.json');
const visual = json('../fixtures/exactOnlyVisualSignatures.json');
const removed = new Set(json('../fixtures/removedCommunityPromptHashes.json'));
function strings(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}
function mobileParser() {
  const mocks = { './i18n': { t: key => key }, './api': { API_BASE: 'https://veyrnox.ai', ApiError: Error }, './templateChoices': {} };
  const f = fixture('en', '/presets', { moduleMocks: mocks });
  mocks['./templateHandoff'] = f.load('apps/mobile/src/lib/templateHandoff.ts');
  return f.load('apps/mobile/src/lib/presets.ts');
}

test('every public community projection serves one exact prompt and no removed adaptation field', () => {
  assert.equal(removed.size, 793);
  for (const record of Object.values(SOURCE_PROMPT_RECORDS)) if (record.prompt) assert.equal(removed.has(sha(record.prompt)), false);
  const communityIds = new Set(SOURCE_TEMPLATES.map(t => publicTemplateId(t.id)));
  // Serialize every preview-backed template, not only the capped gallery (2026-11-14) the route lists.
  const rows = toPublicPresets([], PRESETS);
  for (const t of ALL_TEMPLATES.filter(t => communityIds.has(t.id))) {
    for (const p of [t, templateDetail(t.id), rows.find(p => p.id === t.id)]) {
      assert.ok(p, t.id);
      assert.equal(p.prompt, exactSourcePromptRecord(t.id).prompt, t.id);
      assert.equal(p.sourcePrompt, p.prompt, t.id);
      assert.equal(p.promptOrigin, 'community-source-exact', t.id);
      assert.equal(p.sourcePromptOrigin, 'community-source-exact', t.id);
      assert.equal(p.preferAdaptedPrompt, undefined, t.id);
      assert.equal(p.negativePrompt, undefined, t.id);
      for (const value of strings(p)) assert.equal(removed.has(sha(value)), false, t.id);
    }
  }
  // Scan independent catalogs too: none may accidentally re-expose a removed community adaptation.
  for (const value of strings([ALL_TEMPLATES, rows, templateCards()])) assert.equal(removed.has(sha(value)), false);
  for (const id of REMOVED_PROMPT_GAP_TEMPLATE_IDS) {
    const t = SOURCE_TEMPLATES.find(t => t.id === id);
    assert.equal(t.prompt, null, id);
    assert.equal(t.sourcePrompt, null, id);
    assert.equal(t.negativePrompt, undefined, id);
  }
});

test('all 70 hidden ids and rejected captures are absent from lists, detail, search, sitemap, roller and native mapping; direct pages 404', async () => {
  const rows = toPublicPresets([]), mobile = mobileParser().parsePresets({ presets: rows });
  const mocks = { 'next/navigation': { notFound() { throw new Error('404'); }, permanentRedirect() { throw new Error('unexpected redirect'); } },
    '../../_lib/templates': { ALL_TEMPLATES, templateById }, '../../../../lib/clientTemplates.js': { templateDetail },
    '../lib/publicCatalog.js': { readPublicCatalog: async () => [] }, './veyrnox/_lib/modelPages': { listModelsForDetails: async () => [], shelfModels: () => [] } };
  const f = fixture('en', '/presets', { moduleMocks: mocks });
  const page = f.load('app/veyrnox/presets/[id]/page.js');
  const api = f.load('app/api/templates/[id]/route.js');
  const sitemap = await f.load('app/sitemap.js').default();
  const collections = [PRESETS, ALL_TEMPLATES, WALL_PRESETS, rows, mobile, templateCards(), runnableTemplates(templateCards(), MODELS).map(r => r.preset)];
  const rejectedIds = ['higgsfield-300-exact', 'syntx-64-exact', 'higgsfield-category-fill-30'].flatMap(name => json('../../docs/product/source-audit/' + name + '-2026-11-05.json').rejected.map(r => r.id)).concat(['higgsfield-replacements-12', 'syntx-replacements-4'].flatMap(name => json('../../docs/product/source-audit/' + name + '-2026-11-07.json').rejected.map(r => r.id)));
  for (const id of [...REMOVED_PROMPT_GAP_TEMPLATE_IDS, ...rejectedIds]) {
    for (const list of collections) assert.equal(list.some(t => t.id === publicTemplateId(id)), false, id);
    assert.equal(templateDetail(id), null, id);
    assert.equal(searchTemplateIds(id.replaceAll('-', ' ')).includes(id), false, id);
    assert.equal(sitemap.some(row => row.url.endsWith(`/presets/${id}`)), false, id);
    assert.equal(isUnknownStaticPage(`/presets/${id}`), true, id);
    await assert.rejects(page.default({ params: Promise.resolve({ id }) }), /404/);
    assert.equal((await api.GET(null, { params: Promise.resolve({ id }) })).status, 404, id);
  }
});

test('independent catalogs retain all 1036 plus 6 direct recipes, detail responses and existing list/preview membership', async () => {
  assert.equal(EFFECT_CONCEPT_TEMPLATES.length, 1036);
  assert.equal(REFERENCE_TEMPLATES.length, 6);
  for (const catalog of [EFFECT_CONCEPT_TEMPLATES, REFERENCE_TEMPLATES]) {
    for (const row of catalog) {
      assert.deepEqual(templateById(row.id), row, row.id);
      assert.equal(templateDetail(row.id).prompt, row.prompt, row.id);
      assert.equal(PRESETS.some(t => t.id === row.id), false, 'these catalogs had no video-backed list rows');
      assert.equal(hasTemplateVideo(row), false, row.id);
    }
    const sample = catalog[0];
    const f = fixture('en', `/presets/${sample.id}`, { moduleMocks: { '../../_lib/templates': { ALL_TEMPLATES, templateById }, '../../../../lib/clientTemplates.js': { templateDetail } } });
    assert.ok(f.render(await f.load('app/veyrnox/presets/[id]/page.js').default({ params: Promise.resolve({ id: sample.id }) })));
    const response = await f.load('app/api/templates/[id]/route.js').GET(null, { params: Promise.resolve({ id: sample.id }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).template.prompt, sample.prompt);
  }
});

test('clip publication follows owners while event swap and independent model landing retain their previews', () => {
  const event = templateById('event-character-swap');
  assert.equal(event.clipKey, 'wall-event-character-swap');
  assert.equal(hasTemplateVideo(event), true);
  assert.ok(PRESETS.includes(event));
  assert.ok(WALL_PRESETS.includes(event));
  assert.equal(templateById('miniature-crew-wall'), null);
  assert.equal(SHOWCASE_CLIPS['wall-product-hero-360'], undefined);
  assert.ok(AUDIT_SHOWCASE_CLIPS['wall-product-hero-360']);
  for (const key of ['model-video', ...FEATURE_CARDS.map(card => card.key)]) assert.ok(SHOWCASE_CLIPS[key]?.video, key);
});

test('63 accepted records lock raw text, shipped hashes, silent five-second media and whole-corpus uniqueness', () => {
  assert.equal(audit.records.length, 63);
  assert.equal(visual.method, audit.visualSignatureMethod);
  assert.equal(Object.keys(visual.placements).length, Object.keys(AUDIT_SHOWCASE_CLIPS).length);
  assert.equal(new Set(Object.values(visual.placements).map(v => v.signature)).size, Object.keys(AUDIT_SHOWCASE_CLIPS).length);
  assert.equal(audit.records.filter(r => r.sourceModel.startsWith('Seedance')).length, 51);
  assert.equal(Object.keys(hashes).length, 63);
  assert.equal(audit.records.filter(r => r.needsKey === 'community.copyOnly').length, 47);
  assert.equal(audit.records.filter(r => r.needsKey === null).length, 16);
  const olderAudits = ['syntx-40-2026-10-29', 'seedance-200-exact-2026-10-29', 'higgsfield-90-exact-2026-10-29', 'higgsfield-300-exact-2026-11-05'].flatMap(name => json(`../../docs/product/source-audit/${name}.json`).records);
  const addedIds = new Set(audit.records.map(r => r.id));
  const oldRecords = [...olderAudits, ...Object.entries(SOURCE_PROMPT_RECORDS).filter(([id]) => !addedIds.has(id)).map(([,r]) => r)];
  for (const field of ['sourceRecordId', 'sourceMediaId', 'sourceAssetSha256']) {
    const known = new Set(oldRecords.map(r => r[field]).filter(Boolean));
    assert.equal(new Set(audit.records.map(r => r[field])).size, 63, field);
    for (const r of audit.records) assert.equal(known.has(r[field]), false, `${r.id}: ${field}`);
  }
  const records = SOURCE_TEMPLATES.map(t => [t.id, SOURCE_PROMPT_RECORDS[t.id]]).filter(([,r]) => r?.prompt);
  assert.deepEqual(unexpectedDuplicateGroups('promptHash', records.map(([id,r]) => [id, sha(r.prompt)])), []);
  assert.deepEqual(unexpectedDuplicateGroups('normalizedPrompt', records.map(([id,r]) => [id, r.prompt.trim().replace(/\s+/g, ' ').toLowerCase()])), []);
  for (const field of ['id', 'name']) assert.deepEqual(duplicateGroups(SOURCE_TEMPLATES.map(t => [t.id, t[field].toLowerCase()])), [], field);
  for (const r of audit.records) {
    if (!templateById(r.id)) continue; // withdrawn as broken (brokenTemplateIds.js)
    assert.equal(r.sourceVideoSignature, visual.placements[r.id].signature, r.id);
    assert.equal(r.signatureFrameCount, 5, r.id);
    assert.equal(templateById(r.id).sourceModel, r.sourceModel, r.id);
    // Independently derive the compatibility-first Seedance precedent from capture evidence.
    const incompatible = r.referenceImageCount > 0 || r.referenceVideoCount > 0 || /\b(audio|music|soundtrack|speech|lip[ -]?sync|voice|dialogue)\b/i.test(r.prompt) || r.prompt.length > 30000;
    const key = incompatible ? 'community.copyOnly' : null;
    const template = templateById(r.id);
    assert.equal(template.model, 'Seedance 2.0 Fast', r.id);
    assert.equal(template.credits, 19, r.id);
    assert.equal(template.durationSeconds, 5, r.id);
    assert.equal(template.needsKey, key, r.id);
    assert.deepEqual(template.steps, incompatible
      ? ['Prepare your starting image using the guidance above.', 'Use this template to load its prompt and settings in the studio.', 'Upload your image, edit the prompt if needed, and review the price before generating.']
      : ['Use this template to load its prompt and settings in the studio.', 'Describe your characters and setting, then review the price before generating.'], r.id);
    assert.equal(SHOWCASE_CLIPS[r.id].title, template.name.toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase()), r.id);
    assert.equal(template.needs, key === 'community.copyOnly' ? 'Copy the exact prompt; its required reference media or preserved audio is not wired into generation' : null, r.id);
    assert.equal(sha(SOURCE_PROMPT_RECORDS[r.id].prompt), hashes[r.id], r.id);
    assert.equal(sha(r.prompt), hashes[r.id], r.id);
    assert.equal(r.sourcePromptSha256, hashes[r.id], r.id);
    assert.equal(templateDetail(r.id).prompt, exactSourcePromptRecord(r.id).prompt, r.id);
    for (const [file, hash, bytes, cap] of [[r.previewPath,r.localPreviewSha256,r.localPreviewBytes,6*1024*1024],[r.posterPath,r.localPosterSha256,r.localPosterBytes,80*1024]]) {
      const data = readFileSync(publicPath(file));
      assert.equal(sha(data), hash, r.id); assert.equal(data.length, bytes, r.id); assert.ok(bytes <= cap, r.id);
    }
    const data = readFileSync(publicPath(r.previewPath)), pos = data.indexOf('mvhd');
    assert.ok(pos > 0);
    const version = data[pos + 4];
    const timescale = data.readUInt32BE(pos + (version === 1 ? 24 : 16));
    const duration = version === 1 ? Number(data.readBigUInt64BE(pos + 28)) : data.readUInt32BE(pos + 20);
    assert.ok(Math.abs(duration / timescale - 5) < 0.11, r.id);
    let handler = 0;
    while ((handler = data.indexOf('hdlr', handler)) !== -1) { assert.notEqual(data.toString('ascii',handler+12,handler+16),'soun',r.id); handler += 4; }
  }
});

// Literal scene typography is preserved by the documented whitespace-only stripping rule.
const PLATFORM_SCENE_TEXT_ALLOWLIST = [];
test('public prompt fields contain no platform names except pinned original scene typography', () => {
  const leaks = ALL_TEMPLATES.filter(t => /higgsfield|syntx/i.test(t.prompt || '') || /higgsfield|syntx/i.test(t.sourcePrompt || '')).map(t => t.id);
  assert.deepEqual(leaks, PLATFORM_SCENE_TEXT_ALLOWLIST);
});
test('every declared wall clip resolves to the pinned published video template', () => {
  assert.deepEqual(WALL_PRESETS.map(t => t.id), ['a-moment-between-strangers', 'trick-or-skin', 'the-wrong-one', 'event-character-swap', 'community-parking-lot-recast', 'community-black-trench', 'community-urban-fashion-stroll', 'community-courtyard-style-shift', 'community-rugside-wardrobe-swaps', 'community-fur-coat-walk', 'community-urban-suit-swap', 'community-dancing-feline-duo', 'community-athlete-dance-swap']);
  assert.equal(WALL_CLIP_KEYS.length, WALL_PRESETS.length);
  assert.deepEqual(WALL_SHOWCASE_KEYS, Object.fromEntries(WALL_PRESETS.map(t => [t.id, t.clipKey])));
  for (const key of WALL_CLIP_KEYS) {
    const row = PRESETS.find(t => t.clipKey === key);
    assert.ok(row && hasTemplateVideo(row), key);
  }
});
test('dark couture rejection keeps identifiers and hashes but no prompt, template or clip', () => {
  assert.equal(audit.rejected.length, 1);
  assert.equal(audit.rejected[0].id, 'dark-couture');
  assert.match(audit.rejected[0].reason, /nine SYNTX AI/);
  assert.equal(audit.rejected[0].prompt, undefined);
  assert.equal(SOURCE_PROMPT_RECORDS['dark-couture'], undefined);
  assert.equal(templateById('dark-couture'), null);
  assert.equal(AUDIT_SHOWCASE_CLIPS['dark-couture'], undefined);
});

test('hidden templates do not publish their differently named clips, except the explicit independent landing placement', () => {
  const hidden = SOURCE_TEMPLATES.filter(t => !templateById(t.id) && t.clipKey !== t.id);
  assert.equal(hidden.length, 13);
  const independent = hidden.filter(t => t.id === 'keyboard-duo-swap');
  assert.deepEqual(independent.map(t => t.clipKey), ['ace-step']);
  assert.ok(SHOWCASE_CLIPS['ace-step']?.video); // Explicit independent landing placement in the frozen plan.
  const excluded = hidden.filter(t => t.id !== 'keyboard-duo-swap');
  assert.equal(excluded.length, 12);
  for (const t of excluded) assert.equal(SHOWCASE_CLIPS[t.clipKey], undefined, t.id + ': ' + t.clipKey);
});
