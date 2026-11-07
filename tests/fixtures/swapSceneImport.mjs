import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const decision = {
  id: 'fixture-import-pro', name: 'Studio movement', category: 'YOUR PHOTO', people: 1,
  swapOffer: 'swap-recast', sourceUrl: 'https://d2ol7oe51mr4n9.cloudfront.net/synthetic.mp4',
  sourceRecordId: 'fixture-source-1', approved: true,
};
export async function syntheticClip(file, { seconds = 5, changed = false, width = 320, height = 240 } = {}) {
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi',
    '-i', `testsrc=size=${width}x${height}:rate=10`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-vf', changed ? 'hue=h=90,format=yuv420p' : 'format=yuv420p',
    '-c:v', 'libx264', '-threads', '2', '-filter_threads', '2', '-c:a', 'aac', file], { timeout: 120_000 });
}
