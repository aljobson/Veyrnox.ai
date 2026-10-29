#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { GENJUTSU_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/genjutsuSourcePromptRecords.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { AUDIT_SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COUNT = 40;
const AUDITED_AT = '2026-10-29';
const API = 'https://api.syntx.ai/api/v1/trends?lang=en&page_size=20&page=';
const scratch = join(tmpdir(), 'veyrnox-syntx-40-import');
const showcase = join(ROOT, 'public/showcase');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizedPrompt = (value) => String(value).replace(/\r\n/g, '\n').trim().replace(/[ \t]+$/gm, '');
const sourceId = (url) => basename(new URL(url).pathname).replace(/\.[^.]+$/, '');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: options.encoding ?? 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stderr || result.stdout}`);
  return result.stdout;
};
const videoSignature = (path) => {
  const bytes = run('ffmpeg', [
    '-nostdin', '-v', 'error', '-i', path, '-t', '5', '-an',
    '-vf', 'fps=2,scale=160:160:force_original_aspect_ratio=decrease,pad=160:160:(ow-iw)/2:(oh-ih)/2:black,format=gray',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { encoding: null });
  return sha256(bytes);
};
const exactReferences = (prompt, kind) => {
  const numbers = [];
  for (const expression of [
    new RegExp(`@${kind}\\s*[_-]?(\\d+)`, 'gi'),
    new RegExp(`<<<\\s*${kind}[_\\s-]*(\\d+)\\s*>>>`, 'gi'),
    new RegExp(`\\b${kind}\\s+(\\d+)\\b`, 'gi'),
  ]) for (const match of prompt.matchAll(expression)) numbers.push(Number(match[1]));
  return numbers.length ? Math.max(...numbers) : 0;
};
const titleCase = (value) => value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const js = (value) => JSON.stringify(value, null, 2);
const categoryFor = (item) => {
  const slugs = new Set(item.categories.map((category) => category.slug));
  if (slugs.has('products')) return 'PRODUCTS';
  if (slugs.has('fashion')) return 'FASHION';
  if (slugs.has('movies')) return 'MOVIES';
  if (slugs.has('fantasy')) return 'FANTASY';
  if (slugs.has('cartoons')) return 'CARTOONS';
  if (slugs.has('anime')) return 'ANIME';
  if (slugs.has('realistic')) return 'REALISTIC';
  return 'VFX';
};
const chooseVideo = (item) => {
  const h264 = item.media
    .filter((media) => media.type === 'compressed' && media.mime_type === 'video/mp4' && /h264/.test(media.variant || ''))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height) || b.size - a.size);
  return h264[0] || item.media.find((media) => media.type === 'original' && media.mime_type === 'video/mp4') || null;
};

mkdirSync(scratch, { recursive: true });
mkdirSync(showcase, { recursive: true });

const existingRecords = { ...GENJUTSU_SOURCE_PROMPT_RECORDS, ...SYNTX_SOURCE_PROMPT_RECORDS };
const promptHashes = new Set(Object.values(existingRecords)
  .filter((record) => record?.sourcePromptAvailable && typeof record.prompt === 'string')
  .flatMap((record) => [sha256(record.prompt), sha256(normalizedPrompt(record.prompt))]));
const existingMediaIds = new Set(Object.values(SYNTX_SOURCE_PROMPT_RECORDS).map((record) => record.sourceMediaId));
const existingTemplateIds = new Set(SOURCE_TEMPLATES.map((template) => template.id));
const sourceAssetHashes = new Set(Object.values(SYNTX_SOURCE_PROMPT_RECORDS).map((record) => record.sourceAssetSha256).filter(Boolean));
const videoSignatures = new Set();

console.log(`Computing visual signatures for ${Object.keys(SYNTX_SOURCE_PROMPT_RECORDS).length} existing Syntx previews...`);
for (const id of Object.keys(SYNTX_SOURCE_PROMPT_RECORDS)) {
  const template = SOURCE_TEMPLATES.find((entry) => entry.id === id);
  const clip = template && AUDIT_SHOWCASE_CLIPS[template.clipKey];
  if (!clip) continue;
  const path = join(ROOT, 'public', clip.video);
  if (existsSync(path)) videoSignatures.add(videoSignature(path));
}

const selected = [];
const rejected = [];
let page = 1;
let totalPages = 1;
while (selected.length < COUNT && page <= totalPages) {
  const response = await fetch(`${API}${page}`);
  if (!response.ok) throw new Error(`Syntx trends page ${page} returned ${response.status}`);
  const payload = await response.json();
  totalPages = Math.ceil(payload.total / payload.page_size);
  console.log(`Page ${page}/${totalPages}: evaluating ${payload.items.length} records`);
  for (const item of payload.items) {
    if (selected.length >= COUNT) break;
    const prompt = typeof item.prompt === 'string' ? item.prompt : '';
    const video = chooseVideo(item);
    const id = item.slug;
    const reject = (reason) => rejected.push({ id, recordId: item.id, reason });
    if (item.generation_type !== 'video' || !prompt || !video) { reject('not-an-exact-video-prompt-pair'); continue; }
    if (existingTemplateIds.has(id) || selected.some((row) => row.id === id)) { reject('template-id-already-present'); continue; }
    const mediaId = sourceId(video.url);
    if (existingMediaIds.has(mediaId) || selected.some((row) => row.sourceMediaId === mediaId)) { reject('source-media-id-duplicate'); continue; }
    const exactPromptHash = sha256(prompt);
    const normalizedPromptHash = sha256(normalizedPrompt(prompt));
    if (promptHashes.has(exactPromptHash) || promptHashes.has(normalizedPromptHash)) { reject('prompt-duplicate'); continue; }

    const sourcePath = join(scratch, `${id}-source.mp4`);
    const sourceResponse = await fetch(video.url);
    if (!sourceResponse.ok) { reject(`source-download-${sourceResponse.status}`); continue; }
    const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
    writeFileSync(sourcePath, sourceBytes);
    const sourceAssetSha256 = sha256(sourceBytes);
    if (sourceAssetHashes.has(sourceAssetSha256) || selected.some((row) => row.sourceAssetSha256 === sourceAssetSha256)) {
      reject('source-bytes-duplicate');
      rmSync(sourcePath, { force: true });
      continue;
    }
    const sourceVideoSignature = videoSignature(sourcePath);
    if (videoSignatures.has(sourceVideoSignature)) {
      reject('normalized-video-duplicate');
      rmSync(sourcePath, { force: true });
      continue;
    }

    const outputVideo = join(showcase, `viral-${id}.mp4`);
    const outputPoster = join(showcase, `viral-${id}.jpg`);
    run('ffmpeg', [
      '-nostdin', '-v', 'error', '-y', '-i', sourcePath, '-t', '5', '-an',
      '-vf', 'scale=if(gt(iw\\,1280)\\,1280\\,iw):-2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '25',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputVideo,
    ]);
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', '0.5', '-i', outputVideo, '-frames:v', '1', '-q:v', '4', outputPoster]);
    const previewBytes = readFileSync(outputVideo);
    if (previewBytes.length > 6 * 1024 * 1024) throw new Error(`${id}: preview exceeds 6 MiB`);

    const width = video.width || item.media.find((media) => media.type === 'original')?.width;
    const height = video.height || item.media.find((media) => media.type === 'original')?.height;
    const category = categoryFor(item);
    const imageReferences = exactReferences(prompt, 'image');
    const record = {
      id,
      sourceRecordId: item.id,
      sourceTitle: item.title,
      sourceSlug: item.slug,
      sourceMediaId: mediaId,
      sourceMediaUrl: video.url,
      sourceAssetSha256,
      sourceVideoSignature,
      sourcePromptSha256: exactPromptHash,
      normalizedPromptSha256: normalizedPromptHash,
      sourceAuditStatus: `verified-${AUDITED_AT}`,
      prompt,
      category,
      previewAspect: `${width} / ${height}`,
      sourceModel: item.generation_settings?.model_type || item.ai_parent,
      sourceSettings: item.generation_settings,
      referenceImageCount: imageReferences,
      referenceVideoCount: exactReferences(prompt, 'video'),
      localPreviewSha256: sha256(previewBytes),
      localPreviewBytes: previewBytes.length,
    };
    selected.push(record);
    promptHashes.add(exactPromptHash);
    promptHashes.add(normalizedPromptHash);
    existingMediaIds.add(mediaId);
    sourceAssetHashes.add(sourceAssetSha256);
    videoSignatures.add(sourceVideoSignature);
    rmSync(sourcePath, { force: true });
    console.log(`${selected.length}/${COUNT} ${id} (${mediaId})`);
  }
  page += 1;
}

if (selected.length !== COUNT) throw new Error(`Only ${selected.length} unique exact pairs were available`);

const sourceRecords = Object.fromEntries(selected.map((row) => [row.id, {
  sourcePromptAvailable: true,
  sourceRecordId: row.sourceRecordId,
  sourceTitle: row.sourceTitle,
  sourceSlug: row.sourceSlug,
  sourceMediaId: row.sourceMediaId,
  sourceMediaUrl: row.sourceMediaUrl,
  sourceAssetSha256: row.sourceAssetSha256,
  sourceVideoSignature: row.sourceVideoSignature,
  sourceAuditStatus: row.sourceAuditStatus,
  prompt: row.prompt,
}]));
writeFileSync(join(ROOT, 'app/veyrnox/_lib/syntxSourcePromptExpansion40Records.js'),
  `// Exact prompt/video pairs from Syntx's public read-only Trends API.\n// Generated by scripts/import-syntx-40.mjs on ${AUDITED_AT}; do not hand-edit prompt text.\nexport const SYNTX_SOURCE_PROMPT_EXPANSION_40_RECORDS = Object.freeze(${js(sourceRecords)});\n`);

