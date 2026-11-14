import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { IMAGE_TEMPLATES } from '../app/veyrnox/_lib/imageTemplates.js';
import { BROKEN_TEMPLATE_IDS } from "../app/veyrnox/_lib/brokenTemplateIds.js";
import { publicTemplateId } from "../app/veyrnox/_lib/templateIds.js";
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { sourcePromptAuditRecord, isPublishableSourcePromptTemplate, referenceCount } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { HF_REPLACEMENTS_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplateExpansion17.js';
import { SYNTX_REPLACEMENTS_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplateExpansion18.js';
import { PRESETS, ALL_TEMPLATES, REMOVED_PROMPT_GAP_TEMPLATE_IDS, templateById, hasTemplateVideo } from '../app/veyrnox/_lib/templates.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { EFFECT_CONCEPT_TEMPLATES } from '../app/veyrnox/_lib/effectConceptTemplates.js';
import { REFERENCE_TEMPLATES } from '../app/veyrnox/_lib/referenceTemplates.js';
import { VISUAL_SIGNATURE_METHOD } from '../scripts/lib/source-visual-signature.mjs';
import { publicPromptHygiene } from '../scripts/lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from '../scripts/lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from '../scripts/lib/source-prompt-endings.mjs';

const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const audits = ['higgsfield-replacements-12', 'syntx-replacements-4'].map(name => json('../docs/product/source-audit/' + name + '-2026-11-07.json'));
const rows = audits.flatMap(a => a.records), ids = new Set(rows.map(r => r.id));
const recipes = [...HF_REPLACEMENTS_TEMPLATES, ...SYNTX_REPLACEMENTS_TEMPLATES];
const hashes = {...json('./fixtures/higgsfieldReplacementPromptHashes.json'), ...json('./fixtures/syntxReplacementPromptHashes.json')};
const baseline = json('./fixtures/replacementTemplatesBaseline.json');
const visual = json('./fixtures/exactOnlyVisualSignatures.json');
// Independent fixed acceptance table: category, model, credits, seconds, needsKey.
const text = ['Seedance 2.0 Fast', 19, 5, null];
const portrait = ['Kling 3.0 · I2V', 32, 10, 'community.cinematic'];
const expected = {
  'community-spin-kick-puppy': ['REALISTIC', ...text],
  'community-neon-paint-splash': ['VFX', ...text],
  'community-neon-animal-dance': ['CARTOONS', ...text],
  'community-island-life-performance': ['REALISTIC', ...text],
  'community-cinematic-persona-swap': ['UGC', ...text],
  'community-roadside-service-pitch': ['UGC', ...text],
  'community-martial-arts-feline': ['REALISTIC', ...text],
  'community-cosmic-sands-encounter': ['CINEMATIC', ...text],
  'community-luxe-timepiece-reveal': ['PRODUCTS', ...text],
  'community-martial-arts-suit': ['MOVIES', ...portrait],
  'community-pet-affection-reveal': ['FASHION', ...portrait],
  'on-the-wave': ['REALISTIC', ...portrait], // withdrawn as broken (brokenTemplateIds.js); record kept
  'red-crystal-amulet': ['FANTASY', ...portrait],
  'window-explode': ['CINEMATIC', ...portrait],
};

test('14 replacements use the reviewed routes, exact captured bytes and existing publication rules', () => {
  assert.deepEqual(audits.map(a => [a.requested, a.accepted]), [[12, 11], [4, 3]]);
  assert.equal(HF_REPLACEMENTS_TEMPLATES.length, 11);
  assert.equal(SYNTX_REPLACEMENTS_TEMPLATES.length, 3);
  for (const collection of [rows, recipes]) assert.deepEqual(collection.map(r => r.id).sort(), Object.keys(expected).sort());
  assert.deepEqual(Object.keys(hashes).sort(), Object.keys(expected).sort());
  for (const r of rows) {
    const raw = SOURCE_PROMPT_RECORDS[r.id], t = templateById(r.id);
    if (!t) { assert.ok(BROKEN_TEMPLATE_IDS.includes(r.id), r.id); continue; }
    assert.equal(r.name, r.sourceTitle.toUpperCase(), r.id);
    assert.equal(raw.prompt, r.prompt, r.id);
    for (const prompt of [raw.prompt, r.prompt]) assert.equal(sha(prompt), hashes[r.id], r.id);
    assert.equal(r.sourcePromptSha256, hashes[r.id], r.id);
    assert.equal(r.normalizedPromptSha256, sha(normalize(raw.prompt)), r.id);
    for (const field of ['sourceRecordId', 'sourceVariantId', 'sourceMediaId', 'sourceTitle', 'sourceSlug']) assert.equal(raw[field], r[field], r.id);
    for (const value of [t, r]) {
      assert.deepEqual([value.category, value.model, value.credits, value.durationSeconds, value.needsKey], expected[r.id], r.id);
      assert.equal(value.needs, value.needsKey ? 'A clear full-body portrait with room for cinematic movement' : null, r.id);
    }
    assert.equal(r.category, r.manifestCategory, r.id);
    assert.equal(r.group, false, r.id);
    assert.equal(r.auditCompatible, true, r.id);
    assert.deepEqual(r.auditIssues, [], r.id);
    assert.equal(t.sourceAspect, r.sourceAspect, r.id);
    assert.equal(t.previewAspect, r.previewAspect, r.id);
    assert.equal(t.prompt, exactSourcePromptRecord(r.id).prompt, r.id);
    assert.equal(t.sourcePrompt, t.prompt, r.id);
    assert.equal(templateDetail(r.id).prompt, t.prompt, r.id);
    for (const key of ['promptOrigin', 'sourcePromptOrigin']) assert.equal(t[key], 'community-source-exact', r.id);
    assert.equal(t.negativePrompt, undefined, r.id);
    assert.equal(isPublishableSourcePromptTemplate(r.id), true, r.id);
    assert.ok(hasTemplateVideo(t), r.id);
    assert.ok(PRESETS.includes(t), r.id);
    const parsed = sourcePromptAuditRecord(r.id);
    assert.equal(r.referenceImageCount, referenceCount(raw.prompt, 'image'), r.id);
    assert.equal(r.referenceVideoCount, referenceCount(raw.prompt, 'video'), r.id);
    assert.equal(parsed.referenceImageCount, r.referenceImageCount, r.id);
    assert.equal(parsed.referenceVideoCount, r.referenceVideoCount, r.id);
    assert.equal(r.tokenAuditRunnable, parsed.runnable, r.id);
    if (!t.needs) assert.doesNotMatch(t.steps.join(' '), /upload|starting image|reference image|ten-second/i, r.id);
  }
  assert.equal(rows.filter(r => r.tokenAuditRunnable).length, 9);
  assert.equal(rows.filter(r => !r.tokenAuditRunnable).length, 5);
});

test('all old records, recipes, visual signatures and hidden rows remain unchanged; only reviewed category deltas occur', () => {
  assert.equal(Object.keys(baseline.templates).length, 827);
  for (const [id, hash] of Object.entries(baseline.templates)) assert.equal(sha(JSON.stringify(SOURCE_TEMPLATES.find(t => t.id === id))), hash, id);
  for (const [id, hash] of Object.entries(baseline.records)) assert.equal(sha(JSON.stringify(SOURCE_PROMPT_RECORDS[id])), hash, id);
  assert.equal(Object.keys(baseline.visual).length, 917);
  for (const [id, signature] of Object.entries(baseline.visual)) assert.deepEqual(visual.placements[id], signature, id);
  assert.deepEqual(REMOVED_PROMPT_GAP_TEMPLATE_IDS, baseline.hidden);
  assert.equal(REMOVED_PROMPT_GAP_TEMPLATE_IDS.length, 70);
  assert.equal(SOURCE_TEMPLATES.length, 841 + 46);
  assert.equal(PRESETS.length, 749 + 46);
  assert.equal(ALL_TEMPLATES.length, 1791 + 46);
  const deltas = { REALISTIC: 4, CINEMATIC: 2, UGC: 2, CARTOONS: 1, VFX: 1, MOVIES: 1, FASHION: 1, PRODUCTS: 1, FANTASY: 1 };
  const expansion = { MOVIES: 6, CINEMATIC: 15, REALISTIC: 23, FASHION: 1, CARTOONS: 1 };
  const withdrawn = {};
  for (const t of new Map(SOURCE_TEMPLATES.concat(HF_REPLACEMENTS_TEMPLATES, SYNTX_REPLACEMENTS_TEMPLATES).map(t => [t.id, t])).values()) if (BROKEN_TEMPLATE_IDS.includes(publicTemplateId(t.id))) withdrawn[t.category] = (withdrawn[t.category] || 0) + 1;
  for (const category of new Set([...Object.keys(baseline.categories), ...PRESETS.map(t => t.category)])) {
    assert.equal(PRESETS.filter(t => t.category === category).length, (baseline.categories[category] || 0) + (deltas[category] || 0) + (expansion[category] || 0) - (withdrawn[category] || 0), category);
  }
});

test('replacement media match supplied hashes, five-second silent video budgets and distinct decoded signatures', () => {
  assert.equal(visual.method, VISUAL_SIGNATURE_METHOD);
  assert.deepEqual(Object.keys(visual.placements).sort(), Object.keys(AUDIT_SHOWCASE_CLIPS).sort());
  assert.equal(Object.keys(visual.placements).length, 931 + 46);
  assert.equal(new Set(Object.values(visual.placements).map(r => r.signature)).size, 931 + 46);
  for (const audit of audits) {
    let bytes = 0;
    assert.equal(audit.visualSignatureMethod, VISUAL_SIGNATURE_METHOD);
    for (const r of audit.records) {
      for (const [path, hash, size, cap] of [[r.previewPath, r.localPreviewSha256, r.localPreviewBytes, 6 * 1024 * 1024], [r.posterPath, r.localPosterSha256, r.localPosterBytes, 80 * 1024]]) {
        const data = readFileSync(new URL('../public' + path, import.meta.url));
        assert.equal(sha(data), hash, r.id);
        assert.equal(data.length, size, r.id);
        assert.ok(size <= cap, r.id);
        bytes += size;
      }
      const data = readFileSync(new URL('../public' + r.previewPath, import.meta.url)), pos = data.indexOf('mvhd');
      assert.ok(pos > 0, r.id);
      const version = data[pos + 4], timescale = data.readUInt32BE(pos + (version === 1 ? 24 : 16));
      const duration = version === 1 ? Number(data.readBigUInt64BE(pos + 28)) : data.readUInt32BE(pos + 20);
      assert.ok(Math.abs(duration / timescale - 5) < 0.11, r.id);
      let offset = 0, videos = 0;
      while ((offset = data.indexOf('hdlr', offset)) !== -1) {
        const handler = data.toString('ascii', offset + 12, offset + 16);
        assert.notEqual(handler, 'soun', r.id);
        if (handler === 'vide') videos++;
        offset += 4;
      }
      assert.equal(videos, 1, r.id);
      assert.equal(r.startSeconds, 0, r.id);
      assert.equal(r.signatureFrameCount, 5, r.id);
      // Stored signatures only: re-decoding differs between ffmpeg builds (it failed on the Linux CI runner), and the
      // importers' --check already recompute it on the machine that generated the media.
      assert.deepEqual(visual.placements[r.id], { frames: 5, signature: r.sourceVideoSignature }, r.id);
    }
    assert.equal(bytes, audit.addedBytes);
  }
});

test('replacement identities, prompts, assets and names join no existing or within-batch duplicate', () => {
  const previousAudits = readdirSync(new URL('../docs/product/source-audit/', import.meta.url)).filter(f => f.endsWith('.json') && !f.includes('replacements'))
    .flatMap(f => json('../docs/product/source-audit/' + f).records || []);
  const previousRecords = Object.entries(SOURCE_PROMPT_RECORDS).filter(([id]) => !ids.has(id)).map(([, r]) => r);
  for (const field of ['sourceRecordId', 'sourceVariantId', 'sourceMediaId', 'sourceAssetSha256', 'localPreviewSha256', 'localPosterSha256']) {
    const known = new Set([...previousAudits, ...previousRecords].map(r => r[field]).filter(Boolean));
    const values = rows.map(r => r[field]).filter(Boolean);
    assert.equal(new Set(values).size, values.length, field);
    for (const r of rows) if (r[field]) assert.equal(known.has(r[field]), false, r.id + ': ' + field);
  }
  for (const transform of [v => v, normalize]) {
    const known = new Set(previousRecords.filter(r => r.prompt).map(r => sha(transform(r.prompt))));
    for (const r of rows) {
      const hash = sha(transform(r.prompt));
      assert.equal(known.has(hash), false, r.id);
      known.add(hash);
    }
  }
  for (const field of ['id', 'name']) {
    const previous = [...SOURCE_TEMPLATES.filter(t => !ids.has(t.id)), ...EFFECT_CONCEPT_TEMPLATES, ...REFERENCE_TEMPLATES, ...IMAGE_TEMPLATES];
    const known = new Set(previous.map(r => normalize(r[field])));
    for (const r of recipes) {
      assert.equal(known.has(normalize(r[field])), false, r.id + ': ' + field);
      known.add(normalize(r[field]));
    }
  }
  for (const [key, field] of [['video', 'localPreviewSha256'], ['poster', 'localPosterSha256']]) {
    const known = new Set(Object.entries(AUDIT_SHOWCASE_CLIPS).filter(([id]) => !ids.has(id)).map(([, c]) => sha(readFileSync(new URL('../public' + c[key].replace(/-(?:higgs|syntx)-/, '-'), import.meta.url)))));
    for (const r of rows) assert.equal(known.has(r[field]), false, r.id + ': ' + field);
  }
});

test('two separately identified character references are deferred without prompt, template or shipped media', () => {
  assert.deepEqual(audits.flatMap(a => a.rejected.map(r => r.id)), ['community-cyberpunk-rooftop-encounter', 'the-push-2']);
  for (const r of audits.flatMap(a => a.rejected)) {
    assert.equal(r.reason, 'two separate character references cannot be bound by any offered route');
    assert.equal(r.prompt, undefined);
    assert.equal(SOURCE_PROMPT_RECORDS[r.id], undefined);
    assert.equal(templateById(r.id), null);
    assert.equal(AUDIT_SHOWCASE_CLIPS[r.id], undefined);
    for (const ext of ['mp4', 'jpg']) assert.equal(existsSync(new URL('../public/showcase/creator-' + r.id + '.' + ext, import.meta.url)), false);
  }
});

test('replacement audit inventories reproduce the scanners without redacting brand typography', () => {
  for (const audit of audits) {
    assert.deepEqual(audit.publicPromptHygiene, publicPromptHygiene(audit.records));
    assert.deepEqual(audit['source-reference-gaps'], sourceReferenceGaps(audit.records));
    assert.deepEqual(audit['ending-review'], sourcePromptEndingReview(audit.records));
    assert.deepEqual(audit.publicPromptHygiene.inventory, []);
    assert.equal(audit['source-reference-gaps'].count, 0);
    assert.equal(audit.compatibility.compatible, audit.accepted);
    assert.equal(audit.compatibility.incompatible, 0);
  }
  assert.match(SOURCE_PROMPT_RECORDS['community-luxe-timepiece-reveal'].prompt, /BIGOTTI/);
});
