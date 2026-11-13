import { sameSourceMedia } from './lib/source-record-media.mjs';
// Offline frozen Amendment 2 import: read-only inputs, no network or encoding.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualSignature, VISUAL_SIGNATURE_METHOD } from './lib/source-visual-signature.mjs';
import { assertAvailablePublicIds } from './lib/template-public-id.mjs';
import { publicPromptHygiene } from './lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from './lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from './lib/source-prompt-endings.mjs';
import { referenceCount } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { IMAGE_TEMPLATES } from '../app/veyrnox/_lib/imageTemplates.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { EFFECT_CONCEPT_TEMPLATES } from '../app/veyrnox/_lib/effectConceptTemplates.js';
import { REFERENCE_TEMPLATES } from '../app/veyrnox/_lib/referenceTemplates.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const input = process.argv[2];
const checkOnly = process.argv.includes('--check');
if (!input || input.startsWith('--')) throw new Error('Pass the read-only input directory before --check');
const read = file => readFileSync(resolve(input, file));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const write = (file, value) => {
  const path = resolve(root, file);
  if (checkOnly) assert.equal(readFileSync(path, 'utf8'), value, file + ': regenerate');
  else writeFileSync(path, value);
};
const manifest = JSON.parse(read('manifest.json'));
const encodes = JSON.parse(read('encode-report.json'));
const REQUESTED = 4, EXPANSION = 18;
const SOURCE = "Syntx Trends";
const API = "https://api.syntx.ai/api/v1/trends";
const SCRIPT = 'import-replacement-templates-syntx.mjs', PREFIX = 'SYNTX_REPLACEMENTS';
const RECORD_FILE = 'syntxReplacementRecords.js', RECORD_EXPORT = 'SYNTX_REPLACEMENTS_RECORDS';
const HASH_FILE = 'syntxReplacementPromptHashes.json';
const AUDIT_FILE = 'syntx-replacements-4-2026-11-07.json';
const DEFERRED = 'the-push-2';
const publicId = m => m.slug;
const REVIEWED_CATEGORIES = Object.freeze({ 'on-the-wave': 'REALISTIC', 'red-crystal-amulet': 'FANTASY', 'window-explode': 'CINEMATIC', 'the-push-2': 'MOVIES' });
const reviewedCategory = m => REVIEWED_CATEGORIES[m.slug];
const sourceFields = m => {
  assert.equal(m.settings.model_type, 'seedance-2.0', m.slug + ': source model requires review');
  return { sourceModel: 'Seedance 2.0', sourcePlatform: 'Syntx', sourceUrl: 'https://syntx.ai/trends/' + m.slug };
};

assert.equal(manifest.length, REQUESTED);
assert.equal(encodes.length, REQUESTED);
const portrait = Object.freeze({ model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  needsKey: 'community.cinematic', needs: 'A clear full-body portrait with room for cinematic movement' });
// Final owner-reviewed table is authoritative. Token counts below are evidence,
// never routing inputs: scene audio and unnumbered portraits confuse the parser.
const REVIEWED_ROUTES = Object.freeze({ 'on-the-wave': portrait, 'red-crystal-amulet': portrait, 'window-explode': portrait });
const deferredReason = 'two separate character references cannot be bound by any offered route';
const records = {}, recipes = [], audit = [], rejected = [];
const signaturesPath = 'tests/fixtures/exactOnlyVisualSignatures.json';
const visual = JSON.parse(readFileSync(resolve(root, signaturesPath)));
assert.equal(visual.method, VISUAL_SIGNATURE_METHOD);
const ownIds = manifest.map(m => publicId(m)).filter(id => {
  const m = manifest.find(m => publicId(m) === id), r = SOURCE_PROMPT_RECORDS[id];
  return sameSourceMedia(r, m.mediaId || m.sourceMediaId)
    && r.sourceRecordId === (m.recordId || m.sourceRecordId);
});
const own = new Set(ownIds);
const priorAudits = readdirSync(resolve(root, 'docs/product/source-audit')).filter(f => f.endsWith('.json') && f !== AUDIT_FILE)
  .flatMap(f => JSON.parse(readFileSync(resolve(root, 'docs/product/source-audit', f))).records || []).filter(r => !own.has(r.id));
