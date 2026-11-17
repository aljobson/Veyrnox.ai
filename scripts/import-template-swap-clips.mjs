#!/usr/bin/env node
// Owner-run importer. No downloads. Dry run by default; never installs a revision.
import { readFile, writeFile, mkdir, mkdtemp, realpath, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TEMPLATE_CLIPS } from '../app/veyrnox/_lib/templateClips.js';
import { templateContract } from '../lib/templateContract.js';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { checkTemplateSwapVideoSource } from '../lib/templateSwapClipGeneration.js';
import { TEMPLATE_SWAP_CLIP_ENDPOINT } from '../app/veyrnox/_lib/templateSwapClips.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { envConfig, isConfigured, sha256Hex } from '../packages/adapters/r2.js';
import { MAX_BYTES, assertMp4, verifyUpload } from './import-swap-scenes.mjs';
import { outsideRepositories, normaliseSwapClip, contactSheet, indexSheet } from './lib/swap-clip-normalise.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const fail = code => { throw new Error(code); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const likenessNote = 'This is a community creator result, not the original input. It may contain third-party likenesses. Owner approval of rights and moderation is required before publication.';

export async function swapCandidates() {
  const ids = Object.values(JSON.parse(await readFile(path.join(repo, 'lib/publicTemplateIds.json'), 'utf8'))).flat();
  return [...new Set(ids)].map(templateContract).filter(c => c && c.class !== 'blocked-needs-video' && swapNeedsSourceVideo(c.sourcePrompt));
}

async function auditRecords() {
  const names = ['higgsfield-300-exact-2026-11-05.json', 'higgsfield-90-exact-2026-10-29.json'];
  const audits = await Promise.all(names.map(name => readFile(path.join(repo, 'docs/product/source-audit', name), 'utf8')));
  return audits.flatMap(text => JSON.parse(text).records);
}

// A registered local basename only; no CDN or other network fallback exists.
export async function verifiedLocalClip(id, record, showcaseDir) {
  const previewFile = TEMPLATE_CLIPS.find(clip => clip.id === id)?.previewFile;
  if (!previewFile || !/^[a-zA-Z0-9_-]+\.mp4$/.test(previewFile)) fail('source_path_not_allowed');
  const root = await realpath(showcaseDir), file = await realpath(path.join(root, previewFile));
  if (path.dirname(file) !== root) fail('source_path_not_allowed');
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail('source_path_not_allowed');
    if (stat.size > MAX_BYTES) fail('too_large');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_BYTES) fail('too_large');
    if (await sha256Hex(bytes) !== record.localPreviewSha256) fail('showcase_hash_mismatch');
    assertMp4(bytes);
  } finally { await handle.close(); }
  return file;
}

function markdown(report) {
  return '# Template swap clip review\n\n' + likenessNote + '\n\n' +
    'Workflow: 1) run with --review-all and review every sheet; 2) copy decisions-template.json outside the repo, set approved:true on clips you accept (keep their sha256); 3) upload run refuses any clip whose fresh hash differs from the reviewed one.\n\n' +
    `Dry run: ${report.dryRun}. Publishable: ${report.publishable}. With record: ${report.withRecord}. No source record: ${report.noSourceRecord}.\n\n` +
    report.results.map(r => `## ${r.id}\n\nOutcome: ${r.outcome}${r.reason ? ' (' + r.reason + ')' : ''}. Verification: ${r.verification || 'no_source_record'}.\n\n` +
      (r.media ? `Measured: ${r.media.width}×${r.media.height}; container ${r.media.seconds}s; video ${r.media.videoSeconds}s; ${r.media.frameRate} fps; ${r.media.sizeBytes} bytes; SHA-256 ${r.media.sha256}.\n\n![Six frames](sheets/${r.id}.jpg)\n\n` : '') +
      `Template prompt: ${r.prompt}\n\n${likenessNote}\n`).join('\n');
}

