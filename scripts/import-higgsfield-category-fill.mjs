// Offline Amendment 1 import. Input files are read-only; no encoding or network.
import assert from 'node:assert/strict';
import { publicPromptHygiene } from './lib/public-prompt-hygiene.mjs';
import { sourceReferenceGaps } from './lib/source-reference-gaps.mjs';
import { sourcePromptEndingReview } from './lib/source-prompt-endings.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualSignature, VISUAL_SIGNATURE_METHOD } from './lib/source-visual-signature.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const input = process.argv[2];
const checkOnly = process.argv.includes('--check');
if (!input) throw new Error('Pass the read-only input-cats directory');
const read = file => readFileSync(resolve(input, file));
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (file, value) => {
  const path = resolve(root, file);
  if (checkOnly) assert.equal(readFileSync(path, 'utf8'), value, file + ': regenerate');
  else writeFileSync(path, value);
};
const manifest = JSON.parse(read('manifest.json'));
const encodes = JSON.parse(read('encode-report.json'));
assert.equal(manifest.length, 30);
assert.equal(encodes.length, 30);
const slug = name => 'community-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const records = {}, recipes = [], audit = [], rejected = [];
const signaturesPath = resolve(root, 'tests/fixtures/exactOnlyVisualSignatures.json');
const visual = JSON.parse(readFileSync(signaturesPath));
assert.equal(visual.method, VISUAL_SIGNATURE_METHOD);
const referenceCount = (prompt, kind) => {
  const values = [0];
  for (const expression of [
    new RegExp('@' + kind + '\\s*[_-]?(\\d+)', 'gi'),
    new RegExp('<<<\\s*' + kind + '[_\\s-]*(\\d+)\\s*>>>', 'gi'),
    new RegExp('\\b' + kind + '\\s+(\\d+)\\b', 'gi'),
    new RegExp('\\b' + kind + '[_-](\\d+)\\.(?:png|jpe?g|webp|gif|mp4|mov|webm)\\b', 'gi'),
  ]) for (const match of prompt.matchAll(expression)) values.push(Number(match[1]));
  return Math.max(...values);
};
for (const m of manifest) {
  const id = slug(m.name), e = encodes.find(row => row.mediaId === m.mediaId);
  assert.ok(e, id);
  assert.equal(sha(m.prompt), m.promptSha256, id);
  assert.ok(m.prompt.trim(), id);
  assert.ok(['ANIME', 'ADS', 'YOUR PHOTO'].includes(m.category), id);
  assert.equal(e.sourceSha256, m.videoSha256, id);
  assert.equal(sha(read('media/' + m.videoFile)), m.videoSha256, id);
  assert.equal(e.startSeconds, 0, id);
  const assets = ['mp4', 'jpg'].map(ext => {
    const data = read('encoded/' + m.mediaId + '.' + ext);
    const hash = ext === 'mp4' ? e.videoSha256 : e.posterSha256;
    assert.equal(sha(data), hash, id);
    assert.ok(data.length <= (ext === 'mp4' ? 6 * 1024 * 1024 : 80 * 1024), id);
    if (ext === 'mp4') assert.equal(data.length, e.videoBytes, id);
    else assert.equal(data.length, e.posterBytes, id);
    return { ext, data, hash };
  });
  if (m.name === 'ARCHERY FACE SWAP' || id === 'community-anime-court-match') {
    // Clearly clipped mid-word. Do not repair exact text.
    if (m.name === 'ARCHERY FACE SWAP') assert.ok(m.prompt.endsWith('hands pass in fro'));
    else assert.equal(m.prompt, 'Change basketball holder to , change the opponent to');
    rejected.push({ id, sourceRecordId: m.recordId, sourceMediaId: m.mediaId,
      sourceVariantId: m.variantId, category: m.category, sourcePromptSha256: m.promptSha256,
      reason: m.name === 'ARCHERY FACE SWAP' ? 'Incomplete source prompt ends mid-word.' : 'Incomplete slot-stripped fragment omits both requested basketball character replacements.',
      sourceAssetSha256: m.videoSha256, localPreviewSha256: e.videoSha256, localPosterSha256: e.posterSha256 });
    delete visual.placements[id];
    for (const {ext, hash} of assets) {
      const path = resolve(root, 'public/showcase/creator-' + id + '.' + ext);
      if (existsSync(path)) {
        assert.equal(sha(readFileSync(path)), hash);
        assert.equal(checkOnly, false, id + ': rejected media must be absent');
        rmSync(path);
      }
    }
    continue;
  }
  for (const { ext, data } of assets) {
    const destination = resolve(root, 'public/showcase/creator-' + id + '.' + ext);
    if (existsSync(destination)) assert.equal(sha(readFileSync(destination)), sha(data), id + ': existing media');
    if (!checkOnly) copyFileSync(resolve(input, 'encoded/' + m.mediaId + '.' + ext), destination);
  }
  const signature = visualSignature('public/showcase/creator-' + id + '.mp4');
  assert.equal(signature.frames, 5, id);
  for (const [other, value] of Object.entries(visual.placements)) {
    if (other !== id) assert.notEqual(value.signature, signature.signature, id + ': visual duplicate of ' + other);
  }
  visual.placements[id] = signature;
  const category = id === 'community-cartoon-hero-swap' ? 'CARTOONS' : m.category;
  const referenceImageCount = referenceCount(m.prompt, 'image'), referenceVideoCount = referenceCount(m.prompt, 'video');
  // Input asset totals include videos and alternate views, not just subjects.
  // Multiple numbered images or an explicit two-player request use the existing
  // composite-starting-image guidance; other rows reuse category/subject guidance.
  const group = m.inputAssetCount > 1 && (referenceImageCount > 1 || /basketball holder.*opponent/i.test(m.prompt));
  const needsKey = group ? 'community.group' : m.category === 'ADS' ? 'community.products'
    : m.category === 'ANIME' || /\b(?:dog|pet)\b/i.test(m.description) ? 'community.cartoons' : 'community.cinematic';
  const needs = {
    'community.group': 'One starting image containing every subject in their intended positions',
    'community.products': 'A clear image of the subject and featured vehicle or product',
    'community.cartoons': 'A clear full-body animal or original character image',
    'community.cinematic': 'A clear full-body portrait with room for cinematic movement',
  }[needsKey];
  const previewAspect = m.width + ' / ' + m.height;
  const sourceAspect = Math.abs(Math.log(m.width / m.height)) < 0.16 ? '1:1' : m.width > m.height ? '16:9' : '9:16';
  records[id] = { sourcePromptAvailable: true, sourceAuditStatus: 'verified-2026-11-05',
    sourceTitle: m.title, sourceRecordId: m.recordId, sourceVariantId: m.variantId, sourceMediaId: m.mediaId, prompt: m.prompt };
  recipes.push({ id, name: m.name, category, clipKey: id, previewAspect, sourceAspect,
    model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10, isNew: true, inspired: true,
    needs, needsKey,
    steps: ['Upload a clear starting image that matches the subject guidance.', 'Use this template to load its editable ten-second prompt and settings.', 'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.'],
    bg: 'linear-gradient(155deg,#121722 0%,#394c66 55%,#b77d62 100%)' });
  audit.push({ rank: m.rank, id, name: m.name, sourceRecordId: m.recordId, sourceVariantId: m.variantId,
    sourceTitle: m.title, sourceDescription: m.description, sourceMediaId: m.mediaId, sourceMediaUrl: m.sourceVideoUrl,
    sourceWidth: m.width, sourceHeight: m.height, sourceDuration: m.duration, sourceJobSetType: m.jobSetType, likes: m.likes,
    sourceAuditStatus: 'verified-2026-11-05', sourcePromptSha256: m.promptSha256,
    normalizedPromptSha256: sha(m.prompt.trim().replace(/\s+/g, ' ').toLowerCase()), prompt: m.prompt,
    category, manifestCategory: m.category, previewAspect, sourceAspect, sourceAssetSha256: m.videoSha256,
    sourceVideoSignature: signature.signature, signatureFrameCount: signature.frames,
    localPreviewSha256: e.videoSha256, localPreviewBytes: e.videoBytes, localPosterSha256: e.posterSha256, localPosterBytes: e.posterBytes,
    previewPath: '/showcase/creator-' + id + '.mp4', posterPath: '/showcase/creator-' + id + '.jpg',
    startSeconds: 0, previewDuration: 5, previewFps: 24, crf: e.crf, inputAssetCount: m.inputAssetCount,
    referenceImageCount, referenceVideoCount, group, needsKey });
}
assert.equal(audit.length, 28);
assert.equal(rejected.length, 2);
const json = value => JSON.stringify(value, null, 2) + '\n';
write('app/veyrnox/_lib/higgsfieldCategoryFillRecords.js',
  '// Raw same-record community text; generated offline, never rewrite or translate.\nexport const HIGGSFIELD_CATEGORY_FILL_RECORDS = Object.freeze({\n' +
  Object.entries(records).map(([id, r]) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(r)).join(',\n') + '\n});\n');