const recipeRows = selected.map((row) => [row.id, row.sourceTitle.toUpperCase(), row.category, row.previewAspect, row.referenceImageCount > 1]);
writeFileSync(join(ROOT, 'app/veyrnox/_lib/sourceTemplateExpansion11.js'), `const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true, promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, extra limbs, flicker, captions, logos, watermark',
};
const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];
const recipes = ${js(recipeRows)};
export const SYNTX_40_TEMPLATE_IDS = Object.freeze(recipes.map(([id]) => id));
export const SOURCE_TEMPLATE_EXPANSION_11 = recipes.map(([id, name, category, previewAspect, group]) => ({
  ...base, id, name, category, previewAspect, clipKey: id, steps,
  needsKey: group ? 'community.group' : 'community.cinematic',
  needs: group ? 'One starting image containing every subject in their intended positions' : 'A clear full-body portrait with room for cinematic movement',
  bg: 'linear-gradient(155deg,#111923 0%,#455669 55%,#c99672 100%)',
  prompt: \`Animate the uploaded reference into an original ten-second ${'${name.toLowerCase()}'} sequence based on the verified source concept. Preserve every supplied subject's recognizable identity, design, proportions, materials, colours, clothing and role throughout. Keep anatomy and object geometry stable, physical contact coherent and motion naturally weighted. Use controlled camera movement, consistent lighting and no captions, logos or watermark.\`,
}));
export const SHOWCASE_CLIP_EXPANSION_11 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_11.map((entry) => [entry.clipKey, {
  video: \`/showcase/viral-${'${entry.id}'}.mp4\`, poster: \`/showcase/viral-${'${entry.id}'}.jpg\`,
  aspectRatio: entry.previewAspect, title: entry.name.toLowerCase().replace(/(^|\\s)\\S/g, (letter) => letter.toUpperCase()),
}]));
`);

