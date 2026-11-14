#!/usr/bin/env node
// Owner-operated only. Dry runs download previews but never upload or install a manifest.
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TEMPLATE_CLIPS, publicTemplateClip } from '../app/veyrnox/_lib/templateClips.js';
import { capabilityFor, checkSource } from '../lib/modelCapabilities.js';
import { TEMPLATE_CLIP_MODEL, TEMPLATE_CLIP_MODELS } from '../lib/templateClipGeneration.js';
import { envConfig, isConfigured, sha256Hex } from '../packages/adapters/r2.js';
import { outsideRepo, boundedBytes, MAX_BYTES, assertMp4, measure, normalise, verifyUpload } from './import-swap-scenes.mjs';

const fail = code => { throw new Error(code); };
export function sourceUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('invalid_source_url'); }
  if (url.protocol !== 'https:' || url.host !== 'veyrnox.ai' || url.username || url.password || url.hash || url.search
      || !/^\/showcase\/[a-zA-Z0-9_-]+\.mp4$/.test(url.pathname)
      || /[\\\s]/.test(raw) || raw.includes('%') || raw.includes('/../') || raw.includes('/./')) fail('source_url_not_allowed');
  return url;
}

// Exactly the canonical preview used by publicPresets: never source-record URLs.
export function canonicalPreview(id) {
  if (!publicTemplateClip(id)) fail('unknown_template_clip');
  const preview = TEMPLATE_CLIPS.find(clip => clip.id === id)?.previewFile;
  return sourceUrl(`https://veyrnox.ai/showcase/${preview}`).href;
}

export function validateDecision(entry) {
  const url = canonicalPreview(entry?.id);
  if (entry.previewUrl !== undefined && sourceUrl(entry.previewUrl).href !== url) fail('template_preview_mismatch');
  return url;
}

export async function downloadClip(raw, destination, fetchImpl = fetch) {
  const url = sourceUrl(raw);
  const response = await fetchImpl(url.href, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
  if (response.status >= 300 && response.status < 400 || response.redirected) {
    await response.body?.cancel(); fail('source_redirect_refused');
  }
  if (!response.ok) { await response.body?.cancel(); fail('source_download_failed'); }
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'video/mp4') {
    await response.body?.cancel(); fail('source_not_mp4');
  }
  const bytes = await boundedBytes(response);
  assertMp4(bytes);
  await writeFile(destination, bytes, { flag: 'wx' });
}

// Only a generated registry file name can reach disk. Symlinks cannot escape the showcase root.
export async function localClip(id, destination, showcaseDir, download = downloadClip) {
  const url = canonicalPreview(id);
  const file = new URL(url).pathname.slice('/showcase/'.length);
  const root = path.resolve(showcaseDir), candidate = path.resolve(root, file);
  if (path.dirname(candidate) !== root) fail('source_path_not_allowed');
  let resolved;
  try { resolved = await realpath(candidate); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return download(url, destination);
  }
  if (path.dirname(resolved) !== await realpath(root)) fail('source_path_not_allowed');
  if ((await stat(resolved)).size > MAX_BYTES) fail('source_over_cap');
  const bytes = await readFile(resolved); assertMp4(bytes);
  await writeFile(destination, bytes, { flag: 'wx' });
}

export function manifestModule(manifest) {
  // Tuple encoding avoids repeating keys, hashes and field names in hundreds of Worker entries.
  const rows = Object.entries(manifest).map(([id, m]) => [id, m.sha256, m.seconds, m.videoSeconds, m.width, m.height, m.frameRate, m.sizeBytes]);
  const candidateModule = `// SERVER ONLY. Owner-reviewed import candidate.\nexport const TEMPLATE_CLIP_SOURCES = Object.freeze(Object.fromEntries(${JSON.stringify(rows)}.map(([id, sha256, seconds, videoSeconds, width, height, frameRate, sizeBytes]) => [id, { key: \`template-clips/\${id}/\${sha256}.mp4\`, version: sha256.slice(0, 12), sha256, seconds, videoSeconds, width, height, frameRate, sizeBytes, contentType: 'video/mp4' }])));\n`;
  if (Buffer.byteLength(candidateModule) > 150_000) fail('manifest_sharding_required');
  return candidateModule;
}

