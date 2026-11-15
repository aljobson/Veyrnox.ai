// Offline frozen import (2026-11-15): English Syntx Trends image templates that edit the person's own photo.
// Read-only inputs, no network or encoding. Selection: every image Trend with min_files_count = 1 whose exact prompt is
// English, names no brand or platform, and is not already in the catalog; then refused rows reviewed by hand.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { validateInputs } from '../lib/generationInputValidation.js';
import { nearestOption } from '../lib/aspectShapes.mjs';
import { assertAvailablePublicIds } from './lib/template-public-id.mjs';
import { isEnglishPrompt } from './lib/english-prompt.mjs';
import { IMAGE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/imageSourcePromptRecords.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { IMAGE_TEMPLATES } from '../app/veyrnox/_lib/imageTemplates.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const input = process.argv[2];
const checkOnly = process.argv.includes('--check');
if (!input || input.startsWith('--')) throw new Error('Pass the read-only input directory before --check');
const read = file => readFileSync(resolve(input, file));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
// Same media identity the earlier Syntx records use: the file name of the original asset, without its extension.
const mediaId = url => new URL(url).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const write = (file, value) => {
  const path = resolve(root, file);
  if (checkOnly) assert.equal(readFileSync(path, 'utf8'), value, file + ': regenerate');
  else writeFileSync(path, value);
};
const AUDITED = '2026-11-15', PREPARED = 41;
const AUDIT_FILE = 'syntx-photo-images-2026-11-15.json';
const MODEL = 'nano-banana-pro-edit-grsai';
// Syntx category -> gallery category; reviewed with the prompts. Products stay PRODUCTS, styles CARTOONS.
const CATEGORY = { products: 'PRODUCTS', cartoons: 'CARTOONS', movies: 'CINEMATIC' };
const REVIEWED_REJECTS = Object.freeze({});
const manifest = JSON.parse(read('manifest.json'));
const encodes = JSON.parse(read('encode-report.json'));
assert.equal(manifest.length, PREPARED);
assert.equal(encodes.length, PREPARED);
const gatewayAccepts = aspect => validateInputs({ prompt: 'Aspect validation', aspect_ratio: aspect }).ok;
const aspects = capabilityFor('grsai:nano-banana-pro-edit').inputs.aspect_ratio.values.filter(gatewayAccepts);
const ownIds = manifest.map(m => m.slug).filter(id => IMAGE_SOURCE_PROMPT_RECORDS[id]?.sourceRecordId === manifest.find(m => m.slug === id).recordId);
const own = new Set(ownIds);
const knownPrompts = new Set([...Object.entries(IMAGE_SOURCE_PROMPT_RECORDS), ...Object.entries(SOURCE_PROMPT_RECORDS)]
  .filter(([id, r]) => !own.has(id) && r?.prompt).map(([, r]) => sha(normalize(r.prompt))));
const knownRecords = new Set(Object.entries(IMAGE_SOURCE_PROMPT_RECORDS).filter(([id]) => !own.has(id)).map(([, r]) => r.sourceRecordId).filter(Boolean));
const knownNames = new Set([...IMAGE_TEMPLATES, ...SOURCE_TEMPLATES].filter(t => !own.has(t.id)).map(t => normalize(t.name)));
const records = {}, templates = [], audit = [], rejected = [];
for (const m of manifest) {
  const id = m.slug, e = encodes.find(row => row.slug === m.slug);
  assert.ok(e, id);
  assert.equal(sha(m.prompt), m.promptSha256, id);
  assert.equal(sha(read('media/' + m.mediaFile)), m.mediaSha256, id);
  assert.equal(e.sourceSha256, m.mediaSha256, id);
  const data = read('encoded/' + id + '.webp');
  assert.equal(sha(data), e.imageSha256, id);
  assert.equal(data.length, e.imageBytes, id);
  assert.ok(data.length <= 400 * 1024, id + ': preview size budget');
  assert.ok(Math.max(e.width, e.height) <= 1080, id + ': preview longest side');
  const reject = reason => { rejected.push({ id, sourceRecordId: m.recordId, sourcePromptSha256: m.promptSha256, reason }); console.log('Rejected ' + id + ': ' + reason); };
  if (Object.hasOwn(REVIEWED_REJECTS, id)) { reject('reviewed: ' + REVIEWED_REJECTS[id]); continue; }
  if (m.sourceMinFiles !== 1) { reject('needs ' + m.sourceMinFiles + ' photos'); continue; }
  if (!isEnglishPrompt(m.prompt)) { reject('prompt is not English'); continue; }
  if (/\b(?:higgsfield|syntx)\b/i.test(m.prompt)) { reject('names a platform'); continue; }
  let collision;
  try { assertAvailablePublicIds([id], ownIds); } catch (error) { collision = error.message; }
  if (knownPrompts.has(sha(normalize(m.prompt)))) collision = 'duplicate prompt';
  if (knownRecords.has(m.recordId)) collision = 'duplicate source record';
  const name = m.title.toUpperCase();
  if (knownNames.has(normalize(name))) collision = 'duplicate name';
  if (collision) { reject(collision); continue; }
  knownPrompts.add(sha(normalize(m.prompt))); knownRecords.add(m.recordId); knownNames.add(normalize(name));
  const sourceAspect = m.aspect || `${m.mediaWidth}:${m.mediaHeight}`;
  const aspect = aspects.includes(m.aspect) ? m.aspect : nearestOption(sourceAspect, aspects.filter(a => a !== 'auto'));
  assert.ok(aspect, id + ': supported aspect');
  const category = CATEGORY[m.categories.find(c => CATEGORY[c])] || 'YOUR PHOTO';
  const previewPath = '/showcase/images/' + id + '.webp';
  const destination = resolve(root, 'public' + previewPath);
  if (existsSync(destination)) assert.equal(sha(readFileSync(destination)), e.imageSha256, id + ': existing preview');
  else if (!checkOnly) copyFileSync(resolve(input, 'encoded/' + id + '.webp'), destination);
  records[id] = { prompt: m.prompt, promptSha256: m.promptSha256, sourcePromptAvailable: true,
    sourceAuditStatus: 'verified-' + AUDITED, sourceRecordId: m.recordId, sourceMediaId: mediaId(m.mediaUrl), sourceTitle: m.title, sourceSlug: m.slug,
    sourceModel: m.sourceModel, sourceModelFamily: m.sourceModelFamily, sourceAspect: m.aspect, sourceMinFiles: m.sourceMinFiles,
    sourceGenerationSettings: m.sourceSettings };
  templates.push({ id, name, model: MODEL, aspect, photo: { required: true, count: 1 }, category, previewImage: previewPath,
    previewAspect: `${e.width} / ${e.height}`, bg: 'linear-gradient(145deg,#152a38,#61516c 65%,#be9b7d)', promptOrigin: 'community-source-exact' });
  audit.push({ id, name, category, sourceRecordId: m.recordId, sourceMediaId: mediaId(m.mediaUrl), sourceSlug: m.slug, sourceTitle: m.title, sourceModel: m.sourceModel,
    sourceAspect: m.aspect, aspect, sourceMinFiles: m.sourceMinFiles, sourcePromptSha256: m.promptSha256,
    normalizedPromptSha256: sha(normalize(m.prompt)), sourceMediaUrl: m.mediaUrl, sourceAssetSha256: m.mediaSha256,
    localPreviewSha256: e.imageSha256, localPreviewBytes: e.imageBytes, previewPath, publishedAt: m.publishedAt, prompt: m.prompt });
}
const header = '// Generated offline by scripts/import-syntx-photo-images.mjs; exact text joins at registration.\n';
write('app/veyrnox/_lib/syntxPhotoImageRecords.js', header + 'export const SYNTX_PHOTO_IMAGE_RECORDS = Object.freeze({\n' +
  Object.entries(records).map(([id, r]) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(r)).join(',\n') + '\n});\n');
write('app/veyrnox/_lib/imageTemplatesSyntxPhoto.js', header + "import { SYNTX_PHOTO_IMAGE_RECORDS } from './syntxPhotoImageRecords.js';\nexport const SYNTX_PHOTO_IMAGE_TEMPLATES = Object.freeze([\n" +
  templates.map(r => '  ' + JSON.stringify(r)).join(',\n') + "\n].map(t => Object.freeze({ ...t, kind: 'image', isNew: true, photo: Object.freeze(t.photo), prompt: SYNTX_PHOTO_IMAGE_RECORDS[t.id].prompt })));\n");
write('tests/fixtures/syntxPhotoImagePromptHashes.json', json(Object.fromEntries(audit.map(r => [r.id, r.sourcePromptSha256]))));
write('docs/product/source-audit/' + AUDIT_FILE, json({ source: 'Syntx Trends', api: 'https://api.syntx.ai/api/v1/trends', auditedAt: AUDITED,
  prepared: PREPARED, accepted: audit.length, rejected, model: MODEL,
  selection: 'Image Trends with min_files_count = 1 (the person supplies one photo), English prompt, no brand or platform name, not already in the catalog.',
  manifestSha256: sha(read('manifest.json')), encodeReportSha256: sha(read('encode-report.json')),
  addedBytes: audit.reduce((sum, r) => sum + r.localPreviewBytes, 0), records: audit }));
console.log((checkOnly ? 'Checked ' : 'Imported ') + audit.length + ' image templates; rejected ' + rejected.length + '; ' + audit.reduce((sum, r) => sum + r.localPreviewBytes, 0) + ' shipped bytes.');