writeFileSync(join(ROOT, 'tests/fixtures/syntx40PromptHashes.mjs'),
  `export const SYNTX_40_PROMPT_SHA256 = Object.freeze(${js(Object.fromEntries(selected.map((row) => [row.id, row.sourcePromptSha256])))});\n`);
writeFileSync(join(ROOT, 'tests/fixtures/syntx40SourceAssetHashes.mjs'),
  `export const SYNTX_40_SOURCE_ASSET_SHA256 = Object.freeze(${js(Object.fromEntries(selected.map((row) => [row.id, row.sourceAssetSha256])))});\nexport const SYNTX_40_VIDEO_SIGNATURES = Object.freeze(${js(Object.fromEntries(selected.map((row) => [row.id, row.sourceVideoSignature])))});\n`);

const manifest = {
  source: 'https://syntx.ai/trends', api: 'https://api.syntx.ai/api/v1/trends', auditedAt: AUDITED_AT,
  requested: COUNT, accepted: selected.length, rejectionCounts: Object.fromEntries(Object.entries(Object.groupBy(rejected, (row) => row.reason)).map(([reason, rows]) => [reason, rows.length])),
  records: selected,
};
mkdirSync(join(ROOT, 'docs/product/source-audit'), { recursive: true });
writeFileSync(join(ROOT, 'docs/product/source-audit/syntx-40-2026-10-29.json'), `${js(manifest)}\n`);

const rows = selected.map((row) => `| \`${row.id}\` | ${row.sourceTitle.replace(/\|/g, '\\|')} | [SYNTX](${row.sourceMediaUrl}) | 0 s |`).join('\n');
writeFileSync(join(scratch, 'showcase-rows.md'), `${rows}\n`);
const auditRows = selected.map((row) => `| \`${row.id}\` | New 40 | ${row.sourceTitle.replace(/\|/g, '\\|')} | Complete | \`${row.sourceMediaId}\` | \`${row.sourcePromptSha256}\` |`).join('\n');
writeFileSync(join(scratch, 'audit-rows.md'), `${auditRows}\n`);

console.log(JSON.stringify({ accepted: selected.length, pagesRead: page - 1, rejected: manifest.rejectionCounts, ids: selected.map((row) => row.id) }, null, 2));