export async function importTemplateClips({ decisions, all = false, chunkSize = 50, offset = 0, resumeDir, showcaseDir = fileURLToPath(new URL('../public/showcase/', import.meta.url)), outDir, upload = false, confirmBucket, modelId = TEMPLATE_CLIP_MODEL,
  r2 = envConfig(), download = downloadClip, storage } = {}) {
  if (!Object.hasOwn(TEMPLATE_CLIP_MODELS, modelId)) fail('template_clip_model_mismatch');
  const kie = modelId === 'seedance-2.0-reference-kie';
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || !Number.isSafeInteger(offset) || offset < 0) fail('invalid_chunk');
  if (all && !decisions) decisions = TEMPLATE_CLIPS.map(({ id }) => ({ id, approved: !upload }));
  if (!Array.isArray(decisions)) fail('decisions_must_be_array');
  if (typeof upload !== 'boolean') fail('explicit_upload_required');
  if (upload && (!isConfigured(r2) || !confirmBucket || confirmBucket !== r2.bucket)) fail('confirmed_r2_bucket_required');
  const approved = [], seen = new Set();
  // Validate the entire list before downloading even one item.
  for (const entry of decisions) {
    const url = validateDecision(entry);
    if (seen.has(entry.id)) fail('duplicate_template_id');
    seen.add(entry.id);
    if (entry.approved === true) approved.push({ id: entry.id, url });
  }
  if (all) decisions = [...decisions, ...TEMPLATE_CLIPS.filter(c => !seen.has(c.id)).map(({ id }) => ({ id, approved: false }))];
  const base = await outsideRepo(outDir || tmpdir());
  await mkdir(base, { recursive: true });
  const runDir = resumeDir ? await outsideRepo(resumeDir) : await mkdtemp(path.join(base, 'template-clips-'));
  const manifest = {}, files = [];
  const report = { dryRun: !upload, publishable: false, modelId, results: decisions.filter(e => e.approved !== true).map(e => ({ id: e.id, status: 'skipped', reason: 'rights_not_approved' })) };
  if (upload && all && !approved.length) fail('approved_decisions_required');
  let completed = {};
  if (resumeDir) {
    const previous = JSON.parse(await readFile(path.join(runDir, 'checkpoint.json'), 'utf8'));
    if (previous.modelId !== modelId || previous.upload !== upload) fail('resume_mode_mismatch');
    completed = previous.completed;
  }
  const selected = approved.slice(offset);
  report.results.push(...approved.slice(0, offset).map(e => ({ id: e.id, status: 'skipped', reason: 'before_offset' })));
  try {
    for (let index = 0; index < selected.length; index++) {
      const entry = selected[index];
      // Resume revalidates normalized bytes and the registry identity; no arbitrary checkpoint path is read.
      const saved = completed[entry.id];
      if (saved) {
        const file = path.join(runDir, entry.id + '.mp4');
        try {
          const bytes = await readFile(file);
          if (await sha256Hex(bytes) !== saved.sha256) fail('resume_hash_mismatch');
          const measured = await measure(file);
          const checked = checkSource(capabilityFor(TEMPLATE_CLIP_MODELS[modelId]), { video_url: { ...measured, sizeBytes: bytes.length, dimensions: measured } });
          if (!checked.ok || saved.key !== `template-clips/${entry.id}/${saved.sha256}.mp4`) fail('resume_invalid');
          if (measured.codec !== 'h264' || measured.audio || measured.seconds > 5.05 || measured.videoSeconds > 5.05
              || Math.max(measured.width, measured.height) > 1280 || measured.width % 2 || measured.height % 2
              || ['seconds', 'videoSeconds', 'width', 'height', 'frameRate'].some(key => measured[key] !== saved[key])
              || saved.contentType !== 'video/mp4' || saved.sizeBytes !== bytes.length || saved.version !== saved.sha256.slice(0, 12)
              || (kie && [measured.seconds, measured.videoSeconds].some(s => Math.abs(s - 5) > 1 / 30))) fail('resume_invalid');
          manifest[entry.id] = saved; files.push({ id: entry.id, file, sizeBytes: bytes.length });
          report.results.push({ id: entry.id, status: 'skipped', reason: 'resumed' });
          continue;
        } catch { delete completed[entry.id]; }
      }
      const folder = await mkdtemp(path.join(runDir, 'clip-'));
      const input = path.join(folder, 'original.mp4'), output = path.join(folder, 'normalised.mp4');
      try {
        await localClip(entry.id, input, showcaseDir, download);
        const original = await readFile(input);
        if (original.length > MAX_BYTES) fail('source_over_cap');
        assertMp4(original);
        const before = await measure(input);
        if (![before.seconds, before.videoSeconds].every(value => Number.isFinite(value) && value >= 2)) fail('source_too_short');
        const media = await normalise(input, output, false, 5, kie ? 30 : null);
        if (kie && [media.seconds, media.videoSeconds].some(seconds => Math.abs(seconds - 5) > 1 / 30)) fail('kie_reference_requires_five_seconds');
        const bytes = await readFile(output);
        const checked = checkSource(capabilityFor(TEMPLATE_CLIP_MODELS[modelId]), { video_url: {
          ...media, sizeBytes: bytes.length, dimensions: { width: media.width, height: media.height },
        } });
        if (!checked.ok) fail(checked.error);
        if (media.seconds > 5.05 || media.videoSeconds > 5.05 || media.codec !== 'h264' || media.audio || Math.max(media.width, media.height) > 1280
            || media.width % 2 || media.height % 2) fail('normalisation_failed');
        if (bytes.length > MAX_BYTES) fail('source_over_cap');
        const sha256 = await sha256Hex(bytes);
        manifest[entry.id] = { key: `template-clips/${entry.id}/${sha256}.mp4`, version: sha256.slice(0, 12),
          seconds: media.seconds, videoSeconds: media.videoSeconds, width: media.width, height: media.height, pixels: media.width * media.height,
          frameRate: media.frameRate, sizeBytes: bytes.length, contentType: 'video/mp4', sha256 };
        const savedFile = path.join(runDir, entry.id + '.mp4');
        await writeFile(savedFile, bytes);
        files.push({ id: entry.id, file: savedFile, sizeBytes: bytes.length });
        completed[entry.id] = manifest[entry.id];
        report.results.push({ id: entry.id, status: 'normalised' });
      } catch (error) {
        report.results.push({ id: entry.id, status: 'failed', reason: /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'clip_processing_failed' });
      } finally { await rm(folder, { recursive: true, force: true }); }
      if ((index + 1) % chunkSize === 0 || index === selected.length - 1) {
        await writeFile(path.join(runDir, 'checkpoint.json'), JSON.stringify({ modelId, upload, completed }));
        await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
      }
    }
    const candidateModule = manifestModule(manifest);
    report.moduleBytes = Buffer.byteLength(candidateModule);
    if (upload) {
      for (const item of files) await verifyUpload({ ...manifest[item.id], sizeBytes: item.sizeBytes }, await readFile(item.file), r2, storage);
      report.publishable = files.length > 0;
    }
    const revisionDir = path.join(runDir, report.publishable ? 'publishable' : 'preview');
    await mkdir(revisionDir, { recursive: true });
    await writeFile(path.join(revisionDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(path.join(revisionDir, 'templateClipSources.js'), candidateModule);
    await writeFile(path.join(runDir, 'report.txt'), report.results.map(r => `${r.status}: ${r.id}${r.reason ? ' (' + r.reason + ')' : ''}`).join('\n') + '\n');
    return { runDir, revisionDir, manifest, files, report };
  } catch (error) {
    report.error = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'clip_processing_failed';
    throw Object.assign(new Error(report.error), { runDir });
  } finally { await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
}

export async function cli(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'model-id': { type: 'string' }, decisions: { type: 'string' }, 'out-dir': { type: 'string' }, 'dry-run': { type: 'boolean' },
    all: { type: 'boolean' }, 'chunk-size': { type: 'string' }, offset: { type: 'string' }, resume: { type: 'string' },
    upload: { type: 'boolean' }, 'confirm-bucket': { type: 'string' },
  } });
  if (!values.decisions && !values.all) fail('decisions_path_required');
  if (values.upload && values['dry-run']) fail('conflicting_modes');
  const decisions = values.decisions ? JSON.parse(await readFile(await outsideRepo(values.decisions), 'utf8')) : undefined;
  const result = await importTemplateClips({ decisions, all: !!values.all, chunkSize: Number(values['chunk-size'] || 50), offset: Number(values.offset || 0), resumeDir: values.resume, modelId: values['model-id'], outDir: values['out-dir'], upload: !!values.upload, confirmBucket: values['confirm-bucket'] });
  console.log(JSON.stringify({ runDir: result.runDir, ...result.report }));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(/^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'import_failed'); process.exitCode = 1; });
}
