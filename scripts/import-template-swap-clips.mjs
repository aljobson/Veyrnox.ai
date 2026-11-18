#!/usr/bin/env node
// Owner-run importer. No downloads. Dry run by default; never installs a revision.
import { templateSwapRoles, normaliseSwapRole } from '../lib/templateSwapClipRoles.mjs';
import { clipOrigin } from './lib/template-origin.mjs';
import { readFile, writeFile, mkdir, mkdtemp, realpath, open, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TEMPLATE_CLIPS } from '../app/veyrnox/_lib/templateClips.js';
import { templateContract } from '../lib/templateContract.js';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { checkTemplateSwapVideoSource } from '../lib/templateSwapClipGeneration.js';
import { TEMPLATE_SWAP_CLIP_ENDPOINT } from '../app/veyrnox/_lib/templateSwapClips.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { envConfig, isConfigured, sha256Hex, putObject, getObject } from '../packages/adapters/r2.js';
import { readBoundedBody } from '../lib/boundedBody.js';
import { TEMPLATE_SWAP_MANIFEST_MAX_BYTES } from '../lib/templateSwapClipManifest.js';
import { MAX_BYTES, assertMp4, verifyUpload } from './import-swap-scenes.mjs';
import { outsideRepositories, normaliseSwapClip, contactSheet, indexSheet, posterSimilarity } from './lib/swap-clip-normalise.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const fail = code => { throw new Error(code); };
export const reviewFingerprint = (sha256, role) => sha256Hex(new TextEncoder().encode(`${sha256}\n${normaliseSwapRole(role)}`));
const json = value => JSON.stringify(value, null, 2) + '\n';
const likenessNote = 'This is a community creator result, not the original input. It may contain third-party likenesses. Owner approval of rights and moderation is required before publication.';

// Every template that has a preview clip and needs a source video: swap recipes the swap guard refuses ('swap'), swap-style recipes the
// video guard refuses ('video_swap') and other video-dependent recipes without swap wording ('motion'). Hidden (not in the gallery) and
// Seedance-labelled templates are included: they are addressable by id and meet the same refusal today.
export const kindOf = contract => !contract ? null
  : contract.class === 'blocked-needs-video' ? (swapNeedsSourceVideo(contract.sourcePrompt) ? 'video_swap' : 'motion')
    : swapNeedsSourceVideo(contract.sourcePrompt) ? 'swap' : null;
export async function swapCandidates({ kinds = ['swap', 'video_swap', 'motion'] } = {}) {
  return [...new Set(TEMPLATE_CLIPS.map(clip => clip.id))].map(templateContract)
    .map(c => c && Object.assign({}, c, { kind: kindOf(c) })).filter(c => c && kinds.includes(c.kind));
}

// Every audit file that records a preview hash, tagged with its origin (the file-name prefix: higgsfield, seedance, syntx, ...).
export async function auditRecords() {
  const dir = path.join(repo, 'docs/product/source-audit');
  const out = [];
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.json')).sort()) {
    let parsed;
    try { parsed = JSON.parse(await readFile(path.join(dir, name), 'utf8')); } catch { continue; }
    for (const record of Array.isArray(parsed?.records) ? parsed.records : []) {
      if (record && typeof record.id === 'string' && /^[a-f0-9]{64}$/.test(record.localPreviewSha256 || '')) out.push({ ...record, origin: name.split('-')[0] });
    }
  }
  return out;
}

// A registered local basename only; no CDN or other network fallback exists. Returns the file and its SHA-256; the caller decides
// whether an audit record vouches for it.
export async function readLocalClip(id, showcaseDir) {
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
    assertMp4(bytes);
    return { file, sha256: await sha256Hex(bytes), poster: await posterFor(root, previewFile) };
  } finally { await handle.close(); }
}

async function posterFor(root, previewFile) {
  for (const ext of ['jpg', 'webp', 'png']) {
    const candidate = path.join(root, previewFile.replace(/\.mp4$/, '.' + ext));
    try { await access(candidate); if (path.dirname(await realpath(candidate)) === root) return candidate; } catch { /* next */ }
  }
  return null;
}

