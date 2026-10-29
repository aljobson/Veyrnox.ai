#!/usr/bin/env node
// Networked audit helper: redownload the nine recovered Syntx variants, verify
// their bytes, then compare them perceptually with the historical local clips.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import {
  SYNTX_EXPANSION_SOURCE_ASSET_SHA256,
  SYNTX_RECOVERED_PREVIEW_SSIM,
} from '../tests/fixtures/syntxSourceAssetHashes.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'veyrnox-syntx-proof-'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

try {
  for (const [id, expectedHash] of Object.entries(SYNTX_EXPANSION_SOURCE_ASSET_SHA256)) {
    const record = SYNTX_SOURCE_PROMPT_RECORDS[id];
    const response = await fetch(`https://r2.syntx.ai/ERP/media-library/trends/variants/${record.sourceMediaId}.mp4`);
    if (!response.ok) throw new Error(`${id}: source download returned ${response.status}`);
    const source = Buffer.from(await response.arrayBuffer());
    if (sha256(source) !== expectedHash) throw new Error(`${id}: source SHA-256 changed`);
    const expectedSsim = SYNTX_RECOVERED_PREVIEW_SSIM[id];
    if (expectedSsim == null) {
      console.log(`${id}: source SHA-256 verified`);
      continue;
    }
    const sourcePath = join(scratch, `${id}.mp4`);
    writeFileSync(sourcePath, source);

    const localPath = fileURLToPath(new URL(`../public${SHOWCASE_CLIPS[id].video}`, import.meta.url));
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', localPath,
    ], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`${id}: ffprobe failed\n${probe.stderr}`);
    const [{ width, height }] = JSON.parse(probe.stdout).streams;
    const comparisonWidth = 320;
    const comparisonHeight = Math.round((comparisonWidth * height / width) / 2) * 2;
    const comparison = spawnSync('ffmpeg', [
      '-nostdin', '-v', 'info', '-i', sourcePath, '-i', localPath,
      '-filter_complex', `[0:v]scale=${comparisonWidth}:${comparisonHeight},setsar=1,setpts=PTS-STARTPTS[a];[1:v]scale=${comparisonWidth}:${comparisonHeight},setsar=1,setpts=PTS-STARTPTS[b];[a][b]ssim`,
      '-t', '5', '-f', 'null', '-',
    ], { encoding: 'utf8' });
    if (comparison.status !== 0) throw new Error(`${id}: ffmpeg comparison failed\n${comparison.stderr}`);
    const score = Number(comparison.stderr.match(/All:([0-9.]+)/)?.[1]);
    if (!Number.isFinite(score) || score < 0.95) throw new Error(`${id}: SSIM ${score} is below the 0.95 match threshold`);
    const drift = Math.abs(score - expectedSsim);
    if (drift > 0.005) throw new Error(`${id}: SSIM ${score} drifted ${drift} from recorded ${expectedSsim}`);
    console.log(`${id}: SHA-256 and SSIM ${score.toFixed(6)} verified (recorded ${expectedSsim.toFixed(6)}, drift ${drift.toFixed(6)})`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
