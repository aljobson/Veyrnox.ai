#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SHOWCASE_CLIPS, MAX_CLIP_BYTES } from '../app/veyrnox/_lib/showcase.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = join(process.env.TMPDIR || '/tmp', 'veyrnox-showcase-sources');
mkdirSync(cache, { recursive: true });

const rows = readFileSync(join(root, 'docs/product/showcase-clips.md'), 'utf8').split('\n').flatMap(line => {
  const match = line.match(/^\| `([^`]+)` \|.*\]\((https:\/\/[^)]+\.(?:mp4|webm))\) \| ([0-9.]+) s \|$/i);
  return match ? [{ key: match[1], url: match[2], start: Number(match[3]) }] : [];
});

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`);
}

for (const [index, row] of rows.entries()) {
  const clip = SHOWCASE_CLIPS[row.key];
  if (!clip) throw new Error(`No manifest clip for ${row.key}`);
  const suffix = extname(new URL(row.url).pathname) || '.mp4';
  const source = join(cache, `${createHash('sha256').update(row.url).digest('hex')}${suffix}`);
  if (!existsSync(source)) run('curl', ['-L', '--fail', '--silent', '--show-error', row.url, '-o', source]);
  const output = join(root, 'public', clip.video);
  const temporary = `${output}.quality.mp4`;
  const encode = crf => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(row.start), '-i', source, '-t', '5', '-an',
    '-vf', "tpad=stop_mode=clone:stop_duration=5,scale=w='min(1080,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24",
    '-c:v', 'libx264', '-profile:v', 'high', '-crf', String(crf), '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporary]);
  encode(20);
  if (statSync(temporary).size > MAX_CLIP_BYTES) encode(23);
  if (statSync(temporary).size > MAX_CLIP_BYTES) throw new Error(`${row.key} still exceeds ${MAX_CLIP_BYTES} bytes`);
  renameSync(temporary, output);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.5', '-i', output, '-frames:v', '1', '-vf', "scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-q:v', '4', join(root, 'public', clip.poster)]);
  console.log(`${index + 1}/${rows.length} ${row.key}: ${basename(output)} (${Math.round(statSync(output).size / 1024)} KiB)`);
}