// Replace whatever list is installed (empty or populated); the emitted ids must equal the given ids exactly.
export function renderSwapRegistry(registry, ids) {
  const pattern = /Object\.freeze\(\[[^\]]*\]\)/;
  if (!pattern.test(registry)) fail('registry_render_failed');
  const rendered = registry.replace(pattern, `Object.freeze(${JSON.stringify(ids)})`);
  const emitted = JSON.parse(/TEMPLATE_SWAP_CLIPS = Object\.freeze\((\[[^\]]*\])\)/.exec(rendered)?.[1] ?? 'null');
  if (JSON.stringify(emitted) !== JSON.stringify(ids)) fail('registry_render_failed');
  return rendered;
}

export async function importTemplateSwapClips({ decisions, outDir, upscale = false, upload = false, reviewAll = false, confirmBucket,
  showcaseDir = path.join(repo, 'public/showcase'), records, r2 = envConfig(), storage } = {}) {
  // Validate every caller-controlled output path before any decisions or source work.
  const base = await outsideRepositories(outDir);
  if (!Array.isArray(decisions)) fail('decisions_must_be_array');
  if (typeof upload !== 'boolean') fail('explicit_upload_required');
  // Two steps: --review-all builds the pack for every candidate; only approved entries carrying the reviewed sha256 can be uploaded.
  if (reviewAll && upload) fail('review_all_not_with_upload');
  if (upload && (!isConfigured(r2) || !confirmBucket || confirmBucket !== r2.bucket)) fail('confirmed_r2_bucket_required');
  const candidates = await swapCandidates(), byId = new Map(candidates.map(c => [c.id, c])), approved = new Set(), seen = new Set(), reviewed = new Map();
  for (const entry of decisions) {
    if (!byId.has(entry?.id)) fail('unknown_template_swap');
    if (seen.has(entry.id)) fail('duplicate_template_id');
    seen.add(entry.id);
    if (entry.approved === true) approved.add(entry.id);
    if (typeof entry.sha256 === 'string') reviewed.set(entry.id, entry.sha256);
  }
  const sourceRecords = records ?? await auditRecords();
  const sourceById = new Map(sourceRecords.filter(r => r.sourceMainMediaUrl).map(r => [r.id, r]));
  const report = { dryRun: !upload, publishable: false, total: candidates.length,
    withRecord: candidates.filter(c => sourceById.has(c.id)).length,
    noSourceRecord: candidates.filter(c => !sourceById.has(c.id)).length, results: [] };
  await mkdir(base, { recursive: true });
  const runDir = await mkdtemp(path.join(base, 'template-swap-clips-'));
  // Fresh exclusive directory prevents existing report/clip symlinks redirecting writes.
  await mkdir(path.join(runDir, 'clips')); await mkdir(path.join(runDir, 'sheets'));
  const manifest = {}, files = [], sheets = [];
  try {
    for (const candidate of candidates) {
      const { id } = candidate, record = sourceById.get(id);
      const result = { id, outcome: record ? 'result_clip_not_original' : 'no_source_record',
        verification: record ? 'result_clip_not_original' : 'no_source_record', prompt: candidate.sourcePrompt, likenessNote,
        approved: approved.has(id) };
      report.results.push(result);
      if (!approved.has(id) && !reviewAll) { result.reason = 'rights_not_approved'; continue; }
      if (!record) continue;
      const output = path.join(runDir, 'clips', id + '.mp4'), sheet = path.join(runDir, 'sheets', id + '.jpg');
      try {
        const input = await verifiedLocalClip(id, record, showcaseDir);
        const media = await normaliseSwapClip(input, output, { upscale });
        const bytes = await readFile(output);
        if (bytes.length > MAX_BYTES) fail('too_large');
        const sha256 = await sha256Hex(bytes);
        const source = { key: `template-swap-clips/${id}/${sha256}.mp4`, version: sha256.slice(0, 12),
          seconds: media.seconds, videoSeconds: media.videoSeconds, width: media.width, height: media.height,
          frameRate: media.frameRate, contentType: 'video/mp4', sha256, sizeBytes: bytes.length };
        const checked = checkTemplateSwapVideoSource(id, source, capabilityFor(TEMPLATE_SWAP_CLIP_ENDPOINT));
        if (!checked.ok) fail(checked.error);
        await contactSheet(output, sheet, media);
        manifest[id] = source; files.push({ id, file: output }); sheets.push({ id, file: sheet });
        result.outcome = 'ok_for_review'; result.media = { ...media, sha256, sizeBytes: bytes.length };
      } catch (error) {
        const reason = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'clip_processing_failed';
        result.outcome = ['showcase_hash_mismatch', 'too_short', 'too_large'].includes(reason) ? reason : 'result_clip_not_original';
        result.reason = reason;
        await rm(output, { force: true }); await rm(sheet, { force: true });
      }
    }
    report.indexSheets = [];
    for (let start = 0; start < sheets.length; start += 6) {
      const group = sheets.slice(start, start + 6), filename = `index-${start / 6 + 1}.jpg`;
      await indexSheet(group.map(item => item.file), path.join(runDir, filename));
      report.indexSheets.push({ file: filename, ids: group.map(item => item.id) });
    }
    await writeFile(path.join(runDir, 'decisions-template.json'), json(candidates.map(({ id }) => ({ id, approved: false, ...(manifest[id] ? { sha256: manifest[id].sha256 } : {}) }))));
    if (upload) {
      // Any failed (or zero) approved candidate fails the run, never a quiet success without a revision.
      if (!approved.size || files.length !== approved.size) fail('approved_candidates_failed');
      for (const item of files) if (reviewed.get(item.id) !== manifest[item.id].sha256) fail('reviewed_hash_mismatch');
      for (const item of files) await verifyUpload(manifest[item.id], await readFile(item.file), r2, storage);
      report.publishable = true;
      const published = path.join(runDir, 'publishable'); await mkdir(published);
      const registry = await readFile(path.join(repo, 'app/veyrnox/_lib/templateSwapClips.js'), 'utf8');
      const rendered = renderSwapRegistry(registry, Object.keys(manifest));
      await writeFile(path.join(published, 'templateSwapClips.js'), rendered);
      await writeFile(path.join(published, 'templateSwapClipSources.js'), `// SERVER ONLY. Owner-approved, fully verified import candidate.\nexport const TEMPLATE_SWAP_CLIP_SOURCES = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`);
    }
    return { runDir, manifest, files, report };
  } catch (error) {
    report.publishable = false;
    report.error = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'import_failed';
    await rm(path.join(runDir, 'publishable'), { recursive: true, force: true });
    throw Object.assign(new Error(report.error), { runDir });
  } finally {
    await writeFile(path.join(runDir, 'report.json'), json(report));
    await writeFile(path.join(runDir, 'report.md'), markdown(report));
  }
}

export async function cli(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    decisions: { type: 'string' }, 'out-dir': { type: 'string' }, upscale: { type: 'boolean' },
    'dry-run': { type: 'boolean' }, 'review-all': { type: 'boolean' }, upload: { type: 'boolean' }, 'confirm-bucket': { type: 'string' },
  } });
  if (values.upload && values['dry-run']) fail('conflicting_modes');
  // Both paths checked before reading decisions or creating any output.
  const outDir = await outsideRepositories(values['out-dir']);
  const decisionsPath = await outsideRepositories(values.decisions);
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8'));
  const result = await importTemplateSwapClips({ decisions, outDir, upscale: values.upscale === true,
    upload: values.upload === true, reviewAll: values['review-all'] === true, confirmBucket: values['confirm-bucket'] });
  console.log(JSON.stringify({ runDir: result.runDir, publishable: result.report.publishable, total: result.report.total }));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(/^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'import_failed'); process.exitCode = 1; });
}