// Tier letters: A swap template whose clip hash an audit record vouches for, B a swap template with no audit record, C a swap-style
// template the video guard refuses, D another video-dependent template (motion transfer; lower fit for O1).
export const tierFor = (kind, verification) => kind === 'video_swap' ? 'C' : kind === 'motion' ? 'D' : verification === 'audit_hash' ? 'A' : 'B';
// Clips whose origin is a competitor's hosted trend feed stay out unless the owner opts in (ADR-0333: no Syntx media).
const EXCLUDED_ORIGINS = new Set(['syntx']);

function markdown(report) {
  return '# Template swap clip review\n\n' + likenessNote + '\n\n' +
    'Workflow: 1) run with --review-all and review every sheet; 2) copy decisions-template.json outside the repo, correct roles, regenerate --review-all with those overrides, and set approved:true on clips you accept (keep sha256, role and reviewFingerprint); 3) upload refuses changed clip bytes or roles.\n\n' +
    `Dry run: ${report.dryRun}. Publishable: ${report.publishable}. Candidates: ${report.total}. By tier: ${JSON.stringify(report.tiers)}.\n\n` +
    report.results.map(r => `## ${r.id}\n\nOutcome: ${r.outcome}${r.reason ? ' (' + r.reason + ')' : ''}. Kind: ${r.kind}. Tier: ${r.tier || 'not reviewed'}. Origin: ${r.origin || 'none on record'}. Verification: ${r.verification}${r.posterSimilarity === undefined ? '' : ', first-frame vs poster similarity ' + r.posterSimilarity}.\n\nRESULT CLIP, NOT THE ORIGINAL INPUT.\n\n` +
      (r.media ? `Measured: ${r.media.width}×${r.media.height}; container ${r.media.seconds}s; video ${r.media.videoSeconds}s; ${r.media.frameRate} fps; ${r.media.sizeBytes} bytes; SHA-256 ${r.media.sha256}.\n\n![Six frames](sheets/${r.id}.jpg)\n\n` : '') +
      `Role: ${r.role}. object_role_suspected: ${r.object_role_suspected}. Slot roles: ${JSON.stringify(r.roles)}.\n\nTemplate prompt: ${r.prompt}\n\n${likenessNote}\n`).join('\n');
}

// Replace whatever list is installed (empty or populated); the emitted ids must equal the given ids exactly.
export function renderSwapRegistry(registry, ids, pin) {
  const pattern = /Object\.freeze\(\[[^\]]*\]\)/;
  if (!pattern.test(registry)) fail('registry_render_failed');
  const pinDeclaration = /export const TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 = ['"][a-f0-9]*['"];/;
  if (!/^[a-f0-9]{64}$/.test(pin) || !pinDeclaration.test(registry)) fail('registry_render_failed');
  const rendered = registry.replace(pattern, `Object.freeze(${JSON.stringify(ids)})`)
    .replace(pinDeclaration, `export const TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 = '${pin}';`);
  const emitted = JSON.parse(/TEMPLATE_SWAP_CLIPS = Object\.freeze\((\[[^\]]*\])\)/.exec(rendered)?.[1] ?? 'null');
  if (JSON.stringify(emitted) !== JSON.stringify(ids)) fail('registry_render_failed');
  return rendered;
}

