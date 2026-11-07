#!/usr/bin/env node
// Offline by default. Media and candidate revisions always stay outside this checkout.
import { readFile, writeFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { envConfig, isConfigured, putObject, getObject, sha256Hex } from '../packages/adapters/r2.js';

const exec = promisify(execFile);
export const REPO = fileURLToPath(new URL('../', import.meta.url));
export const MAX_BYTES = 100 * 1024 * 1024;
export const SOURCE_HOST = 'd2ol7oe51mr4n9.cloudfront.net';
const ENDPOINTS = { 'swap-quick': 'crun:wan/2-2-animate-replace', 'swap-recast': 'fal-ai/minimax-h3-max-recast' };
const REGISTRIES = [
  ['app/veyrnox/_lib/swapScenes.js', 'SWAP_SCENES'],
  ['lib/swapSceneSources.js', 'SWAP_SCENE_SOURCES'],
];
const fail = code => { throw new Error(code); };
const json = value => JSON.stringify(value, null, 2) + '\n';

// Resolve existing ancestors as well as the final component to reject symlink escapes.
export async function outsideRepo(target) {
  const absolute = path.resolve(target);
  let resolved;
  try { resolved = await realpath(absolute); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    resolved = path.join(await outsideRepo(path.dirname(absolute)), path.basename(absolute));
  }
  const root = await realpath(REPO);
  if (resolved === root || resolved.startsWith(root + path.sep)) fail('path_inside_repo');
  return resolved;
}

export function sourceUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('invalid_source_url'); }
  if (url.protocol !== 'https:' || url.hostname !== SOURCE_HOST || url.port
      || url.username || url.password || url.hash) fail('source_url_not_allowed');
  if (!url.pathname.toLowerCase().endsWith('.mp4')) fail('source_not_mp4');
  return url;
}

export async function boundedBytes(response, cap = MAX_BYTES) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap)) {
    await response.body?.cancel(); fail('source_over_cap');
  }
  if (!response.body) fail('source_empty');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) fail('source_over_cap');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (!size) fail('source_empty');
  return Buffer.concat(chunks, size);
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

function assertMp4(bytes) {
  // Reject QuickTime even though ffprobe shares its mov/mp4 demuxer.
  const brands = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash']);
  if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp'
      || !brands.has(bytes.toString('ascii', 8, 12))) fail('source_not_mp4');
}

export function validateDecision(entry) {
  if (!entry || !Object.hasOwn(ENDPOINTS, entry.swapOffer)) fail('swap_offer_required');
  if (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(entry.id)) fail('invalid_scene_id');
  if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 120) fail('invalid_scene_name');
  if (entry.category !== 'YOUR PHOTO') fail('invalid_category');
  if (typeof entry.sourceRecordId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(entry.sourceRecordId)) fail('invalid_source_record_id');
  if (![1, 2].includes(entry.people)) fail('unsupported_people');
  if (entry.swapOffer === 'swap-quick' && entry.people !== 1) fail('quick_requires_one_person');
  sourceUrl(entry.sourceUrl);
  return entry.people === 2 ? ['needs_multi_reference'] : [];
}

export function validateBounds(offer, media) {
  if (!Object.hasOwn(ENDPOINTS, offer)) fail('swap_offer_required');
  const bounds = capabilityFor(ENDPOINTS[offer]).media.video;
  for (const value of [media.seconds, media.videoSeconds]) {
    if (!Number.isFinite(value) || value <= 0) fail('duration_unknown');
    if (value < bounds.minSeconds) fail(offer === 'swap-recast' ? 'too_short_for_pro' : 'too_short_for_quick');
    if (value > bounds.maxSeconds) fail('source_too_long');
  }
  for (const value of [media.width, media.height]) {
    if (!Number.isInteger(value) || value <= 0) fail('dimensions_unknown');
    if (bounds.minSide && value < bounds.minSide || bounds.maxSide && value > bounds.maxSide) fail('source_resolution_out_of_range');
  }
}

export async function measure(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe',
    '-show_format', '-show_streams', '-of', 'json', file], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout), videos = probe.streams?.filter(s => s.codec_type === 'video');
  if (videos?.length !== 1 || videos[0].disposition?.attached_pic) fail('source_video_required');
  const video = videos[0];
  return { seconds: Number(probe.format?.duration), videoSeconds: Number(video.duration),
    width: video.width, height: video.height, codec: video.codec_name,
    audio: probe.streams.some(s => s.codec_type === 'audio') };
}