write('app/veyrnox/_lib/sourceTemplateExpansion16.js',
  '// Generated by scripts/import-higgsfield-category-fill.mjs; exact text joins at registration.\nexport const CATEGORY_FILL_TEMPLATES = Object.freeze([\n' +
  recipes.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]);\nexport const CATEGORY_FILL_SHOWCASE_CLIPS = Object.fromEntries(CATEGORY_FILL_TEMPLATES.map(t => [t.id, {\n' +
  "  video: '/showcase/creator-' + t.id + '.mp4', poster: '/showcase/creator-' + t.id + '.jpg', aspectRatio: t.previewAspect, title: t.name.toLowerCase().replace(/(^|\\s)\\S/g, letter => letter.toUpperCase()),\n}]));\n");
write('tests/fixtures/categoryFillPromptHashes.json', json(Object.fromEntries(audit.map(r => [r.id, r.sourcePromptSha256]))));
write(signaturesPath, json(visual));
write('docs/product/source-audit/higgsfield-category-fill-30-2026-11-05.json', json({
  source: 'Higgsfield community', api: 'https://cms.higgsfield.ai/higgsfield-multiplier/video-explore/v2?source=community',
  auditedAt: '2026-11-05', requested: 30, accepted: audit.length, rejected,
  manifestSha256: sha(read('manifest.json')), encodeReportSha256: sha(read('encode-report.json')),
  visualSignatureMethod: VISUAL_SIGNATURE_METHOD, addedBytes: audit.reduce((sum, r) => sum + r.localPreviewBytes + r.localPosterBytes, 0),
  publicPromptHygiene: publicPromptHygiene(audit), 'source-reference-gaps': sourceReferenceGaps(audit), records: audit, 'ending-review': sourcePromptEndingReview(audit) }));
const showcasePath = resolve(root, 'docs/product/showcase-clips.md');
const begin = '<!-- BEGIN CATEGORY FILL EXACT -->', end = '<!-- END CATEGORY FILL EXACT -->';
const table = audit.map(r => '| `' + r.id + '` | ' + r.sourceTitle.replaceAll('|', '\\|') + ' | ' + r.category + ' | [Source asset](' + r.sourceMediaUrl + ') | 0 s |').join('\n');
const section = begin + '\n## 5 November 2026: category minimum expansion\n\n28 of 30 prepared community pairs accepted; Archery Face Swap and Anime Court Match were rejected for incomplete source prompts.\nThe [category-fill audit](source-audit/higgsfield-category-fill-30-2026-11-05.json) locks same-record prompts and source/shipped hashes.\n\n| Tile | Source title | Category | Source asset | Start |\n| --- | --- | --- | --- | --- |\n' + table + '\n' + end;
const prior = readFileSync(showcasePath, 'utf8');
write(showcasePath, prior.includes(begin) ? prior.slice(0, prior.indexOf(begin)) + section + prior.slice(prior.indexOf(end) + end.length) : prior.trimEnd() + '\n\n' + section + '\n');
console.log('Imported ' + audit.length + ' exact pairs; rejected ' + rejected.length + '; hashes and normalized visual uniqueness verified.');