export async function importTemplateSwapClips({ decisions, outDir, upscale = false, upload = false, reviewAll = false, confirmBucket,
  showcaseDir = path.join(repo, 'public/showcase'), records, kinds, includeSyntx = false, r2 = envConfig(), storage = { putObject, getObject } } = {}) {
  // Validate every caller-controlled output path before any decisions or source work.
  const base = await outsideRepositories(outDir);
  if (!Array.isArray(decisions)) fail('decisions_must_be_array');
  if (typeof upload !== 'boolean') fail('explicit_upload_required');
  // Two steps: --review-all builds the pack for every candidate; only approved entries carrying the reviewed sha256 can be uploaded.
  if (reviewAll && upload) fail('review_all_not_with_upload');
  if (upload && (!isConfigured(r2) || !confirmBucket || confirmBucket !== r2.bucket)) fail('confirmed_r2_bucket_required');
  const candidates = await swapCandidates({ kinds }), byId = new Map(candidates.map(c => [c.id, c])), approved = new Set(), seen = new Set(), reviewed = new Map(), roleReviews = new Map();
  for (const entry of decisions) {
    if (!byId.has(entry?.id)) fail('unknown_template_swap');
    if (seen.has(entry.id)) fail('duplicate_template_id');
    seen.add(entry.id);
    if (entry.approved === true) approved.add(entry.id);
    if (typeof entry.sha256 === 'string') reviewed.set(entry.id, entry.sha256);
    if (entry.role !== undefined && !normaliseSwapRole(entry.role)) fail('template_swap_role_invalid');
    roleReviews.set(entry.id, entry);
  }
  const sourceRecords = records ?? await auditRecords();
  const recordById = new Map(sourceRecords.map(r => [r.id, r])), recordByHash = new Map(sourceRecords.map(r => [r.localPreviewSha256, r]));
  const report = { dryRun: !upload, publishable: false, total: candidates.length, tiers: {}, results: [] };
  await mkdir(base, { recursive: true });
  const runDir = await mkdtemp(path.join(base, 'template-swap-clips-'));
  // Fresh exclusive directory prevents existing report/clip symlinks redirecting writes.
  await mkdir(path.join(runDir, 'clips')); await mkdir(path.join(runDir, 'sheets'));
  const manifest = {}, files = [], sheets = [];
  try {
    for (const candidate of candidates) {
      const { id } = candidate;
      const roleInfo = templateSwapRoles(candidate.sourcePrompt, roleReviews.get(id)?.role);
      const result = { ...roleInfo, id, kind: candidate.kind, outcome: 'not_reviewed', verification: 'not_checked', prompt: candidate.sourcePrompt, likenessNote,
        approved: approved.has(id) };
      report.results.push(result);
      if (!approved.has(id) && !reviewAll) { result.reason = 'rights_not_approved'; continue; }
      const output = path.join(runDir, 'clips', id + '.mp4'), sheet = path.join(runDir, 'sheets', id + '.jpg');
      try {
        const local = await readLocalClip(id, showcaseDir), input = local.file;
        const byId = recordById.get(id), record = byId ?? recordByHash.get(local.sha256);
        // A record found by id must match the bytes exactly; a record found only by hash proves the bytes by construction.
        if (byId && byId.localPreviewSha256 !== local.sha256) fail('showcase_hash_mismatch');
        result.verification = record ? 'audit_hash' : 'no_audit_record';
        result.origin = clipOrigin(id, sourceRecords.filter(r => r.id === id || r.localPreviewSha256 === local.sha256));
        result.tier = tierFor(candidate.kind, result.verification);
        report.tiers[result.tier] = (report.tiers[result.tier] || 0) + 1;
        if (!record && local.poster) result.posterSimilarity = await posterSimilarity(input, local.poster);
        if (EXCLUDED_ORIGINS.has(result.origin) && !includeSyntx) { result.outcome = 'origin_excluded'; result.reason = 'origin_excluded'; continue; }
        const media = await normaliseSwapClip(input, output, { upscale });
        const bytes = await readFile(output);
        if (bytes.length > MAX_BYTES) fail('too_large');
        const sha256 = await sha256Hex(bytes);
        const source = { role: roleInfo.role, key: `template-swap-clips/${id}/${sha256}.mp4`, version: sha256.slice(0, 12),
          seconds: media.seconds, videoSeconds: media.videoSeconds, width: media.width, height: media.height,
          frameRate: media.frameRate, contentType: 'video/mp4', sha256, sizeBytes: bytes.length };
        const checked = checkTemplateSwapVideoSource(id, source, capabilityFor(TEMPLATE_SWAP_CLIP_ENDPOINT));
        if (!checked.ok) fail(checked.error);
        await contactSheet(output, sheet, media);
        manifest[id] = source; files.push({ id, file: output }); sheets.push({ id, file: sheet });
        result.reviewFingerprint = await reviewFingerprint(sha256, source.role);
        result.outcome = 'ok_for_review'; result.media = { ...media, sha256, sizeBytes: bytes.length };
      } catch (error) {
        const reason = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'clip_processing_failed';
        result.outcome = ['showcase_hash_mismatch', 'too_short', 'too_large'].includes(reason) ? reason : 'processing_failed';
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
    await writeFile(path.join(runDir, 'decisions-template.json'), json(report.results.map(result => ({ id: result.id, approved: false, role: result.role, ...(manifest[result.id] ? { sha256: manifest[result.id].sha256, reviewFingerprint: result.reviewFingerprint } : {}) }))));
    if (upload) {
      // Any failed (or zero) approved candidate fails the run, never a quiet success without a revision.
      if (!approved.size || files.length !== approved.size) fail('approved_candidates_failed');
      for (const item of files) {
        const decision = roleReviews.get(item.id), source = manifest[item.id];
        if (!normaliseSwapRole(decision?.role) || reviewed.get(item.id) !== source.sha256
            || decision.reviewFingerprint !== await reviewFingerprint(source.sha256, source.role)) fail('reviewed_role_mismatch');
      }
      for (const item of files) await verifyUpload(manifest[item.id], await readFile(item.file), r2, storage);
      const ids = Object.keys(manifest).sort();
      const manifestBytes = new TextEncoder().encode(json({ version: 1, clips: Object.fromEntries(ids.map(id => [id, manifest[id]])) }));
      if (manifestBytes.length > TEMPLATE_SWAP_MANIFEST_MAX_BYTES) fail('manifest_too_large');
      const pin = await sha256Hex(manifestBytes), key = `template-swap-clips/manifests/${pin}.json`;
      const put = await storage.putObject(key, manifestBytes, 'application/json', r2, { onlyIfAbsent: true });
      if (!put.ok && put.status !== 412) fail('manifest_put_failed');
      const read = await storage.getObject(key, r2);
      if (!read.ok || read.response.status !== 200) fail('manifest_readback_failed');
      const returned = await readBoundedBody(read.response.body, manifestBytes.length, AbortSignal.timeout(3000));
      if (returned.length !== manifestBytes.length || await sha256Hex(returned) !== pin) fail('manifest_hash_mismatch');
      report.publishable = true;
      const published = path.join(runDir, 'publishable'); await mkdir(published);
      const registry = await readFile(path.join(repo, 'app/veyrnox/_lib/templateSwapClips.js'), 'utf8');
      const rendered = renderSwapRegistry(registry, ids, pin);
      await writeFile(path.join(published, 'templateSwapClips.js'), rendered);
      await writeFile(path.join(published, 'manifest.json'), manifestBytes);
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
    'dry-run': { type: 'boolean' }, 'review-all': { type: 'boolean' }, 'include-syntx': { type: 'boolean' }, kinds: { type: 'string' }, upload: { type: 'boolean' }, 'confirm-bucket': { type: 'string' },
  } });
  if (values.upload && values['dry-run']) fail('conflicting_modes');
  // Both paths checked before reading decisions or creating any output.
  const outDir = await outsideRepositories(values['out-dir']);
  const decisionsPath = await outsideRepositories(values.decisions);
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8'));
  const result = await importTemplateSwapClips({ decisions, outDir, upscale: values.upscale === true,
    upload: values.upload === true, reviewAll: values['review-all'] === true, includeSyntx: values['include-syntx'] === true,
    kinds: values.kinds?.split(',').filter(Boolean), confirmBucket: values['confirm-bucket'] });
  console.log(JSON.stringify({ runDir: result.runDir, publishable: result.report.publishable, total: result.report.total }));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(/^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'import_failed'); process.exitCode = 1; });
}