const priorRecords = Object.entries(SOURCE_PROMPT_RECORDS).filter(([id]) => !own.has(id)).map(([, r]) => r);
const fields = ['sourceRecordId', 'sourceVariantId', 'sourceMediaId', 'sourcePromptSha256', 'normalizedPromptSha256', 'sourceAssetSha256', 'localPreviewSha256', 'localPosterSha256'];
const known = Object.fromEntries(fields.map(field => [field, new Set([...priorAudits, ...priorRecords].map(r => r[field]).filter(Boolean))]));
for (const r of priorRecords.filter(r => r.prompt)) {
  known.sourcePromptSha256.add(sha(r.prompt));
  known.normalizedPromptSha256.add(sha(normalize(r.prompt)));
}
const historic = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/higgsfield300Baseline.json')));
for (const id of historic.documentedCommunityMediaIds) known.sourceMediaId.add(id);
const knownNames = new Set([...SOURCE_TEMPLATES.filter(t => !own.has(t.id)), ...EFFECT_CONCEPT_TEMPLATES, ...REFERENCE_TEMPLATES, ...IMAGE_TEMPLATES].map(t => normalize(t.name)));
for (const [, clip] of Object.entries(AUDIT_SHOWCASE_CLIPS).filter(([id]) => !own.has(id))) {
  for (const [key, field] of [['video', 'localPreviewSha256'], ['poster', 'localPosterSha256']]) {
    known[field].add(sha(readFileSync(resolve(root, 'public', clip[key].replace(/^\//, '').replace(/-(?:higgs|syntx)-/, '-')))));
  }
}
for (const m of manifest) {
  const id = publicId(m), key = m.mediaId || m.slug;
  const e = encodes.find(row => (row.mediaId || row.slug) === key);
  assert.ok(e, id);
  assert.equal(sha(m.prompt), m.promptSha256, id);
  assert.ok(m.prompt.trim(), id);
  assert.equal(m.name, m.title.toUpperCase(), id + ': feed title');
  assert.equal(sha(read('media/' + m.videoFile)), m.videoSha256, id);
  assert.equal(e.sourceSha256, m.videoSha256, id);
  assert.equal(e.startSeconds, 0, id);
  const assets = [['mp4', e.videoSha256, e.videoBytes, 6 * 1024 * 1024], ['jpg', e.posterSha256, e.posterBytes, 80 * 1024]].map(([ext, hash, bytes, cap]) => {
    const data = read('encoded/' + key + '.' + ext);
    assert.equal(sha(data), hash, id);
    assert.equal(data.length, bytes, id);
    assert.ok(bytes <= cap, id);
    return { ext, hash, data };
  });
  const identity = { id, sourceRecordId: m.recordId || m.sourceRecordId, sourceVariantId: m.variantId,
    sourceMediaId: m.mediaId || m.sourceMediaId, sourcePromptSha256: m.promptSha256,
    sourceAssetSha256: m.videoSha256, localPreviewSha256: e.videoSha256, localPosterSha256: e.posterSha256 };
  const reject = (reason, deferred = false) => {
    rejected.push({ ...identity, reason });
    if (deferred) {
      assert.equal(Object.hasOwn(visual.placements, id), false, id + ': rejected placement must be absent');
      for (const {ext} of assets) assert.equal(existsSync(resolve(root, 'public/showcase/creator-' + id + '.' + ext)), false, id + ': rejected media must be absent');
    }
    console.log('Rejected ' + id + ': ' + reason);
  };
  const category = reviewedCategory(m);
  assert.equal(category, m.category, id + ': manifest category');
  if (id === DEFERRED) { reject(deferredReason, true); continue; }
  assert.ok(Object.hasOwn(REVIEWED_ROUTES, id), id + ': route requires review');
  const route = REVIEWED_ROUTES[id];
  const signature = visualSignature(resolve(input, 'encoded/' + key + '.mp4'));
  assert.equal(signature.frames, 5, id);
  const candidate = { ...identity, normalizedPromptSha256: sha(normalize(m.prompt)) };
  let collision;
  try { assertAvailablePublicIds([id], ownIds); } catch (error) { collision = error.message; }
  if (Object.hasOwn(records, id)) collision = 'duplicate public id within batch';
  if (knownNames.has(normalize(m.name))) collision = 'duplicate name';
  for (const field of fields) if (candidate[field] && known[field].has(candidate[field])) collision = 'duplicate ' + field;
  for (const [other, value] of Object.entries(visual.placements)) {
    if (other !== id && value.signature === signature.signature) collision = 'visual duplicate of ' + other;
  }
  if (collision) { reject(collision); continue; }
  for (const field of fields) if (candidate[field]) known[field].add(candidate[field]);
  knownNames.add(normalize(m.name));
  for (const {ext, hash} of assets) {
    const destination = resolve(root, 'public/showcase/creator-' + id + '.' + ext);
    if (existsSync(destination)) assert.equal(sha(readFileSync(destination)), hash, id + ': existing media');
    else if (!checkOnly) copyFileSync(resolve(input, 'encoded/' + key + '.' + ext), destination);
    assert.equal(sha(readFileSync(destination)), hash, id + ': shipped bytes');
  }
  visual.placements[id] = signature;
  const referenceImageCount = referenceCount(m.prompt, 'image'), referenceVideoCount = referenceCount(m.prompt, 'video');
  const requiresPreservedAudio = /\b(audio|music|soundtrack|speech|lip[ -]?sync|voice|dialogue)\b/i.test(m.prompt);
  const previewAspect = m.width + ' / ' + m.height;
  const sourceAspect = Math.abs(Math.log(m.width / m.height)) < 0.16 ? '1:1' : m.width > m.height ? '16:9' : '9:16';
  const sourceMetadata = sourceFields(m);
  records[id] = { sourcePromptAvailable: true, sourceAuditStatus: 'verified-2026-11-07', sourceTitle: m.title,
    sourceRecordId: identity.sourceRecordId, sourceVariantId: m.variantId, sourceMediaId: identity.sourceMediaId,
    ...(m.slug ? {sourceSlug: m.slug} : {}), prompt: m.prompt };
  recipes.push({ id, name: m.name, category, clipKey: id, previewAspect, sourceAspect, ...route,
    isNew: true, inspired: SOURCE === 'Higgsfield community', ...sourceMetadata,
    steps: route.needsKey ? ['Upload a clear starting image that matches the subject guidance.', 'Use this template to load its editable ten-second prompt and settings.', 'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.']
      : ['Use this template to load its prompt and settings in the studio.', 'Describe your characters and setting, then review the price before generating.'],
    bg: 'linear-gradient(155deg,#121722 0%,#394c66 55%,#b77d62 100%)' });
  audit.push({ rank: m.rank, ...candidate, name: m.name, sourceTitle: m.title, sourceDescription: m.description,
    sourceSlug: m.slug, sourceMediaUrl: m.sourceVideoUrl, sourceWidth: m.width, sourceHeight: m.height,
    sourceDuration: m.duration, sourceJobSetType: m.jobSetType, likes: m.likes,
    ...sourceMetadata, ...(m.settings ? {sourceSettings: {...m.settings, sourceProvider: m.model}} : {}),
    sourceAuditStatus: 'verified-2026-11-07', prompt: m.prompt, category, manifestCategory: m.category,
    previewAspect, sourceAspect, sourceVideoSignature: signature.signature, signatureFrameCount: signature.frames,
    localPreviewBytes: e.videoBytes, localPosterBytes: e.posterBytes,
    previewPath: '/showcase/creator-' + id + '.mp4', posterPath: '/showcase/creator-' + id + '.jpg',
    startSeconds: 0, previewDuration: 5, previewFps: 24, crf: e.crf, inputAssetCount: m.inputAssetCount,
    referenceImageCount, referenceVideoCount, requiresPreservedAudio, group: false, ...route,
    auditCompatible: true, auditIssues: [], compatibilityBasis: 'owner-reviewed Amendment 2 routing table',
    tokenAuditRunnable: !referenceImageCount && !referenceVideoCount && !requiresPreservedAudio && m.prompt.length <= 30000 });
}
const header = '// Generated offline by scripts/' + SCRIPT + '; exact text joins at registration.\n';
write('app/veyrnox/_lib/' + RECORD_FILE, header + 'export const ' + RECORD_EXPORT + ' = Object.freeze({\n' +
  Object.entries(records).map(([id, r]) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(r)).join(',\n') + '\n});\n');
write('app/veyrnox/_lib/sourceTemplateExpansion' + EXPANSION + '.js', header + 'export const ' + PREFIX + '_TEMPLATES = Object.freeze([\n' +
  recipes.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]);\nexport const ' + PREFIX + '_SHOWCASE_CLIPS = Object.fromEntries(' + PREFIX + '_TEMPLATES.map(t => [t.id, {\n' +
  "  video: '/showcase/creator-' + t.id + '.mp4', poster: '/showcase/creator-' + t.id + '.jpg', aspectRatio: t.previewAspect, title: t.name.toLowerCase().replace(/(^|\\s)\\S/g, letter => letter.toUpperCase()),\n}]));\n");
write('tests/fixtures/' + HASH_FILE, json(Object.fromEntries(audit.map(r => [r.id, r.sourcePromptSha256]))));
write(signaturesPath, json(visual));
write('docs/product/source-audit/' + AUDIT_FILE, json({ source: SOURCE, api: API, auditedAt: '2026-11-07',
  requested: REQUESTED, accepted: audit.length, rejected,
  manifestSha256: sha(read('manifest.json')), encodeReportSha256: sha(read('encode-report.json')),
  visualSignatureMethod: VISUAL_SIGNATURE_METHOD, addedBytes: audit.reduce((sum, r) => sum + r.localPreviewBytes + r.localPosterBytes, 0),
  compatibility: { total: audit.length, compatible: audit.length, incompatible: 0, basis: 'owner-reviewed Amendment 2 routing table' },
  publicPromptHygiene: publicPromptHygiene(audit), 'source-reference-gaps': sourceReferenceGaps(audit),
  records: audit, 'ending-review': sourcePromptEndingReview(audit) }));
const showcasePath = 'docs/product/showcase-clips.md';
const begin = '<!-- BEGIN ' + PREFIX + ' EXACT -->', end = '<!-- END ' + PREFIX + ' EXACT -->';
const table = audit.map(r => '| `' + r.id + '` | ' + r.sourceTitle.replaceAll('|', '\\|') + ' | ' + r.category + ' | [Source asset](' + r.sourceMediaUrl + ') | 0 s |').join('\n');
const section = begin + '\n## 7 November 2026: ' + SOURCE + ' replacements\n\n' + audit.length + ' of ' + REQUESTED + ' prepared pairs accepted. Rejected: ' + rejected.map(r => '`' + r.id + '` — ' + r.reason).join('; ') + '.\nThe [replacement audit](source-audit/' + AUDIT_FILE + ') locks exact prompts, reviewed routes and source/shipped hashes.\n\n| Tile | Source title | Category | Source asset | Start |\n| --- | --- | --- | --- | --- |\n' + table + '\n' + end;
const prior = readFileSync(resolve(root, showcasePath), 'utf8');
write(showcasePath, prior.includes(begin) ? prior.slice(0, prior.indexOf(begin)) + section + prior.slice(prior.indexOf(end) + end.length) : prior.trimEnd() + '\n\n' + section + '\n');
console.log('Verified ' + audit.length + ' exact pairs; rejected ' + rejected.length + '; ' + audit.reduce((sum, r) => sum + r.localPreviewBytes + r.localPosterBytes, 0) + ' shipped bytes.');
