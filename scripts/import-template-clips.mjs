#!/usr/bin/env node
// Owner-operated only. Dry runs download previews but never upload or install a manifest.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publicTemplateClip } from '../app/veyrnox/_lib/templateClips.js';
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { capabilityFor, checkSource } from '../lib/modelCapabilities.js';
import { TEMPLATE_CLIP_ENDPOINT } from '../lib/templateClipGeneration.js';
import { envConfig, isConfigured, sha256Hex } from '../packages/adapters/r2.js';
import { outsideRepo, boundedBytes, MAX_BYTES, assertMp4, measure, normalise, verifyUpload } from './import-swap-scenes.mjs';

const fail = code => { throw new Error(code); };
export function sourceUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('invalid_source_url'); }
  if (url.protocol !== 'https:' || url.host !== 'veyrnox.ai' || url.username || url.password || url.hash || url.search
      || !/^\/showcase\/[a-zA-Z0-9_-]+\.mp4$/.test(url.pathname)
      || /[\\\s]/.test(raw) || raw.includes('%')) fail('source_url_not_allowed');
  return url;
}

// Exactly the canonical preview used by publicPresets: never source-record URLs.
export function canonicalPreview(id) {
  if (!publicTemplateClip(id)) fail('unknown_template_clip');
  const preset = templateById(id), preview = SHOWCASE_CLIPS[preset?.clipKey]?.video;
  if (!preset || typeof preview !== 'string' || !preview.startsWith('/showcase/')) fail('template_preview_missing');
  return sourceUrl(`https://veyrnox.ai${preview}`).href;
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

export async function importTemplateClips({ decisions, outDir, upload = false, confirmBucket,
  r2 = envConfig(), download = downloadClip, storage } = {}) {
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
  const base = await outsideRepo(outDir || tmpdir());
  await mkdir(base, { recursive: true });
  const runDir = await mkdtemp(path.join(base, 'template-clips-'));
  const manifest = {}, files = [];
  const report = { dryRun: !upload, publishable: false, results: [] };
  try {
    for (const entry of approved) {
      const folder = await mkdtemp(path.join(runDir, 'clip-'));
      const input = path.join(folder, 'original.mp4'), output = path.join(folder, 'normalised.mp4');
      try {
        await download(entry.url, input);
        const original = await readFile(input);
        if (original.length > MAX_BYTES) fail('source_over_cap');
        assertMp4(original);
        const before = await measure(input);
        if (![before.seconds, before.videoSeconds].every(value => Number.isFinite(value) && value >= 2)) fail('source_too_short');
        const media = await normalise(input, output, false, 5);
        const checked = checkSource(capabilityFor(TEMPLATE_CLIP_ENDPOINT), { video_url: {
          ...media, dimensions: { width: media.width, height: media.height },
        } });
        if (!checked.ok) fail(checked.error);
        if (media.seconds > 5.05 || media.videoSeconds > 5.05 || media.codec !== 'h264' || media.audio || Math.max(media.width, media.height) > 1280
            || media.width % 2 || media.height % 2) fail('normalisation_failed');
        const bytes = await readFile(output);
        if (bytes.length > MAX_BYTES) fail('source_over_cap');
        const sha256 = await sha256Hex(bytes);
        manifest[entry.id] = { key: `template-clips/${entry.id}/${sha256}.mp4`, version: sha256.slice(0, 12),
          seconds: media.seconds, videoSeconds: media.videoSeconds, width: media.width, height: media.height, contentType: 'video/mp4', sha256 };
        files.push({ id: entry.id, file: output, sizeBytes: bytes.length });
        report.results.push({ id: entry.id, status: 'normalised' });
      } finally { await rm(input, { force: true }); }
    }
    if (upload) {
      for (const item of files) await verifyUpload({ ...manifest[item.id], sizeBytes: item.sizeBytes }, await readFile(item.file), r2, storage);
      report.publishable = true;
    }
    const revisionDir = path.join(runDir, report.publishable ? 'publishable' : 'preview');
    await mkdir(revisionDir);
    await writeFile(path.join(revisionDir, 'templateClipSources.js'), `// SERVER ONLY. Owner-reviewed import candidate.\nexport const TEMPLATE_CLIP_SOURCES = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`);
    return { runDir, revisionDir, manifest, files, report };
  } catch (error) {
    report.error = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'clip_processing_failed';
    throw Object.assign(new Error(report.error), { runDir });
  } finally { await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
}

export async function cli(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    decisions: { type: 'string' }, 'out-dir': { type: 'string' }, 'dry-run': { type: 'boolean' },
    upload: { type: 'boolean' }, 'confirm-bucket': { type: 'string' },
  } });
  if (!values.decisions) fail('decisions_path_required');
  if (values.upload && values['dry-run']) fail('conflicting_modes');
  const decisions = JSON.parse(await readFile(await outsideRepo(values.decisions), 'utf8'));
  const result = await importTemplateClips({ decisions, outDir: values['out-dir'], upload: !!values.upload, confirmBucket: values['confirm-bucket'] });
  console.log(JSON.stringify({ runDir: result.runDir, ...result.report }));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(/^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'import_failed'); process.exitCode = 1; });
}
