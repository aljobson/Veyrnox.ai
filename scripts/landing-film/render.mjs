// Captures the landing film frame by frame: opens film.html in Chrome,
// calls seek(t) for each frame and saves a PNG. ffmpeg turns the frames into
// the video (the commands are in README.md).
//
// Motion blur: the film names the stretches where things move fast
// (window.blurWindows). A frame inside one is captured as several samples
// across its 1/60 s and averaged with ffmpeg; every other frame is one sharp
// capture. Two samples are not enough: a fast pan then shows as a double image.
//
// playwright-core is not a dependency of this repo, on purpose (see the
// bundler traps in CLAUDE.md). Install it somewhere else and point at it:
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.mjs \
//     node scripts/landing-film/render.mjs --out /tmp/film/frames
//
// Options: --fps 60  --samples 8 (per blurred frame)  --from 0
// --to <film length>  --at 7.2,9.1 (stills only)  --workers 6

import { execFile } from 'node:child_process';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { filmSourceHash } from './source-hash.mjs';

const run = promisify(execFile);
const WIDTH = 1920;
const HEIGHT = 1080;

function parseArgs(argv) {
  const args = { fps: 60, samples: 8, from: 0, to: null, at: null, workers: 6, out: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`unknown option ${argv[i]}`);
    const value = key === 'out' || key === 'at' ? argv[i + 1] : Number(argv[i + 1]);
    if (value === undefined || Number.isNaN(value)) throw new Error(`${argv[i]} needs a value`);
    args[key] = value;
  }
  if (!args.out) throw new Error('--out <directory> is required');
  return args;
}

const frameName = (frame) => `f-${String(frame).padStart(6, '0')}`;
const sampleName = (frame, sample) => `${frameName(frame)}.s${String(sample).padStart(2, '0')}.png`;

/** The frames to make: each with the moments to capture for it. */
function plan(args, film) {
  if (args.at) {
    return args.at.split(',').map((at) => ({ file: `still-${Number(at).toFixed(2)}.png`, shots: [{ t: Number(at) }] }));
  }
  const first = Math.round(args.from * args.fps);
  const last = Math.round((args.to ?? film.duration) * args.fps);
  return Array.from({ length: last - first }, (_, i) => {
    const frame = first + i;
    const t = frame / args.fps;
    const fast = args.samples > 1 && film.blurWindows.some(([start, end]) => t >= start && t < end);
    const count = fast ? args.samples : 1;
    return {
      frame,
      file: `${frameName(frame)}.png`,
      shots: Array.from({ length: count }, (_, sample) => ({ t: t + sample / (args.fps * count), sample })),
    };
  });
}

/** Average a blurred frame's samples into the one file ffmpeg will read. */
async function blend(dir, { frame, file, shots }) {
  const pattern = join(dir, `${frameName(frame)}.s%02d.png`);
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', '1', '-start_number', '0', '-i', pattern,
    '-vf', `tmix=frames=${shots.length}`, '-frames:v', String(shots.length), '-update', '1', join(dir, file),
  ]);
  shots.forEach(({ sample }) => unlinkSync(join(dir, sampleName(frame, sample))));
}

/** Run `work` over `items`, `width` at a time. */
async function pool(items, width, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: width }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await work(item);
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
  const url = `${pathToFileURL(join(fileURLToPath(new URL('.', import.meta.url)), 'film.html'))}?t=0`;
  mkdirSync(args.out, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const open = async () => {
      const page = await context.newPage();
      page.on('pageerror', (error) => { throw error; });
      await page.goto(url);
      await page.evaluate(() => window.ready);
      return page;
    };
    const pages = await Promise.all(Array.from({ length: args.workers }, open));
    const film = await pages[0].evaluate(() => ({ duration: window.duration, blurWindows: window.blurWindows }));
    const frames = plan(args, film);
    const captures = frames.flatMap((frame) => frame.shots.map((shot) => ({
      t: shot.t,
      file: frame.shots.length > 1 ? sampleName(frame.frame, shot.sample) : frame.file,
    })));

    // Each page takes the next moment off the shared queue until it is empty.
    await Promise.all(pages.map(async (page) => {
      for (let shot = captures.shift(); shot; shot = captures.shift()) {
        await page.evaluate((t) => window.seek(t), shot.t);
        await page.screenshot({ path: join(args.out, shot.file), clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      }
    }));
    const blurred = frames.filter((frame) => frame.shots.length > 1);
    await pool(blurred, args.workers, (frame) => blend(args.out, frame));
    process.stdout.write(`${frames.length} frames in ${args.out} (${blurred.length} blurred)\n`);
    process.stdout.write(`rendered from ${filmSourceHash()}: put this in LANDING_FILM.renderedFrom\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
