// Local media only. Kept separate from ADR-0329's no-upscaling normaliser.
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { measure } from '../import-swap-scenes.mjs';
import { capabilityFor, checkSource } from '../../lib/modelCapabilities.js';
import { TEMPLATE_SWAP_CLIP_MAX_SECONDS } from '../../lib/templateSwapClipGeneration.js';
import { TEMPLATE_SWAP_CLIP_ENDPOINT } from '../../app/veyrnox/_lib/templateSwapClips.js';
const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const fail = code => { throw new Error(code); };

async function resolveAncestors(target) {
  const absolute = path.resolve(target);
  try { return await realpath(absolute); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(await resolveAncestors(path.dirname(absolute)), path.basename(absolute));
  }
}

// Include the main checkout and EVERY linked worktree, even when not nested here.
// Failure to discover the Git boundaries is a refusal, never permission to write.
export async function outsideRepositories(target) {
  if (typeof target !== 'string' || !target.trim()) fail('outside_path_required');
  const [common, linked] = await Promise.all([
    exec('git', ['rev-parse', '--git-common-dir'], { cwd: repo }),
    exec('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repo }),
  ]);
  const roots = [repo, path.dirname(path.resolve(repo, common.stdout.trim())),
    ...linked.stdout.split('\0').filter(line => line.startsWith('worktree ')).map(line => line.slice(9))];
  const resolved = await resolveAncestors(target);
  for (const root of roots) {
    const boundary = await resolveAncestors(root);
    if (resolved === boundary || resolved.startsWith(boundary + path.sep)) fail('path_inside_repo');
  }
  return resolved;
}

export function validateSwapMedia(media) {
  for (const seconds of [media.seconds, media.videoSeconds]) {
    if (!Number.isFinite(seconds) || seconds < 3) fail('too_short');
    if (seconds > TEMPLATE_SWAP_CLIP_MAX_SECONDS) fail('too_large');
  }
  if (![media.width, media.height].every(n => Number.isInteger(n) && n >= 720 && n <= 2160 && n % 2 === 0)) fail('too_large');
  if (!Number.isFinite(media.frameRate) || media.frameRate < 24 || media.frameRate > 60 || media.audio || media.codec !== 'h264') fail('normalisation_failed');
  const checked = checkSource(capabilityFor(TEMPLATE_SWAP_CLIP_ENDPOINT), { video_url: {
    ...media, dimensions: { width: media.width, height: media.height },
  } });
  if (!checked.ok) fail(checked.error);
  return media;
}

export async function normaliseSwapClip(input, output, { upscale = false } = {}) {
  const before = await measure(input);
  if (![before.seconds, before.videoSeconds].every(n => Number.isFinite(n) && n >= 3)) fail('too_short');
  if (![before.width, before.height, before.frameRate].every(n => Number.isFinite(n) && n > 0)) fail('normalisation_failed');
  const factor = Math.max(1, 720 / Math.min(before.width, before.height));
  if (factor > 1 && upscale !== true) fail('source_resolution_too_small');
  const width = Math.ceil(before.width * factor / 2) * 2, height = Math.ceil(before.height * factor / 2) * 2;
  if (Math.max(width, height) > 2160) fail('too_large');
  const fps = Math.min(60, Math.max(24, before.frameRate));
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-i', input,
    '-map', '0:v:0', '-an', '-t', '5', '-vf', `scale=${width}:${height}:flags=lanczos,setsar=1`, '-r', String(fps),
    '-c:v', 'libx264', '-threads', '2', '-filter_threads', '2', '-pix_fmt', 'yuv420p',
    '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output], { timeout: 300_000, maxBuffer: 1024 * 1024 });
  return validateSwapMedia(await measure(output));
}

export async function contactSheet(input, output, media) {
  const lastFrame = Math.max(5, Math.floor(media.videoSeconds * media.frameRate) - 1);
  const selected = Array.from({ length: 6 }, (_, i) => `eq(n\\,${Math.floor(i * lastFrame / 5)})`).join('+');
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-i', input,
    '-vf', `select=${selected},scale=240:240:force_original_aspect_ratio=decrease,pad=240:240:(ow-iw)/2:(oh-ih)/2,tile=3x2`,
    '-frames:v', '1', '-threads', '2', '-filter_threads', '2', '-q:v', '3', output], { timeout: 120_000 });
}

export async function indexSheet(files, output) {
  const layout = files.map((_, i) => `${(i % 2) * 720}_${Math.floor(i / 2) * 480}`).join('|');
  const args = files.flatMap(file => ['-protocol_whitelist', 'file,pipe', '-i', file]);
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-n', ...args,
    '-filter_complex', files.length === 1 ? '[0:v]null[out]' : `${files.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`,
    '-map', '[out]', '-frames:v', '1', '-threads', '2', '-filter_complex_threads', '2', '-q:v', '3', output], { timeout: 120_000 });
}
