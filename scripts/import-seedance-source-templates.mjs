#!/usr/bin/env node

/**
 * Build the audited 200-template Seedance collection requested on 2026-10-29.
 *
 * Inputs are immutable captures made on the audit date:
 *   /private/tmp/syntx-trends-p{1..4}-100.json
 *   /private/tmp/higgsfield-seedance-community.html
 *
 * The script deliberately separates original source-model provenance from the
 * active Veyrnox route. Source prompts are copied byte-for-byte. New preview
 * files are complete, lower-bandwidth encodes of their paired source videos.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYN_DIR = process.env.SEEDANCE_SYNTX_CAPTURE_DIR || '/private/tmp';
const HIGGS_HTML = process.env.SEEDANCE_HIGGS_CAPTURE || '/private/tmp/higgsfield-seedance-community.html';
const TMP = process.env.SEEDANCE_IMPORT_TMP || '/private/tmp/veyrnox-seedance-import';
const DRY_RUN = process.argv.includes('--dry-run');
const SINTX_TARGET = 121;
const HIGGS_PAGE_RECORDS = 80;
const HIGGS_TARGET = 79;
const TOTAL_TARGET = SINTX_TARGET + HIGGS_TARGET;
const RUNNABLE_MODEL = 'Seedance 2.0 Fast';
const RUNNABLE_CREDITS = 19;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizedPrompt = (value) => String(value).replace(/\r\n/g, '\n').trim();
const slugify = (value) => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 62);
const titleCase = (value) => String(value).toLowerCase().replace(/(^|\s|[-–—])\S/g, (letter) => letter.toUpperCase());
const basenameId = (url) => path.basename(new URL(url).pathname).replace(/\.[^.]+$/, '');
const exists = async (file) => access(file, fsConstants.F_OK).then(() => true, () => false);
const nonEmpty = async (file) => stat(file).then((value) => value.size > 0, () => false);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', options.capture ? 'pipe' : 'ignore', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-2000)}`));
    });
  });
}

async function mapLimit(values, limit, worker) {
  const output = new Array(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      output[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

function referenceCount(prompt, kind) {
  const matches = [];
  const expressions = [
    new RegExp(`@${kind}\\s*[_-]?(\\d+)`, 'gi'),
    new RegExp(`<<<\\s*${kind}[_\\s-]*(\\d+)\\s*>>>`, 'gi'),
    new RegExp(`\\b${kind}\\s+(\\d+)\\b`, 'gi'),
  ];
  for (const expression of expressions) {
    for (const match of String(prompt).matchAll(expression)) matches.push(Number(match[1]));
  }
  return matches.length ? Math.max(...matches) : 0;
}

function categoryFor(prompt, sourceCategories = []) {
  const text = `${sourceCategories.join(' ')} ${prompt}`.toLowerCase();
  if (/product|commercial|advert|packaging|brand|jewelry|perfume/.test(text)) return 'PRODUCTS';
  if (/fashion|outfit|runway|wardrobe|editorial|dress|jacket/.test(text)) return 'FASHION';
  if (/anime|animated|cartoon|anthropomorphic|stylized cg/.test(text)) return 'CARTOONS';
  if (/fantasy|magic|mage|dragon|samurai|demon|supernatural|superhero/.test(text)) return 'FANTASY';
  if (/film|cinematic|movie|thriller|western|scene/.test(text)) return 'CINEMATIC';
  if (/vfx|transform|morph|energy|shockwave|explod|crash|slow motion/.test(text)) return 'VFX';
  return 'REALISTIC';
}

function sourceAspect(width, height) {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  const candidates = [['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]];
  return candidates.sort((a, b) => Math.abs(ratio - a[1]) - Math.abs(ratio - b[1]))[0][0];
}

function generatedTitle(prompt, index) {
  const words = String(prompt).replace(/@[a-z]+\s*\d+/gi, '').replace(/[^a-zA-Z0-9' -]+/g, ' ')
    .split(/\s+/).filter(Boolean).filter((word) => !['a', 'an', 'the', 'of', 'with', 'in', 'on', 'and'].includes(word.toLowerCase()));
  const title = titleCase(words.slice(0, 6).join(' '));
  return title || `Seedance Community ${String(index + 1).padStart(3, '0')}`;
}

function pickSyntxVideo(item) {
  const videos = item.media.filter((media) => media.mime_type === 'video/mp4');
  return videos
    .filter((media) => media.type === 'compressed')
    .sort((a, b) => (a.size || Infinity) - (b.size || Infinity))[0]
    || videos.find((media) => media.type === 'original')
    || videos[0];
}

function parseHiggsfield(html) {
  const clean = html.replaceAll('\u0000', '');
  const match = clean.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Higgsfield Seedance JSON-LD was not found');
  const page = JSON.parse(match[1]);
  const items = page?.mainEntity?.itemListElement;
  if (!Array.isArray(items) || items.length !== HIGGS_PAGE_RECORDS) {
    throw new Error(`Expected ${HIGGS_PAGE_RECORDS} Higgsfield Seedance records, received ${items?.length ?? 0}`);
  }
  return items;
}

async function ffprobe(file) {
  const output = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
  ], { capture: true });
  const parsed = JSON.parse(output.toString('utf8'));
  return {
    width: parsed.streams?.[0]?.width || 0,
    height: parsed.streams?.[0]?.height || 0,
    duration: Number(parsed.format?.duration || 0),
  };
}

async function visualSignature(file) {
  const frames = await run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', 'fps=1,scale=32:32:flags=area,format=gray',
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ], { capture: true });
  return sha256(frames);
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}) ${url}`);
  const partial = `${destination}.partial`;
  await writeFile(partial, Buffer.from(await response.arrayBuffer()));
  await rename(partial, destination);
}

async function resolveHiggsVideo(url) {
  const parsed = new URL(url);
  const minPath = parsed.pathname.replace(/\.mp4$/i, '_min.mp4');
  const candidates = [
    `https://cdn.higgsfield.ai${minPath}`,
    `https://d8j0ntlcm91z4.cloudfront.net${minPath}`,
    url,
  ];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { method: 'HEAD', redirect: 'follow' });
      if (response.ok) return candidate;
    } catch {}
  }
  return url;
}

async function createPreview(record) {
  const targetVideo = path.join(ROOT, 'public/showcase', `viral-${record.id}.mp4`);
  const targetPoster = path.join(ROOT, 'public/showcase', `viral-${record.id}.jpg`);
  await mkdir(path.dirname(targetVideo), { recursive: true });
  await mkdir(TMP, { recursive: true });
  if (!await nonEmpty(targetVideo)) {
    const input = path.join(TMP, `${record.id}.source`);
    const sourceUrl = record.sourcePlatform === 'Higgsfield'
      ? await resolveHiggsVideo(record.sourceMediaUrl)
      : record.sourceMediaUrl;
    await download(sourceUrl, input);
    await run('ffmpeg', [
      '-y', '-v', 'error', '-i', input,
      '-vf', "scale=720:720:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', targetVideo,
    ]);
    await rm(input, { force: true });
  }
  if (!await exists(targetPoster)) {
    await run('ffmpeg', [
      '-y', '-v', 'error', '-ss', '0.5', '-i', targetVideo,
      '-frames:v', '1', '-vf', "scale='min(720,iw)':-2:force_original_aspect_ratio=decrease",
      '-q:v', '4', targetPoster,
    ]);
  }
  const [video, poster, probe, signature] = await Promise.all([
    readFile(targetVideo), readFile(targetPoster), ffprobe(targetVideo), visualSignature(targetVideo),
  ]);
  return {
    ...record,
    previewPath: `/showcase/viral-${record.id}.mp4`,
    posterPath: `/showcase/viral-${record.id}.jpg`,
    previewAspect: `${probe.width} / ${probe.height}`,
    sourceAspect: sourceAspect(probe.width, probe.height),
    durationSeconds: Math.max(1, Math.round(probe.duration)),
    localPreviewSha256: sha256(video),
    localPreviewBytes: video.length,
    localPosterSha256: sha256(poster),
    localPosterBytes: poster.length,
    sourceVideoSignature: signature,
  };
}

async function existingRecordAsset(record, templateById) {
  const template = templateById.get(record.id);
  const clip = template && SHOWCASE_CLIPS[template.clipKey];
  if (!clip?.video) throw new Error(`Existing Seedance record ${record.id} has no public video`);
  const file = path.join(ROOT, 'public', clip.video.replace(/^\//, '').replace(/^showcase\//, 'showcase/'));
  const posterFile = clip.poster ? path.join(ROOT, 'public', clip.poster.replace(/^\//, '')) : null;
  const [video, probe, signature] = await Promise.all([readFile(file), ffprobe(file), visualSignature(file)]);
  const poster = posterFile && await exists(posterFile) ? await readFile(posterFile) : null;
  return {
    ...record,
    previewPath: clip.video,
    posterPath: clip.poster || null,
    previewAspect: clip.aspectRatio || `${probe.width} / ${probe.height}`,
    sourceAspect: sourceAspect(probe.width, probe.height),
    durationSeconds: template.durationSeconds || Math.max(1, Math.round(probe.duration)),
    localPreviewSha256: sha256(video),
    localPreviewBytes: video.length,
    localPosterSha256: poster ? sha256(poster) : null,
    localPosterBytes: poster?.length || 0,
    sourceVideoSignature: signature,
    existing: true,
  };
}

function moduleFile(exportName, value, heading) {
  return `${heading}\nexport const ${exportName} = Object.freeze(${JSON.stringify(value, null, 2)});\n`;
}

function templateExpansionFile(records) {
  const templates = records.map((record) => ({
    id: record.id,
    name: record.title.toUpperCase(),
    clipKey: record.id,
    model: RUNNABLE_MODEL,
    credits: RUNNABLE_CREDITS,
    // The preview keeps its complete source duration. The active Seedance 2.0
    // Fast route offers 5s/10s generations, so template handoff uses 10s.
    durationSeconds: 10,
    category: record.category,
    isNew: true,
    previewAspect: record.previewAspect,
    sourceAspect: record.sourceAspect,
    bg: 'linear-gradient(155deg,#0d1525 0%,#334c73 55%,#9a6f86 100%)',
    needs: record.referenceImageCount > 1
      ? 'One starting image containing every subject in their intended positions'
      : 'A clear full-body portrait with room for cinematic movement',
    needsKey: record.referenceImageCount > 1 ? 'community.group' : 'community.cinematic',
    prompt: record.prompt,
    promptOrigin: 'community-source-exact',
    sourceModel: record.sourceModel,
    sourcePlatform: record.sourcePlatform,
    sourceUrl: record.sourceUrl,
    steps: [
      'Prepare your starting image using the guidance above.',
      'Use this template to load its prompt and settings in the studio.',
      'Upload your image, edit the prompt if needed, and review the price before generating.',
    ],
    inspired: false,
  }));
  const clips = Object.fromEntries(records.map((record) => [record.id, {
    video: record.previewPath,
    poster: record.posterPath,
    aspectRatio: record.previewAspect,
    title: record.title,
  }]));
  return `// Generated by scripts/import-seedance-source-templates.mjs.\n// Exact prompts remain byte-for-byte identical to their paired public records.\nexport const SEEDANCE_SOURCE_TEMPLATE_EXPANSION = Object.freeze(${JSON.stringify(templates, null, 2)});\n\nexport const SEEDANCE_SOURCE_SHOWCASE_CLIPS = Object.freeze(${JSON.stringify(clips, null, 2)});\n`;
}

async function main() {
  const syntxPages = await Promise.all([1, 2, 3, 4].map(async (page) => JSON.parse(await readFile(
    path.join(SYN_DIR, `syntx-trends-p${page}-100.json`), 'utf8',
  ))));
  const syntx = syntxPages.flatMap((page) => page.items || []).filter((item) =>
    item.generation_type === 'video'
    && (item.ai_parent === 'seedance' || String(item.generation_settings?.model_type || '').includes('seedance'))
    && typeof item.prompt === 'string' && item.prompt.length > 0
    && pickSyntxVideo(item));
  const higgs = parseHiggsfield(await readFile(HIGGS_HTML, 'utf8'));
  const templateById = new Map(SOURCE_TEMPLATES.map((template) => [template.id, template]));
  const existingByMedia = new Map(Object.entries(SYNTX_SOURCE_PROMPT_RECORDS)
    .filter(([, source]) => source.sourcePromptAvailable && source.sourceMediaId)
    .map(([id, source]) => [source.sourceMediaId, id]));

  const promptHashes = new Set();
  const sourceMedia = new Set();
  const existing = [];
  const newSyntx = [];
  for (const item of syntx) {
    const media = pickSyntxVideo(item);
    const ph = sha256(normalizedPrompt(item.prompt));
    const mediaIds = item.media.map((candidate) => basenameId(candidate.url));
    const existingId = mediaIds.map((id) => existingByMedia.get(id)).find(Boolean);
    if (promptHashes.has(ph) || sourceMedia.has(media.url)) continue;
    promptHashes.add(ph);
    sourceMedia.add(media.url);
    const sourceModel = item.generation_settings?.model_type === 'seedance-2.5' ? 'Seedance 2.5'
      : item.generation_settings?.model_type === 'seedance-2.0' ? 'Seedance 2.0'
        : 'Seedance';
    const base = {
      id: existingId || `seedance-syntx-${slugify(item.slug || item.title || item.id)}`,
      sourcePlatform: 'Syntx',
      sourceModel,
      sourceUrl: `https://syntx.ai/trends/${item.slug}`,
      sourceRecordId: item.id,
      sourceTitle: item.title,
      sourceSlug: item.slug,
      sourceMediaId: basenameId(media.url),
      sourceMediaUrl: media.url,
      prompt: item.prompt,
      sourcePromptSha256: sha256(item.prompt),
      normalizedPromptSha256: ph,
      referenceImageCount: referenceCount(item.prompt, 'image'),
      referenceVideoCount: referenceCount(item.prompt, 'video'),
      sourceSettings: item.generation_settings || {},
      title: item.title,
      category: categoryFor(item.prompt, (item.categories || []).map((category) => category.title)),
      needs: 'The reference media named in this exact community prompt',
    };
    (existingId ? existing : newSyntx).push(base);
  }
  if (existing.length !== 78) throw new Error(`Expected 78 existing Syntx Seedance templates, found ${existing.length}`);
  const chosenNewSyntx = newSyntx.slice(0, SINTX_TARGET - existing.length);
  if (chosenNewSyntx.length !== 43) throw new Error(`Expected 43 new Syntx Seedance templates, found ${chosenNewSyntx.length}`);

  const higgsRecords = higgs.map((item, index) => {
    const publicationId = item.video.url.split('/').pop();
    const prompt = item.description;
    const ph = sha256(normalizedPrompt(prompt));
    if (promptHashes.has(ph)) throw new Error(`Higgsfield prompt duplicates selected Syntx prompt: ${publicationId}`);
    if (sourceMedia.has(item.video.contentUrl)) throw new Error(`Higgsfield video URL duplicated: ${item.video.contentUrl}`);
    promptHashes.add(ph);
    sourceMedia.add(item.video.contentUrl);
    return {
      id: `seedance-higgs-${publicationId.slice(0, 8)}`,
      sourcePlatform: 'Higgsfield',
      sourceModel: 'Seedance 2.0',
      sourceUrl: item.video.url,
      sourceRecordId: publicationId,
      sourceTitle: item.name,
      sourceSlug: null,
      sourceMediaId: basenameId(item.video.contentUrl),
      sourceMediaUrl: item.video.contentUrl,
      prompt,
      sourcePromptSha256: sha256(prompt),
      normalizedPromptSha256: ph,
      referenceImageCount: referenceCount(prompt, 'image'),
      referenceVideoCount: referenceCount(prompt, 'video'),
      sourceSettings: { model_type: 'seedance-2.0' },
      title: generatedTitle(prompt, index),
      category: categoryFor(prompt),
      needs: referenceCount(prompt, 'image')
        ? 'The reference images named in this exact community prompt'
        : 'An optional starting image when you want to preserve a subject',
    };
  });

  const selected = [...existing, ...chosenNewSyntx, ...higgsRecords];
  if (selected.length !== TOTAL_TARGET + 1) throw new Error(`Expected ${TOTAL_TARGET + 1} candidates before visual deduplication, found ${selected.length}`);
  if (new Set(selected.map((record) => record.id)).size !== TOTAL_TARGET + 1) throw new Error('Template id duplicate in Seedance selection');
  if (DRY_RUN) {
    console.log(JSON.stringify({ candidates: selected.length, acceptedTarget: TOTAL_TARGET, existing: existing.length, newSyntx: chosenNewSyntx.length, higgsCandidates: higgsRecords.length, higgsAcceptedTarget: HIGGS_TARGET }, null, 2));
    return;
  }

  console.log(`Auditing ${existing.length} existing Seedance previews...`);
  const existingWithAssets = await mapLimit(existing, 4, (record) => existingRecordAsset(record, templateById));
  const existingSignatures = new Set(existingWithAssets.map((record) => record.sourceVideoSignature));
  if (existingSignatures.size !== existingWithAssets.length) throw new Error('Duplicate video among the 78 existing Seedance templates');

  console.log(`Encoding ${chosenNewSyntx.length} new Syntx Seedance previews...`);
  const syntxWithAssets = await mapLimit(chosenNewSyntx, 2, createPreview);
  console.log(`Encoding ${higgsRecords.length} Higgsfield Seedance previews...`);
  const higgsCandidatesWithAssets = await mapLimit(higgsRecords, 2, createPreview);
  const seenSignatures = new Set([...existingWithAssets, ...syntxWithAssets].map((record) => record.sourceVideoSignature));
  const higgsWithAssets = [];
  const rejectedHiggs = [];
  for (const record of higgsCandidatesWithAssets) {
    if (seenSignatures.has(record.sourceVideoSignature)) rejectedHiggs.push(record);
    else {
      seenSignatures.add(record.sourceVideoSignature);
      higgsWithAssets.push(record);
    }
  }
  if (higgsWithAssets.length !== HIGGS_TARGET || rejectedHiggs.length !== 1) {
    throw new Error(`Expected 79 unique Higgsfield videos and one visual duplicate, received ${higgsWithAssets.length} and ${rejectedHiggs.length}`);
  }
  for (const record of rejectedHiggs) {
    await rm(path.join(ROOT, 'public/showcase', `viral-${record.id}.mp4`), { force: true });
    await rm(path.join(ROOT, 'public/showcase', `viral-${record.id}.jpg`), { force: true });
  }
  const complete = [...existingWithAssets, ...syntxWithAssets, ...higgsWithAssets];
  const signatures = complete.map((record) => record.sourceVideoSignature);
  if (new Set(signatures).size !== TOTAL_TARGET) {
    const groups = Object.groupBy(complete, (record) => record.sourceVideoSignature);
    const duplicates = Object.values(groups).filter((records) => records.length > 1)
      .map((records) => records.map(({ id, sourcePlatform, sourceMediaUrl }) => ({ id, sourcePlatform, sourceMediaUrl })));
    console.error(JSON.stringify({ duplicateVideoGroups: duplicates }, null, 2));
    throw new Error('Normalized video signature duplicate in Seedance selection');
  }
  if (new Set(complete.map((record) => record.normalizedPromptSha256)).size !== TOTAL_TARGET) throw new Error('Normalized prompt duplicate in Seedance selection');

  const newRecords = [...syntxWithAssets, ...higgsWithAssets];
  const sourcePromptRecords = Object.fromEntries(newRecords.map((record) => [record.id, {
    sourcePromptAvailable: true,
    sourceTitle: record.sourceTitle,
    sourceSlug: record.sourceSlug,
    sourceMediaId: record.sourceMediaId,
    sourceAuditStatus: 'verified-2026-10-29',
    prompt: record.prompt,
  }]));
  const metadata = Object.fromEntries(complete.map((record) => [record.id, {
    sourcePlatform: record.sourcePlatform,
    sourceModel: record.sourceModel,
    sourceUrl: record.sourceUrl,
    runnableModel: RUNNABLE_MODEL,
  }]));
  const manifest = {
    sources: ['https://higgsfield.ai/seedance-2-community', 'https://syntx.ai/trends'],
    apis: ['Higgsfield JSON-LD', 'https://api.syntx.ai/api/v1/trends'],
    auditedAt: '2026-10-29',
    requested: TOTAL_TARGET,
    accepted: complete.length,
    sourceCounts: { Higgsfield: higgsWithAssets.length, Syntx: existingWithAssets.length + syntxWithAssets.length },
    changeCounts: { correctedExisting: existingWithAssets.length, added: newRecords.length },
    duplicateChecks: {
      uniqueTemplateIds: new Set(complete.map((record) => record.id)).size,
      uniquePromptHashes: new Set(complete.map((record) => record.normalizedPromptSha256)).size,
      uniqueSourceMediaUrls: new Set(complete.map((record) => record.sourceMediaUrl)).size,
      uniqueNormalizedVideoSignatures: new Set(complete.map((record) => record.sourceVideoSignature)).size,
    },
    records: complete,
  };

  const promptModule = moduleFile(
    'SEEDANCE_SOURCE_PROMPT_RECORDS', sourcePromptRecords,
    '// Generated by scripts/import-seedance-source-templates.mjs.\n// Exact public prompts; do not edit, normalize, or truncate.',
  );
  const metadataModule = moduleFile(
    'SEEDANCE_200_TEMPLATE_METADATA', metadata,
    '// Generated by scripts/import-seedance-source-templates.mjs.\n// Source provenance is separate from the active Veyrnox generation route.',
  );
  await Promise.all([
    writeFile(path.join(ROOT, 'app/veyrnox/_lib/seedanceSourcePromptRecords.js'), promptModule),
    writeFile(path.join(ROOT, 'app/veyrnox/_lib/seedanceTemplateMetadata.js'), metadataModule),
    writeFile(path.join(ROOT, 'app/veyrnox/_lib/sourceTemplateExpansion13.js'), templateExpansionFile(newRecords)),
    writeFile(path.join(ROOT, 'docs/product/source-audit/seedance-200-exact-2026-10-29.json'), `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
  await rm(TMP, { recursive: true, force: true });
  console.log(JSON.stringify({ total: complete.length, existing: existingWithAssets.length, added: newRecords.length, bytes: newRecords.reduce((sum, record) => sum + record.localPreviewBytes + record.localPosterBytes, 0) }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