export async function normalise(input, output, keepAudio = false) {
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe',
    '-i', input, '-map', '0:v:0', ...(keepAudio ? ['-map', '0:a:0?', '-c:a', 'aac'] : ['-an']),
    '-t', '10', '-vf', "scale=w='trunc(iw*min(1,1280/max(iw,ih))/2)*2':h='trunc(ih*min(1,1280/max(iw,ih))/2)*2',setsar=1",
    '-c:v', 'libx264', '-threads', '2', '-filter_threads', '2', '-pix_fmt', 'yuv420p',
    '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output],
  { timeout: 300_000, maxBuffer: 1024 * 1024 });
  return measure(output);
}

// Display label only: nearest supported ratio in log space; no crop or padding.
export function aspectFor(width, height) {
  return ['9:16', '16:9', '1:1', '4:5'].sort((a, b) => {
    const distance = ratio => { const [w, h] = ratio.split(':').map(Number); return Math.abs(Math.log(width / height / (w / h))); };
    return distance(a) - distance(b);
  })[0];
}

export async function verifyUpload(source, bytes, cfg, storage = { putObject, getObject }) {
  const put = await storage.putObject(source.key, bytes, 'video/mp4', cfg, { onlyIfAbsent: true });
  if (!put.ok && put.status !== 412) fail('r2_put_failed');
  const read = await storage.getObject(source.key, cfg);
  if (!read.ok) fail('r2_readback_failed');
  const returned = await boundedBytes(read.response, source.sizeBytes);
  if (returned.length !== source.sizeBytes || await sha256Hex(returned) !== source.sha256) fail('r2_hash_mismatch');
  return put.ok ? 'uploaded_verified' : 'already_present_verified';
}

export function renderRegistry(original, name, value) {
  const begin = `// BEGIN GENERATED ${name}`, end = `// END GENERATED ${name}`;
  const serialised = Array.isArray(value)
    ? `[\n${value.map(row => '  ' + JSON.stringify(row)).join(',\n')}\n]`
    : `{\n${Object.entries(value).map(([key, row]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(row)).join(',\n')}\n}`;
  const block = `${begin}\nexport const ${name} = Object.freeze(${serialised});\n${end}`;
  const start = original.indexOf(begin), finish = original.indexOf(end);
  if (start >= 0 && finish > start) return original.slice(0, start) + block + original.slice(finish + end.length);
  const empty = `export const ${name} = Object.freeze(${Array.isArray(value) ? '[]' : '{}'});`;
  if (!original.includes(empty)) fail('registry_markers_missing');
  if (Object.keys(value).length === 0) return original;
  return original.replace(empty, block);
}

export async function importScenes({ decisions, download = downloadClip, outDir, dryRun = true,
  upload = false, confirmBucket, r2 = envConfig(), storage, keepAudio = false,
  decisionDate = new Date().toISOString().slice(0, 10) }) {
  if (!Array.isArray(decisions)) fail('decisions_must_be_array');
  if (typeof dryRun !== 'boolean' || typeof upload !== 'boolean' || dryRun === upload) fail('explicit_upload_required');
  if (upload && (!isConfigured(r2) || !confirmBucket || confirmBucket !== r2.bucket)) fail('confirmed_r2_bucket_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decisionDate) || !Number.isFinite(Date.parse(decisionDate))) fail('invalid_decision_date');
  const approved = decisions.filter(entry => entry?.approved === true), seen = new Set();
  for (const entry of approved) {
    validateDecision(entry);
    if (seen.has(entry.id)) fail('duplicate_scene_id');
    seen.add(entry.id);
  }
  const base = await outsideRepo(outDir || tmpdir());
  await mkdir(base, { recursive: true });
  // Fresh directory prevents stale publishable revisions or symlinks from a previous run.
  const runDir = await mkdtemp(path.join(base, 'swap-scenes-'));
  const scenes = [], manifest = {}, audit = [], results = [];
  for (const entry of approved) {
    const folder = await mkdtemp(path.join(runDir, 'clip-'));
    const input = path.join(folder, 'original.mp4'), output = path.join(folder, 'normalised.mp4');
    try {
      await download(entry.sourceUrl, input);
      const original = await readFile(input);
      if (original.length > MAX_BYTES) fail('source_over_cap');
      assertMp4(original);
      const originalMedia = await measure(input);
      const minimum = capabilityFor(ENDPOINTS[entry.swapOffer]).media.video.minSeconds;
      for (const seconds of [originalMedia.seconds, originalMedia.videoSeconds]) {
        if (!Number.isFinite(seconds) || seconds <= 0) fail('duration_unknown');
        if (seconds < minimum) fail(entry.swapOffer === 'swap-recast' ? 'too_short_for_pro' : 'too_short_for_quick');
      }
      const media = await normalise(input, output, keepAudio);
      validateBounds(entry.swapOffer, media);
      if (media.codec !== 'h264' || Math.max(media.width, media.height) > 1280
          || media.width % 2 || media.height % 2 || (!keepAudio && media.audio)) fail('normalisation_failed');
      const bytes = await readFile(output);
      if (bytes.length > MAX_BYTES) fail('source_over_cap');
      const sha256 = await sha256Hex(bytes), originalSha256 = await sha256Hex(original);
      const source = { key: `swap-scenes/${entry.id}/${sha256}.mp4`, version: sha256.slice(0, 12),
        sha256, originalSha256, sizeBytes: bytes.length, originalSizeBytes: original.length,
        seconds: media.seconds, videoSeconds: media.videoSeconds, width: media.width, height: media.height, contentType: 'video/mp4' };
      const model = MODELS.find(row => row.id === entry.swapOffer);
      scenes.push({ id: entry.id, name: entry.name, category: 'YOUR PHOTO', aspect: aspectFor(media.width, media.height),
        needs: 'Photo', swapOffer: entry.swapOffer, people: entry.people, model: model.name, credits: model.credits, durationSeconds: 5 });
      manifest[entry.id] = source;
      audit.push({ id: entry.id, sourceRecordId: entry.sourceRecordId, sourceHost: SOURCE_HOST,
        originalSha256, sha256, originalSizeBytes: original.length, sizeBytes: bytes.length,
        seconds: media.seconds, videoSeconds: media.videoSeconds, width: media.width, height: media.height,
        people: entry.people, swapOffer: entry.swapOffer, decisionDate, moderation: 'reviewed-by-eye', ownerApproved: true });
      results.push({ id: entry.id, status: 'normalised', flags: validateDecision(entry), file: output });
    } catch (error) {
      // Never copy ffmpeg stderr, source URLs, private moderation reasons or names into reports.
      const code = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'clip_processing_failed';
      results.push({ id: entry.id, status: 'refused', error: code });
      await rm(output, { force: true });
    } finally { await rm(input, { force: true }); }
  }
  const report = { decisionDate, dryRun, publishable: false, keepAudio, results };
  await writeFile(path.join(runDir, 'report.json'), json(report));
  if (upload && results.every(row => row.status !== 'refused')) {
    try {
      for (const result of results) result.status = await verifyUpload(manifest[result.id], await readFile(result.file), r2, storage);
      report.publishable = true;
    } catch (error) {
      report.error = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'upload_failed';
      await writeFile(path.join(runDir, 'report.json'), json(report));
      throw Object.assign(new Error(report.error), { runDir });
    }
  }
  // Candidate code is deliberately staged outside the repo. Only verified uploads
  // get the publishable/ folder; dry runs cannot accidentally install a manifest.
  const revisionDir = path.join(runDir, report.publishable ? 'publishable' : 'preview');
  for (const [relative, name] of REGISTRIES) {
    const original = await readFile(path.join(REPO, relative), 'utf8');
    const rendered = renderRegistry(original, name, name === 'SWAP_SCENES' ? scenes : manifest);
    if (rendered.split('\n').length >= 500) fail('registry_exceeds_line_limit');
    const destination = path.join(revisionDir, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, rendered);
  }
  const auditPath = path.join(revisionDir, 'docs/product/source-audit', `swap-scenes-${decisionDate}.json`);
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, audit.length ? `[\n${audit.map(row => '  ' + JSON.stringify(row)).join(',\n')}\n]\n` : '[]\n');
  await writeFile(path.join(runDir, 'report.json'), json(report));
  return { runDir, revisionDir, scenes, manifest, audit, report };
}

export async function cli(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    decisions: { type: 'string' }, 'out-dir': { type: 'string' }, 'dry-run': { type: 'boolean' },
    upload: { type: 'boolean' }, 'confirm-bucket': { type: 'string' }, 'keep-audio': { type: 'boolean' },
  } });
  if (!values.decisions) fail('decisions_path_required');
  if (values.upload && values['dry-run']) fail('conflicting_modes');
  const decisions = JSON.parse(await readFile(await outsideRepo(values.decisions), 'utf8'));
  const result = await importScenes({ decisions, outDir: values['out-dir'], dryRun: !values.upload,
    upload: !!values.upload, confirmBucket: values['confirm-bucket'], keepAudio: !!values['keep-audio'] });
  console.log(json({ runDir: result.runDir, publishable: result.report.publishable, results: result.report.results }));
  if (result.report.results.some(row => row.status === 'refused')) process.exitCode = 1;
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(/^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'import_failed'); process.exitCode = 1; });
}
